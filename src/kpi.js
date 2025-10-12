import { query } from './db.js';
import FilterService from './filter.js';

class KPIService {
  constructor() {
    this.filter = new FilterService();
    console.log('📊 KPI service initialized');
  }

  /**
   * Build comprehensive report for a time window
   * @param {string} window - Time window: 'daily', 'weekly', 'monthly', 'quarterly'
   * @param {boolean} useKeywordFilter - Whether to apply keyword filtering to the report
   * @returns {Object} - Complete KPI report
   */
  async buildReport(window = 'daily', categories = null) {
    console.log(`📈 Building ${window} KPI report${categories ? ` with categories: ${categories.join(', ')}` : ''}...`);
    
    // Check if report filtering is enabled via environment variable
    const useKeywordFilter = process.env.ENABLE_REPORT_FILTERING === 'true';
    
    if (useKeywordFilter) {
      console.log(`🔍 Keyword filtering ENABLED for report (via ENABLE_REPORT_FILTERING=true)`);
    } else {
      console.log(`📊 Using ALL posts for report (ENABLE_REPORT_FILTERING=false or not set)`);
    }
    
    if (categories && categories.length > 0) {
      console.log(`🏷️ Category filtering ENABLED: ${categories.join(', ')}`);
    }
    
    try {
      const { startTime, endTime } = this.getTimeWindow(window);
      
      // Gather all metrics in parallel for better performance
      const [
        volumeMetrics,
        intentDistribution,
        postSentimentDistribution,
        commentSentimentDistribution,
        departmentDistribution,
        topPost,
        exampleComments,
        keyIssuesTrends,
        commentAnalysis
      ] = await Promise.all([
        this.getVolumeMetrics(startTime, endTime, useKeywordFilter, categories),
        this.getIntentDistribution(startTime, endTime, useKeywordFilter, categories),
        this.getSentimentDistribution(startTime, endTime, 'post', useKeywordFilter, categories),
        this.getSentimentDistribution(startTime, endTime, 'comment', useKeywordFilter, categories),
        this.getDepartmentDistribution(startTime, endTime, useKeywordFilter, categories),
        this.getTopPost(startTime, endTime, useKeywordFilter, categories),
        this.getExampleComments(startTime, endTime, useKeywordFilter, categories),
        this.getKeyIssuesTrends(startTime, endTime, useKeywordFilter, categories),
        this.getCommentAnalysis(startTime, endTime, useKeywordFilter, categories)
      ]);

      const report = {
        metadata: {
          window,
          useKeywordFilter,
          filterConfig: useKeywordFilter ? this.filter.getConfig() : null,
          period: {
            start: new Date(startTime * 1000).toISOString(),
            end: new Date(endTime * 1000).toISOString(),
            startTime,
            endTime
          },
          generatedAt: new Date().toISOString()
        },
        volume: volumeMetrics,
        intent: intentDistribution,
        sentiment: {
          posts: postSentimentDistribution,
          comments: commentSentimentDistribution
        },
        departments: departmentDistribution,
        topPost: topPost,
        examples: exampleComments,
        trends: keyIssuesTrends,
        commentAnalysis: commentAnalysis
      };

      console.log(`✅ ${window} KPI report generated successfully`);
      return report;
      
    } catch (error) {
      console.error(`❌ Error building ${window} KPI report:`, error);
      throw error;
    }
  }

