import dotenv from 'dotenv';
import { createDbConnection, closeDb } from './db.js';

dotenv.config();

console.log('🔄 Clearing AI Analysis Data (Preserving Posts & Comments) Starting...');

async function clearAnalysisOnly() {
    let pool = null;
    
    try {
        console.log('📡 Connecting to database...');
        pool = await createDbConnection();
        console.log('✅ Connected successfully');
        
        console.log('🗑️ Clearing AI analysis data (preserving posts & comments)...');
        
        // Drop only analysis tables
        await pool.query('DROP TABLE IF EXISTS analyses_comment CASCADE');
        console.log('  ✅ Dropped analyses_comment');
        
        await pool.query('DROP TABLE IF EXISTS analyses_post CASCADE');
        console.log('  ✅ Dropped analyses_post');
        
        console.log('🏗️ Creating fresh analysis tables...');
        
        // Create analyses_post table
        await pool.query(`
            CREATE TABLE analyses_post (
                post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
                intent TEXT CHECK (intent IN ('help','comment')),
                target TEXT CHECK (target IN ('faceit','not_faceit')),
                sentiment TEXT CHECK (sentiment IN ('pos','neg','neu')),
                category TEXT CHECK (category IN (
                    'account_recovery','verification','2fa','matchmaking_issues',
                    'afk_leaver_bans','smurfs','cheaters','customer_care',
                    'trust_and_safety','anti_cheat','payments_billing',
                    'technical_client','platform_website','tournaments_leagues',
                    'moderation_community','feature_request','other'
                )),
                summary TEXT,
                key_issues TEXT,
                llm_model TEXT,
                llm_tokens_in INTEGER,
                llm_tokens_out INTEGER,
                llm_cost_usd NUMERIC(10,6),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ Created analyses_post table');
        
        // Create analyses_comment table
        await pool.query(`
            CREATE TABLE analyses_comment (
                comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
                post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                sentiment TEXT CHECK (sentiment IN ('pos','neg','neu')),
                target TEXT CHECK (target IN ('faceit','not_faceit')),
                intent TEXT CHECK (intent IN ('help','comment')),
                llm_model TEXT,
                llm_tokens_in INTEGER,
                llm_tokens_out INTEGER,
                llm_cost_usd NUMERIC(10,6),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ Created analyses_comment table');
        
        console.log('🔍 Creating analysis indexes...');
        
        // Create analysis-specific indexes
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_post_sentiment ON analyses_post(sentiment)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_post_category ON analyses_post(category)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_post_intent ON analyses_post(intent)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_post_target ON analyses_post(target)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_comment_sentiment ON analyses_comment(sentiment)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_comment_intent ON analyses_comment(intent)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_analyses_comment_target ON analyses_comment(target)');
        
        console.log('✅ All analysis indexes created');
        
        // Reset analyzed flags on posts and comments
        console.log('🔄 Resetting analyzed flags...');
        
        const postsResult = await pool.query('UPDATE posts SET analyzed = false, analyzed_at = NULL');
        console.log(`  ✅ Reset analyzed flag for ${postsResult.rowCount} posts`);
        
        const commentsResult = await pool.query('UPDATE comments SET analyzed = false, analyzed_at = NULL');
        console.log(`  ✅ Reset analyzed flag for ${commentsResult.rowCount} comments`);
        
        // Get statistics
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM posts) as total_posts,
                (SELECT COUNT(*) FROM comments) as total_comments,
                (SELECT COUNT(*) FROM analyses_post) as analyzed_posts,
                (SELECT COUNT(*) FROM analyses_comment) as analyzed_comments
        `);
        
        const statsData = stats.rows[0];
        
        console.log('📊 Database Statistics:');
        console.log(`  📝 Total posts: ${statsData.total_posts}`);
        console.log(`  💬 Total comments: ${statsData.total_comments}`);
        console.log(`  🤖 Analyzed posts: ${statsData.analyzed_posts}`);
        console.log(`  🤖 Analyzed comments: ${statsData.analyzed_comments}`);
        
        // Verify tables
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('📋 All tables:', result.rows.map(row => row.table_name).join(', '));
        
        console.log('🎉 AI analysis data cleared successfully!');
        console.log('✅ Posts and comments preserved - ready for fresh AI analysis');
        console.log('🚀 Run AI analysis to process the existing data');
        
    } catch (error) {
        console.error('❌ Clear analysis failed:', error.message);
        process.exit(1);
    } finally {
        if (pool) {
            await closeDb();
            console.log('📴 Database connection closed');
        }
    }
}

// Run immediately
clearAnalysisOnly();
