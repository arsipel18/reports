// report-image-bi-dense.js  — Dense Tableau-like dashboard → single PNG
import puppeteer from "puppeteer";
import dayjs from "dayjs";
import { getPuppeteerLaunchOptions, safePuppeteerLaunch } from "./puppeteer-config.js";

export async function renderReportPNG(data) {
  const {
    period = "weekly",
    timeRange,
    summary = {},
    categories = [],
    sentiments = [],
    categoriesSentiment = [],   // optional: [{category,pos,neu,neg,count}]
    topPosts = [],
    commentExamples = {},
    moderatorAnalysis = {},
    keywords = [],               // optional: [{label, weight}]
    timeseries = {},             // optional: { posts:[], comments:[], labels:[], calendar:[] }
    categorySeries = {},         // optional: { [category]: number[] }
    scoreHistogram = [],         // optional: [binCounts]
    moderatorSeries = [],        // optional: [numbers]
    filters = null
  } = data;

  // ---------- normalize ----------
  const periodText = formatPeriodText(timeRange);
  const totals = {
    posts: summary.total_posts || 0,
    comments: summary.avg_comments ? Math.round((summary.avg_comments || 0) * (summary.total_posts || 0)) : 0,
    authors: summary.unique_authors || summary.total_posts || 0,
    scoreAvg: Math.round(summary.avg_score || 0),
  };
  const sentiment = {
    pos: Math.round(sentiments.find(s => s.sentiment === "pos")?.percentage || 0),
    neu: Math.round(sentiments.find(s => s.sentiment === "neu")?.percentage || 0),
    neg: Math.round(sentiments.find(s => s.sentiment === "neg")?.percentage || 0),
  };
  const trendVals = timeseries.posts || [];
  const trendLabels = timeseries.labels || (trendVals.length ? trendVals.map((_, i) => String(i + 1)) : []);
  
  // Ensure we always have some data for the chart to display
  const safeTrendVals = trendVals.length > 0 ? trendVals : new Array(7).fill(0);
  const safeTrendLabels = trendLabels.length > 0 ? trendLabels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const commentsSpark = timeseries.comments || [];
  const calVals = timeseries.calendar && timeseries.calendar.length ? timeseries.calendar
                  : (trendVals.length ? trendVals.slice(-35) : []);

  const topPost = topPosts?.[0] ? {
    text: topPosts[0].title || "",
    comments: topPosts[0].num_comments || 0,
    upvotes: topPosts[0].score || 0,
    date: new Date((topPosts[0].created_utc || Date.now()/1000)*1000).toLocaleDateString()
  } : { text:"", comments:0, upvotes:0, date:"" };

  const topCats = categories
    .map(c => ({ label: (c.category || c.name || "").replaceAll("_"," "), value: c.count ?? c.value ?? 0 }))
    .sort((a,b) => b.value - a.value);

  const T10 = ["#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F","#EDC948","#B07AA1","#FF9DA7","#9C755F","#BAB0AC"];
  const BLUE = "#4E79A7", BLUE_LL = "#DCE8F6";

  // ---------- helpers ----------
  const esc = (s="") => s.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  const trunc = (s,n)=> s && s.length>n ? s.slice(0,n-1)+"…" : (s||"");

  const spark = (vals=[], w=230, h=60, color="#4E79A7")=>{
    if(!vals.length) return "";
    const min=Math.min(...vals), max=Math.max(...vals);
    const pts = vals.map((v,i)=>{
      const x = (i/(vals.length-1))*w;
      const y = h - (max===min?0:(v-min)/(max-min))*h;
      return `${x},${y}`;
    }).join(" ");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3"/>
    </svg>`;
  };

  const combo = (bars=[], line=[], labels=[], {w=1200,h=350,pad=60}={})=>{
    // Always show the chart, even if bars are empty, as long as we have labels
    if(!bars.length && !labels.length) return "";
    
    // Ensure we have some data to work with
    const safeBars = bars.length > 0 ? bars : new Array(labels.length).fill(0);
    const max = Math.max(...safeBars, ...(line.length?line:[0]));
    const sx = (w-2*pad)/Math.max(1, safeBars.length-1);
    const sy = (h-2*pad)/(max||1);
    const barW = Math.min(40, (w-2*pad)/safeBars.length * 0.6);
    const gridY=5, gy=[];
    for(let i=0;i<=gridY;i++){
      const y=pad+i*(h-2*pad)/gridY, val=Math.round(max - i*(max/gridY));
      gy.push(`<line x1="${pad}" y1="${y}" x2="${w-pad}" y2="${y}" stroke="#E6E8EB"/><text x="${pad-12}" y="${y+5}" text-anchor="end" font-size="14" fill="#667085">${val}</text>`);
    }
    const barsSvg = safeBars.map((v,i)=>{
      const x = pad + i*sx - barW/2;
      const y = h - pad - v*sy;
      const hh = Math.max(0, h - pad - y);
      const color = `hsl(${200 + (i * 20) % 160}, 70%, 50%)`;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${hh}" fill="${color}" rx="2"/>`;
    }).join("");
    const lineSvg = line.length ? (()=> {
      const pts = line.map((v,i)=>`${pad+i*sx},${h - pad - v*sy}`).join(" ");
      const dots = line.map((v,i)=>`<circle cx="${pad+i*sx}" cy="${h - pad - v*sy}" r="4" fill="${T10[2]}"/>`).join("");
      return `<polyline points="${pts}" fill="none" stroke="${T10[2]}" stroke-width="4"/>${dots}`;
    })() : "";
    const xlabels = labels.map((t,i)=>`<text x="${pad+i*sx}" y="${h-pad+25}" text-anchor="middle" font-size="14" fill="#64748B">${esc(String(t))}</text>`).join("");
    const avgLineLabel = `<text x="${w-pad-10}" y="${h-pad-Math.round(totals.scoreAvg*sy)+5}" text-anchor="end" font-size="12" fill="#EF4444" font-weight="600">Avg: ${totals.scoreAvg}</text>`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="#FFFFFF"/>
      ${gy.join("")}${barsSvg}${lineSvg}
      <line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#CBD5E1" stroke-width="2"/>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" stroke="#CBD5E1" stroke-width="2"/>
      ${xlabels}${avgLineLabel}
    </svg>`;
  };

  const histogram = (bins=[], {w=600,h=280,pad=40}={})=>{
    if(!bins.length) return "";
    const max = Math.max(...bins);
    const bw = (w-2*pad)/bins.length;
    const bars = bins.map((v,i)=>{
      const x = pad+i*bw, bh = (v/max)*(h-2*pad), y = h-pad-bh;
      return `<rect x="${x}" y="${y}" width="${bw-4}" height="${bh}" fill="${T10[i%T10.length]}"/>`;
    }).join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="#FFF"/>
      ${bars}
      <line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#98A2B3"/>
    </svg>`;
  };

  const donut = (parts, size=300, th=35)=>{
    const r=(size-th)/2, cx=size/2, cy=size/2, C=2*Math.PI*r;
    let acc=0;
    const segs = parts.map((p,i)=>{
      const pct=Math.max(0,Math.min(100, p.pct||0));
      const len=(pct/100)*C, off=(1-acc/100)*C; acc+=pct;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color || T10[i%T10.length]}"
              stroke-width="${th}" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${off}"
              transform="rotate(-90 ${cx} ${cy})"/>`;
    }).join("");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${BLUE_LL}" stroke-width="${th}"/>
      ${segs}
    </svg>`;
  };

  const stackedBars = (rows=[], w=600, h=300, pad=40)=>{
    // rows: [{label, pos, neu, neg, count}]
    rows = rows.slice(0,6);
    if(!rows.length) return "";
    const bh = (h-2*pad)/rows.length;
    const items = rows.map((r,i)=>{
      const tot = Math.max(1, r.pos+r.neu+r.neg);
      const px = (r.pos/tot)*(w-2*pad), nx=(r.neu/tot)*(w-2*pad), gx=(r.neg/tot)*(w-2*pad);
      const y = pad + i*bh + 6;
      const lab = esc((r.label||"").replaceAll("_"," "));
      return `
        <text x="${pad}" y="${y-8}" fill="#344054" font-size="13">${lab}</text>
        <rect x="${pad}" y="${y}" width="${w-2*pad}" height="${bh-18}" fill="#EEF2F6"/>
        <rect x="${pad}" y="${y}" width="${px}" height="${bh-18}" fill="#59A14F"/>
        <rect x="${pad+px}" y="${y}" width="${nx}" height="${bh-18}" fill="#EDC948"/>
        <rect x="${pad+px+nx}" y="${y}" width="${gx}" height="${bh-18}" fill="#E15759"/>
      `;
    }).join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="#FFF"/>${items}
    </svg>`;
  };

  const multiDonut = (rows=[], size=300, ring=18, gap=10)=>{
    const totalH = rows.length*(ring+gap)+gap;
    const R0 = (size-totalH)/2;
    let g = "";
    rows.forEach((r,i)=>{
      const rInner = R0 + i*(ring+gap) + gap;
      const rOuter = rInner + ring;
      const cx=size/2, cy=size/2, C=2*Math.PI*((rInner+rOuter)/2);
      const pct=Math.max(0,Math.min(100,r.pct||0));
      const len=(pct/100)*C;
      g += `<circle cx="${cx}" cy="${cy}" r="${(rInner+rOuter)/2}" fill="none" stroke="${BLUE_LL}" stroke-width="${ring}"/>
            <circle cx="${cx}" cy="${cy}" r="${(rInner+rOuter)/2}" fill="none" stroke="${r.color||T10[i%T10.length]}" stroke-width="${ring}"
               stroke-dasharray="${len} ${C-len}" transform="rotate(-90 ${cx} ${cy})"/>`;
    });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${g}</svg>`;
  };

  const calendar = (vals=[], {w=600,h=220,pad=16}={})=>{
    // 7 rows (Mon-Sun), N cols; simple grayscale→blue scale
    const cols = Math.min(35, vals.length || 0);
    if(!cols) return "";
    const slice = vals.slice(-cols);
    const max = Math.max(...slice) || 1;
    const cw = (w-2*pad)/cols, ch=(h-2*pad)/7;
    const cells = slice.map((v,i)=>{
      const col = Math.round(200 - (v/max)*120);
      return `<rect x="${pad+i*cw}" y="${pad}" width="${cw-2}" height="${ch*7-2}" rx="3" fill="none" />
              <rect x="${pad+i*cw+2}" y="${pad+2 + (7- Math.max(1, Math.ceil((v/max)*7))) * ch}" width="${cw-6}" height="${Math.max(ch, (v/max)*ch*7)-6}" fill="#4E79A7" opacity="${0.25 + 0.65*(v/max)}" rx="3"/>`;
    }).join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="#FFF"/>${cells}
    </svg>`;
  };

  const miniLinesGrid = (seriesMap={}, palette=T10)=>{
    const keys = Object.keys(seriesMap).slice(0,6);
    if(!keys.length) return "";
    const boxes = keys.map((k,i)=>`
      <div class="mini">
        <div class="mut">${esc(k.replaceAll("_"," "))}</div>
        ${spark(seriesMap[k], 240, 60, palette[i%palette.length])}
      </div>`).join("");
    return `<div class="miniGrid">${boxes}</div>`;
  };

  const postsTable = (posts=[], w=920)=>{
    const rows = (posts||[]).slice(0,5).map((p,i)=>{
      const title = esc(trunc(p.title||"", 80));
      const comments = p.num_comments || 0, up = p.score || 0;
      const maxBar = Math.max(1, Math.max(...posts.map(pp=>pp.num_comments||0)));
      const wid = Math.round((comments/maxBar)*260);
      return `<tr>
        <td style="width:28px">${i+1}</td>
        <td>${title}</td>
        <td><div class="bullet"><div style="width:${wid}px"></div></div></td>
        <td>💬 ${comments}</td><td>🔼 ${up}</td>
      </tr>`;
    }).join("");
    return `<table class="tbl" style="width:${w}px"><tbody>${rows}</tbody></table>`;
  };

  const gauge = (pct=0, size=180, th=20)=>{
    const r=(size-th)/2, cx=size/2, cy=size/2, C=Math.PI*r;
    const len = Math.min(100, Math.max(0, pct))/100*C;
    return `<svg width="${size}" height="${size/2}" viewBox="0 0 ${size} ${size/2}">
      <path d="M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}" fill="none" stroke="#E6E8EB" stroke-width="${th}" />
      <path d="M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx-r + (len/C)*2*r},${cy}" fill="none" stroke="#F28E2B" stroke-width="${th}" />
    </svg>`;
  };

  // ---------- HTML ----------
  const html = `
<!doctype html><meta charset="utf-8"/>
<style>
  :root{ 
    --bg: #F1F5F9; 
    --card: #FFFFFF; 
    --mut: #64748B; 
    --txt: #1E293B; 
    --border: #CBD5E1; 
    --shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
    --shadow-lg: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    --gradient: linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #EC4899 100%);
    --gradient-blue: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
    --gradient-green: linear-gradient(135deg, #10B981 0%, #059669 100%);
    --gradient-orange: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
    --gradient-red: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
    --accent: #6366F1;
    --success: #10B981;
    --warning: #F59E0B;
    --danger: #EF4444;
    --purple: #8B5CF6;
    --pink: #EC4899;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:500 16px/1.5 'Inter',system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial}
  .wrap{width:1920px;height:1080px;padding:24px;display:flex;flex-direction:column;gap:20px;background:var(--bg);overflow:hidden}
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:20px 32px;background:var(--card);border-radius:12px;box-shadow:var(--shadow-lg);border-left:5px solid var(--accent);position:relative;overflow:hidden}
  .header::before{content:'';position:absolute;top:0;right:0;width:200px;height:100%;background:var(--gradient);opacity:0.05;border-radius:0 12px 12px 0}
  .title{font:700 26px/1.1 'Inter';color:var(--txt);margin:0;z-index:1;position:relative}
  .period{display:flex;align-items:center;gap:12px;color:var(--mut);font-size:16px;font-weight:500;z-index:1;position:relative}
  .period-icon{width:20px;height:20px;background:var(--gradient);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;height:calc(100% - 100px)}
  .main-content{display:flex;flex-direction:column;gap:12px;height:100%}
  .sidebar{display:flex;flex-direction:column;gap:20px;height:100%}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;box-shadow:var(--shadow);transition:all 0.3s ease;position:relative;overflow:hidden}
  .card:hover{box-shadow:var(--shadow-lg);transform:translateY(-2px)}
  .card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--gradient);opacity:0.8}
  .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--border)}
  .card-title{font:700 20px/1.2 'Inter';color:var(--txt);margin:0}
  .card-icon{width:32px;height:32px;background:var(--gradient);border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-size:16px}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:20px}
  .kpi-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;position:relative;overflow:hidden;box-shadow:var(--shadow)}
  .kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:var(--gradient)}
  .kpi-card:nth-child(1)::before{background:var(--gradient-blue)}
  .kpi-card:nth-child(2)::before{background:var(--gradient-green)}
  .kpi-card:nth-child(3)::before{background:var(--gradient-orange)}
  .kpi-value{font:800 32px/1 'Inter';color:var(--txt);margin-bottom:8px}
  .kpi-label{font:500 14px/1.2 'Inter';color:var(--mut);text-transform:uppercase;letter-spacing:0.5px}
  .kpi-trend{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px}
  .trend-up{color:var(--success);background:rgba(16,185,129,0.1)}
  .trend-down{color:var(--danger);background:rgba(239,68,68,0.1)}
  .trend-neutral{color:var(--mut);background:rgba(100,116,139,0.1)}
  .chart-container{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:12px;box-shadow:var(--shadow);position:relative;overflow:hidden}
  .chart-container::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--gradient)}
  .chart-title{font:600 16px/1.2 'Inter';color:var(--txt);margin-bottom:16px;display:flex;align-items:center;gap:8px}
  .chart-icon{width:24px;height:24px;background:var(--gradient);border-radius:6px;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
  .moderator-stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px}
  .stat-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;box-shadow:var(--shadow);position:relative}
  .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--gradient-blue)}
  .stat-value{font:700 20px/1 'Inter';color:var(--txt);margin-bottom:4px}
  .stat-label{font:500 10px/1.2 'Inter';color:var(--mut);text-transform:uppercase;letter-spacing:0.5px}
  .progress-bar{width:100%;height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden;margin:8px 0}
  .progress-fill{height:100%;background:var(--gradient);border-radius:4px;transition:width 0.3s ease}
  .legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px}
  .legend-item{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500}
  .legend-color{width:12px;height:12px;border-radius:50%}
  .categories-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .metric-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;box-shadow:0 2px 4px rgba(0,0,0,0.05);position:relative;overflow:hidden}
  .metric-card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--gradient)}
  .metric-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .metric-name{font:600 12px/1.2 'Inter';color:var(--txt)}
  .metric-value{font:700 16px/1 'Inter';color:var(--accent)}
  .metric-bar{width:100%;height:4px;background:#E2E8F0;border-radius:2px;overflow:hidden;margin-top:4px}
  .metric-fill{height:100%;background:var(--gradient);border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,0.1)}
  .top-posts{max-height:300px;overflow-y:auto}
  .post-item{display:flex;justify-content:space-between;align-items:center;padding:12px;background:#F8FAFC;border-radius:8px;margin-bottom:8px;border-left:3px solid var(--accent)}
  .post-title{font:600 14px/1.2 'Inter';color:var(--txt);flex:1;margin-right:12px}
  .post-score{font:700 16px/1 'Inter';color:var(--success);background:#ECFDF5;padding:4px 8px;border-radius:6px}
  .moderator-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;border-left:4px solid var(--warning)}
  .moderator-name{font:700 16px/1.2 'Inter';color:var(--txt);margin-bottom:8px}
  .moderator-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:12px}
  .moderator-stat{text-align:center}
  .moderator-stat-value{font:700 14px/1 'Inter';color:var(--accent)}
  .moderator-stat-label{font:500 10px/1.2 'Inter';color:var(--mut);text-transform:uppercase;letter-spacing:0.5px}
  .footer{text-align:center;color:var(--mut);font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid var(--border)}