  /**
   * Get volume metrics (post count, comment count, unique authors)
   */
  async getVolumeMetrics(startTime, endTime, useKeywordFilter = false, categories = null) {
    let queryText = `
      SELECT 
        COUNT(DISTINCT p.id) as post_count,
        COUNT(DISTINCT c.id) as comment_count,
        COUNT(DISTINCT p.author) as unique_post_authors,
        COUNT(DISTINCT c.author) as unique_comment_authors,
        COUNT(DISTINCT COALESCE(p.author, c.author)) as total_unique_authors
      FROM posts p
      FULL OUTER JOIN comments c ON p.id = c.post_id
      WHERE p.created_utc BETWEEN $1 AND $2
         OR c.created_utc BETWEEN $1 AND $2
    `;
    
    const params = [startTime, endTime];
    
    // Add category filtering if specified
    if (categories && categories.length > 0) {
      queryText += ` AND EXISTS (
        SELECT 1 FROM analyses_post ap 
        WHERE ap.post_id = p.id 
        AND ap.category = ANY($3)
      )`;
      params.push(categories);
    }
    
    // Add keyword filtering if enabled
    if (useKeywordFilter) {
      const includeKeywords = process.env.INCLUDE_KEYWORDS?.split(',').map(k => k.trim()) || [];
      const excludeKeywords = process.env.EXCLUDE_KEYWORDS?.split(',').map(k => k.trim()) || [];
      
      if (includeKeywords.length > 0) {
        const includePattern = includeKeywords.map(k => `'%${k}%'`).join(' OR ');
        queryText += ` AND (LOWER(p.title) LIKE ANY(ARRAY[${includePattern}]) OR LOWER(p.body) LIKE ANY(ARRAY[${includePattern}]))`;
      }
      
      if (excludeKeywords.length > 0) {
        const excludePattern = excludeKeywords.map(k => `'%${k}%'`).join(' OR ');
        queryText += ` AND NOT (LOWER(p.title) LIKE ANY(ARRAY[${excludePattern}]) OR LOWER(p.body) LIKE ANY(ARRAY[${excludePattern}]))`;
      }
    }
    
    const result = await query(queryText, params);

    const row = result.rows[0];
    return {
      posts: parseInt(row.post_count) || 0,
      comments: parseInt(row.comment_count) || 0,
      uniqueAuthors: parseInt(row.total_unique_authors) || 0,
      uniquePostAuthors: parseInt(row.unique_post_authors) || 0,
      uniqueCommentAuthors: parseInt(row.unique_comment_authors) || 0
    };
  }

  /**
   * Get intent distribution (help vs comment)
   */
  async getIntentDistribution(startTime, endTime, useKeywordFilter = false) {
    const postResult = await query(`
      SELECT 
        ap.intent,
        COUNT(*) as count
      FROM analyses_post ap
      JOIN posts p ON ap.post_id = p.id
      WHERE p.created_utc BETWEEN $1 AND $2
      GROUP BY ap.intent
      ORDER BY count DESC
    `, [startTime, endTime]);

    const commentResult = await query(`
      SELECT 
        ac.intent,
        COUNT(*) as count
      FROM analyses_comment ac
      JOIN comments c ON ac.comment_id = c.id
      JOIN posts p ON c.post_id = p.id
      WHERE p.created_utc BETWEEN $1 AND $2
      GROUP BY ac.intent
      ORDER BY count DESC
    `, [startTime, endTime]);

    return {
      posts: this.formatDistribution(postResult.rows),
      comments: this.formatDistribution(commentResult.rows)
    };
  }

  /**
   * Get sentiment distribution (pos/neg/neu for FACEIT-targeted content)
   */
  async getSentimentDistribution(startTime, endTime, type = 'post') {
    let queryText, table, joinCondition;
    
    if (type === 'post') {
      table = 'analyses_post ap';
      joinCondition = 'JOIN posts p ON ap.post_id = p.id';
      queryText = `
        SELECT 
          ap.sentiment,
          COUNT(*) as count
        FROM ${table}
        ${joinCondition}
        WHERE p.created_utc BETWEEN $1 AND $2
        GROUP BY ap.sentiment
        ORDER BY count DESC
      `;
    } else {
      table = 'analyses_comment ac';
      joinCondition = 'JOIN comments c ON ac.comment_id = c.id JOIN posts p ON c.post_id = p.id';
      queryText = `
        SELECT 
          ac.sentiment,
          COUNT(*) as count
        FROM ${table}
        ${joinCondition}
        WHERE p.created_utc BETWEEN $1 AND $2
        GROUP BY ac.sentiment
        ORDER BY count DESC
      `;
    }

    const result = await query(queryText, [startTime, endTime]);
    return this.formatDistribution(result.rows);
  }

  /**
   * Get category distribution (top 10 categories)
   */
  async getDepartmentDistribution(startTime, endTime) {
    const result = await query(`
      SELECT 
        ap.category as department,
        COUNT(*) as count
      FROM analyses_post ap
      JOIN posts p ON ap.post_id = p.id
      WHERE p.created_utc BETWEEN $1 AND $2
      AND ap.category IS NOT NULL
      GROUP BY ap.category
      ORDER BY count DESC
      LIMIT 10
    `, [startTime, endTime]);

    return this.formatDistribution(result.rows, 'department');
  }

  /**
   * Get top post by engagement (score + 2 * num_comments)
   */
  async getTopPost(startTime, endTime) {
    const result = await query(`
      SELECT 
        p.*,
        ap.sentiment,
        ap.summary,
        (p.score + 2 * p.num_comments) as engagement_score
      FROM posts p
      LEFT JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc BETWEEN $1 AND $2
      ORDER BY engagement_score DESC
      LIMIT 1
    `, [startTime, endTime]);

    if (result.rows.length === 0) {
      return null;
    }

    const post = result.rows[0];
    return {
      id: post.id,
      title: post.title,
      author: post.author,
      score: post.score,
      numComments: post.num_comments,
      engagementScore: post.engagement_score,
      sentiment: post.sentiment,
      summary: post.summary,
      url: `https://reddit.com${post.permalink}`,
      createdAt: new Date(post.created_utc * 1000).toISOString()
    };
  }

  /**
   * Get example positive and negative comments with more detailed analysis
   */
  async getExampleComments(startTime, endTime) {
    // Get positive examples (increased from 3 to 5)
    const positiveResult = await query(`
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        p.permalink,
        p.title as post_title,
        ac.sentiment,
        ac.intent,
        ac.summary
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE p.created_utc BETWEEN $1 AND $2
        AND ac.sentiment = 'pos'
        AND LENGTH(c.body) > 20
        AND LENGTH(c.body) < 300
      ORDER BY c.score DESC
      LIMIT 5
    `, [startTime, endTime]);

    // Get negative examples (increased from 3 to 5)
    const negativeResult = await query(`
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        p.permalink,
        p.title as post_title,
        ac.sentiment,
        ac.intent,
        ac.summary
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE p.created_utc BETWEEN $1 AND $2
        AND ac.sentiment = 'neg'
        AND LENGTH(c.body) > 20
        AND LENGTH(c.body) < 300
      ORDER BY c.score DESC
      LIMIT 5
    `, [startTime, endTime]);

    // Get neutral examples for better coverage
    const neutralResult = await query(`
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        p.permalink,
        p.title as post_title,
        ac.sentiment,
        ac.intent,
        ac.summary
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE p.created_utc BETWEEN $1 AND $2
        AND ac.sentiment = 'neu'
        AND LENGTH(c.body) > 20
        AND LENGTH(c.body) < 300
      ORDER BY c.score DESC
      LIMIT 3
    `, [startTime, endTime]);

    return {
      positive: positiveResult.rows.map(this.formatExampleComment),
      negative: negativeResult.rows.map(this.formatExampleComment),
      neutral: neutralResult.rows.map(this.formatExampleComment)
    };
  }