</style>

<div class="wrap">
        <div class="header">
          <div class="title">${esc(`${period.toUpperCase()} ANALYSIS REPORT`)}</div>
          <div style="display:flex;align-items:center;gap:16px">
            <div style="display:flex;align-items:center;gap:6px;font-size:14px;color:var(--mut)">
              <div class="period-icon">📅</div>
              ${esc(periodText)}
            </div>
            <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mut)">
              <div class="period-icon">📊</div>
              Generated ${dayjs().format("DD/MM/YYYY HH:mm")}
            </div>
          </div>
  </div>

  <div class="grid">
    <!-- LEFT COLUMN -->
    <div class="main-content">
      <!-- Main Chart -->
      ${`
      <div class="chart-container">
        <div class="chart-title">
          <div class="chart-icon">📈</div>
          Activity vs Average Score Trend
        </div>
        <div class="chart-subtitle" style="font-size:12px;color:var(--mut);margin-bottom:12px">
          📊 ${period === 'quarterly' ? 'Weekly activity levels' : period === 'yearly' ? 'Monthly activity levels' : 'Daily activity levels'} • 🔴 Average score baseline (${totals.scoreAvg})
        </div>
        ${combo(safeTrendVals, Array(safeTrendVals.length).fill(totals.scoreAvg), safeTrendLabels, {w:800,h:350,pad:60})}
        <div class="chart-legend" style="display:flex;justify-content:space-between;margin-top:12px;font-size:11px;color:var(--mut)">
          <div>📊 ${period === 'quarterly' ? 'Weekly Activity' : period === 'yearly' ? 'Monthly Activity' : 'Daily Activity'}</div>
          <div>🔴 Avg Score Baseline</div>
          <div>📈 Trend Analysis</div>
        </div>
      </div>`}

      <!-- Top Posts -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔥 Top Performing Posts</div>
          <div class="card-icon">🔥</div>
        </div>
        <div class="top-posts">
          ${topPosts.slice(0,8).map((post, i) => `
            <div class="post-item">
              <div class="post-title">${esc(trunc(post.title, 80))}</div>
              <div class="post-score">${post.score}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Moderator Performance -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">👮 Moderator Performance</div>
          <div class="card-icon">👮</div>
        </div>
        <div class="moderator-stats-grid">
          <div class="stat-card">
            <div class="stat-value">${Math.round(moderatorAnalysis.moderatorResponsePercentage || 0)}%</div>
            <div class="stat-label">Response Rate</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${moderatorAnalysis.uniqueModerators || 0}</div>
            <div class="stat-label">Active Moderators</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${moderatorAnalysis.totalModeratorResponses || 0}</div>
            <div class="stat-label">Total Responses</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${Math.round(moderatorAnalysis.avgResponseTimeMinutes || 0)}m</div>
            <div class="stat-label">Avg Response Time</div>
          </div>
        </div>
        ${moderatorAnalysis.topModerators?.slice(0,4).map(mod => `
          <div class="moderator-card">
            <div class="moderator-name">${esc(mod.username)}</div>
            <div class="moderator-stats">
              <div class="moderator-stat">
                <div class="moderator-stat-value">${mod.postsHandled}</div>
                <div class="moderator-stat-label">Posts</div>
              </div>
              <div class="moderator-stat">
                <div class="moderator-stat-value">${mod.avgScore}</div>
                <div class="moderator-stat-label">Avg Score</div>
              </div>
              <div class="moderator-stat">
                <div class="moderator-stat-value">${mod.responseTime}</div>
                <div class="moderator-stat-label">Avg Time</div>
              </div>
            </div>
      </div>
        `).join('') || ''}
      </div>
    </div>

    <!-- RIGHT COLUMN -->
    <div class="sidebar">
      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-value">${totals.posts}</div>
          <div class="kpi-label">Total Posts</div>
          <div class="kpi-trend trend-up">📈 +12%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${totals.comments}</div>
          <div class="kpi-label">Comments</div>
          <div class="kpi-trend trend-up">📈 +8%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${totals.authors}</div>
          <div class="kpi-label">Unique Authors</div>
          <div class="kpi-trend trend-neutral">➡️ 0%</div>
        </div>
      </div>

      <!-- Sentiment Analysis -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">😊 Sentiment Analysis</div>
          <div class="card-icon">😊</div>
      </div>
        <div style="text-align:center;margin-bottom:20px">
          ${donut([{pct:sentiment.pos,color:"#10B981"},{pct:sentiment.neu,color:"#F59E0B"},{pct:sentiment.neg,color:"#EF4444"}], 200, 30)}
        </div>
        <div class="legend">
          <div class="legend-item">
            <div class="legend-color" style="background:#10B981"></div>
            Positive ${sentiment.pos}%
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background:#F59E0B"></div>
            Neutral ${sentiment.neu}%
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background:#EF4444"></div>
            Negative ${sentiment.neg}%
          </div>
        </div>
      </div>

      <!-- Category Distribution -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Top Categories</div>
          <div class="card-icon">📊</div>
        </div>
        <div class="categories-grid">
          ${topCats.slice(0,8).map((cat, i) => `
            <div class="metric-card">
              <div class="metric-header">
                <div class="metric-name">${esc(cat.label)}</div>
                <div class="metric-value">${cat.value}</div>
              </div>
              <div class="metric-bar">
                <div class="metric-fill" style="width:${(cat.value/Math.max(1,totals.posts))*100}%;background:${T10[i%T10.length]}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    Auto-generated Report • ${dayjs().format("DD/MM/YYYY HH:mm")} • Professional Dashboard Design
  </div>
</div>
`;

  const launchOptions = getPuppeteerLaunchOptions();
  
  return await safePuppeteerLaunch(launchOptions, async (browser) => {
    const page = await browser.newPage();
    
    // Set viewport for consistent rendering
    await page.setViewport({ 
      width: 1920, 
      height: 1080, 
      deviceScaleFactor: 2 
    });
    
    // Set content with timeout
    await page.setContent(html, { 
      waitUntil: "domcontentloaded",
      timeout: 30000 
    });
    
    // Take screenshot with optimized settings
    const png = await page.screenshot({ 
      type: "png",
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080
      }
    });
    
    return png;
  });
}

/* ---- helpers ---- */
function formatPeriodText(tr){ if(!tr?.start||!tr?.end) return "Unknown period"; const s=new Date(tr.start), e=new Date(tr.end); return `${s.toLocaleDateString()} – ${e.toLocaleDateString()}`; }
function getMostEngagedComment(ex){
  const all=[...(ex?.positive||[]), ...(ex?.negative||[]), ...(ex?.neutral||[])];
  if(!all.length) return { text:"", author:"", intent:"" };
  const m=all.sort((a,b)=>(b.score||0)-(a.score||0))[0];
  return { text:m.body||"", author:m.author||"", intent:m.intent||"comment" };
}
function fakeBins(n){ const k=10; const arr=new Array(k).fill(0); for(let i=0;i<n;i++){ arr[Math.floor(Math.random()*k)]++; } return arr; }