  /**
   * Get detailed comment analysis metrics
   */
  async getCommentAnalysis(startTime, endTime, useKeywordFilter = false, categories = null) {
    let queryText = `
      SELECT 
        COUNT(DISTINCT c.id) as total_comments,
        COUNT(DISTINCT CASE WHEN ac.sentiment = 'pos' THEN c.id END) as positive_comments,
        COUNT(DISTINCT CASE WHEN ac.sentiment = 'neg' THEN c.id END) as negative_comments,
        COUNT(DISTINCT CASE WHEN ac.sentiment = 'neu' THEN c.id END) as neutral_comments,
        COUNT(DISTINCT CASE WHEN ac.intent = 'help' THEN c.id END) as help_comments,
        COUNT(DISTINCT CASE WHEN ac.intent = 'comment' THEN c.id END) as discussion_comments,
        AVG(c.score) as avg_comment_score,
        COUNT(DISTINCT c.author) as unique_comment_authors
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE p.created_utc BETWEEN $1 AND $2
    `;
    
    const params = [startTime, endTime];
    
    // Add category filtering if specified
    if (categories && categories.length > 0) {
      queryText += ` AND EXISTS (
        SELECT 1 FROM analyses_post ap 
        WHERE ap.post_id = p.id 
        AND ap.category = ANY($3)
      )`;
      params.push(categories);
    }
    
    // Add keyword filtering if enabled
    if (useKeywordFilter) {
      const includeKeywords = process.env.INCLUDE_KEYWORDS?.split(',').map(k => k.trim()) || [];
      const excludeKeywords = process.env.EXCLUDE_KEYWORDS?.split(',').map(k => k.trim()) || [];
      
      if (includeKeywords.length > 0) {
        const includePattern = includeKeywords.map(k => `'%${k}%'`).join(' OR ');
        queryText += ` AND (LOWER(p.title) LIKE ANY(ARRAY[${includePattern}]) OR LOWER(p.body) LIKE ANY(ARRAY[${includePattern}]))`;
      }
      
      if (excludeKeywords.length > 0) {
        const excludePattern = excludeKeywords.map(k => `'%${k}%'`).join(' OR ');
        queryText += ` AND NOT (LOWER(p.title) LIKE ANY(ARRAY[${excludePattern}]) OR LOWER(p.body) LIKE ANY(ARRAY[${excludePattern}]))`;
      }
    }
    
    const result = await query(queryText, params);
    const row = result.rows[0];
    
    return {
      totalComments: parseInt(row.total_comments) || 0,
      positiveComments: parseInt(row.positive_comments) || 0,
      negativeComments: parseInt(row.negative_comments) || 0,
      neutralComments: parseInt(row.neutral_comments) || 0,
      helpComments: parseInt(row.help_comments) || 0,
      discussionComments: parseInt(row.discussion_comments) || 0,
      avgCommentScore: parseFloat(row.avg_comment_score) || 0,
      uniqueCommentAuthors: parseInt(row.unique_comment_authors) || 0
    };
  }
  async getKeyIssuesTrends(startTime, endTime) {
    const result = await query(`
      SELECT 
        issue.value as issue,
        COUNT(*) as count
      FROM analyses_post ap
      JOIN posts p ON ap.post_id = p.id
      CROSS JOIN LATERAL json_array_elements_text(ap.key_issues::json) as issue(value)
      WHERE p.created_utc BETWEEN $1 AND $2
      GROUP BY issue.value
      ORDER BY count DESC
      LIMIT 5
    `, [startTime, endTime]);

    return result.rows.map(row => ({
      issue: row.issue,
      count: parseInt(row.count),
      percentage: 0 // Will be calculated later if needed
    }));
  }

  /**
   * Format distribution data
   */
  formatDistribution(rows, keyField = null) {
    const total = rows.reduce((sum, row) => sum + parseInt(row.count), 0);
    
    return rows.map(row => ({
      [keyField || Object.keys(row)[0]]: row[Object.keys(row)[0]],
      count: parseInt(row.count),
      percentage: total > 0 ? Math.round((parseInt(row.count) / total) * 100) : 0
    }));
  }

  /**
   * Format example comment with enhanced details
   */
  formatExampleComment(comment) {
    return {
      id: comment.id,
      body: comment.body.length > 150 ? comment.body.substring(0, 147) + '...' : comment.body,
      author: comment.author,
      score: comment.score,
      postTitle: comment.post_title,
      url: `https://reddit.com${comment.permalink}`,
      sentiment: comment.sentiment,
      intent: comment.intent,
      summary: comment.summary
    };
  }

  /**
   * Get time window boundaries
   */
  getTimeWindow(window) {
    const now = Math.floor(Date.now() / 1000);
    let startTime;
    
    switch (window) {
      case 'daily':
        startTime = now - (24 * 60 * 60); // 24 hours ago
        break;
      case 'weekly':
        startTime = now - (7 * 24 * 60 * 60); // 7 days ago
        break;
      case 'monthly':
        startTime = now - (30 * 24 * 60 * 60); // 30 days ago
        break;
      case 'quarterly':
        startTime = now - (90 * 24 * 60 * 60); // 90 days ago
        break;
      default:
        throw new Error(`Unknown time window: ${window}`);
    }
    
    return { startTime, endTime: now };
  }

  /**
   * Get summary statistics for the report
   */
  async getSummaryStats(startTime, endTime) {
    const result = await query(`
      SELECT 
        COUNT(DISTINCT ap.post_id) as analyzed_posts,
        COUNT(DISTINCT ac.comment_id) as analyzed_comments,
        COALESCE(SUM(ap.llm_cost_usd), 0) + COALESCE(SUM(ac.llm_cost_usd), 0) as total_cost,
        COALESCE(SUM(ap.llm_tokens_in + ap.llm_tokens_out), 0) + 
        COALESCE(SUM(ac.llm_tokens_in + ac.llm_tokens_out), 0) as total_tokens
      FROM analyses_post ap
      FULL OUTER JOIN analyses_comment ac ON ap.created_at::date = ac.created_at::date
      JOIN posts p ON (ap.post_id = p.id OR ac.post_id = p.id)
      WHERE p.created_utc BETWEEN $1 AND $2
    `, [startTime, endTime]);

    const row = result.rows[0];
    return {
      analyzedPosts: parseInt(row.analyzed_posts) || 0,
      analyzedComments: parseInt(row.analyzed_comments) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      totalTokens: parseInt(row.total_tokens) || 0
    };
  }

  /**
   * Generate a text summary of key findings with enhanced comment coverage
   */
  generateSummary(report) {
    const summaryPoints = [];
    
    // Volume summary with comment details
    summaryPoints.push(`📊 Analyzed ${report.volume.posts} posts and ${report.volume.comments} comments from ${report.volume.uniqueAuthors} unique users`);
    
    // Comment analysis summary
    if (report.commentAnalysis && report.commentAnalysis.totalComments > 0) {
      const commentAnalysis = report.commentAnalysis;
      const posPercent = Math.round((commentAnalysis.positiveComments / commentAnalysis.totalComments) * 100);
      const negPercent = Math.round((commentAnalysis.negativeComments / commentAnalysis.totalComments) * 100);
      const helpPercent = Math.round((commentAnalysis.helpComments / commentAnalysis.totalComments) * 100);
      
      summaryPoints.push(`💬 Comments: ${posPercent}% positive, ${negPercent}% negative sentiment. ${helpPercent}% were help requests`);
      summaryPoints.push(`📈 Comment engagement: Avg score ${Math.round(commentAnalysis.avgCommentScore)} from ${commentAnalysis.uniqueCommentAuthors} authors`);
    }
    
    // Intent summary
    const helpPosts = report.intent.posts.find(i => i.intent === 'help')?.count || 0;
    const totalPosts = report.intent.posts.reduce((sum, i) => sum + i.count, 0);
    if (totalPosts > 0) {
      const helpPercentage = Math.round((helpPosts / totalPosts) * 100);
      summaryPoints.push(`🆘 ${helpPercentage}% of posts were help requests (${helpPosts}/${totalPosts})`);
    }
    
    // Sentiment summary
    const negPosts = report.sentiment.posts.find(s => s.sentiment === 'neg')?.count || 0;
    const totalSentimentPosts = report.sentiment.posts.reduce((sum, s) => sum + s.count, 0);
    if (totalSentimentPosts > 0) {
      const negPercentage = Math.round((negPosts / totalSentimentPosts) * 100);
      summaryPoints.push(`😟 ${negPercentage}% of posts had negative sentiment toward FACEIT`);
    }
    
    return summaryPoints.slice(0, 4); // Return top 4 summary points
  }
}

export default KPIService;
