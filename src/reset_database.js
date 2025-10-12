import dotenv from 'dotenv';
import { createDbConnection, closeDb } from './db.js';

dotenv.config();

console.log('🔄 Simple Database Reset Starting...');

async function simpleReset() {
    let pool = null;
    
    try {
        console.log('📡 Connecting to database...');
        pool = await createDbConnection();
        console.log('✅ Connected successfully');
        
        console.log('🗑️ Dropping tables...');
        
        // Drop tables in correct order
        await pool.query('DROP TABLE IF EXISTS analyses_comment CASCADE');
        console.log('  ✅ Dropped analyses_comment');
        
        await pool.query('DROP TABLE IF EXISTS analyses_post CASCADE');
        console.log('  ✅ Dropped analyses_post');
        
        await pool.query('DROP TABLE IF EXISTS comments CASCADE');
        console.log('  ✅ Dropped comments');
        
        await pool.query('DROP TABLE IF EXISTS posts CASCADE');
        console.log('  ✅ Dropped posts');
        
        console.log('🏗️ Creating fresh tables...');
        
        // Create posts table
        await pool.query(`
            CREATE TABLE posts (
                id TEXT PRIMARY KEY,
                created_utc BIGINT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                author TEXT NOT NULL,
                permalink TEXT NOT NULL,
                link_flair_text TEXT,
                score INTEGER DEFAULT 0,
                upvote_ratio REAL,
                approx_upvotes INTEGER,
                approx_downvotes INTEGER,
                num_comments INTEGER DEFAULT 0,
                category TEXT,
                analyzed BOOLEAN DEFAULT FALSE,
                analyzed_at TIMESTAMP,
                comments_updated_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ Created posts table');
        
        // Create comments table
        await pool.query(`
            CREATE TABLE comments (
                id TEXT PRIMARY KEY,
                post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                created_utc BIGINT NOT NULL,
                body TEXT NOT NULL,
                author TEXT NOT NULL,
                score INTEGER DEFAULT 0,
                distinguished TEXT, -- Reddit moderator/admin distinction
                analyzed BOOLEAN DEFAULT FALSE,
                analyzed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ Created comments table');
        
        // Create analyses_post table
        await pool.query(`
            CREATE TABLE analyses_post (
                post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
                intent TEXT CHECK (intent IN ('help','comment')),
                target TEXT CHECK (target IN ('faceit','not_faceit')),
                sentiment TEXT CHECK (sentiment IN ('pos','neg','neu')),
                category TEXT,
                summary TEXT,
                key_issues TEXT,
                llm_model TEXT,
                llm_tokens_in INTEGER,
                llm_tokens_out INTEGER,
                llm_cost_usd NUMERIC(10,6),
                post_created_utc BIGINT,  -- actual post creation date from Reddit
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
        
        console.log('🔍 Creating indexes...');
        
        // Create essential indexes
        await pool.query('CREATE INDEX idx_posts_created_utc ON posts(created_utc)');
        await pool.query('CREATE INDEX idx_posts_analyzed ON posts(analyzed)');
        await pool.query('CREATE INDEX idx_posts_category ON posts(category)');
        await pool.query('CREATE INDEX idx_comments_post_id ON comments(post_id)');
        await pool.query('CREATE INDEX idx_comments_analyzed ON comments(analyzed)');
        await pool.query('CREATE INDEX idx_analyses_post_sentiment ON analyses_post(sentiment)');
        await pool.query('CREATE INDEX idx_analyses_post_category ON analyses_post(category)');
        
        console.log('✅ All indexes created');
        
        // Verify tables
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('📋 Tables created:', result.rows.map(row => row.table_name).join(', '));
        
        console.log('🎉 Database reset completed successfully!');
        
    } catch (error) {
        console.error('❌ Reset failed:', error.message);
        process.exit(1);
    } finally {
        if (pool) {
            await closeDb();
            console.log('📴 Database connection closed');
        }
    }
}

// Run immediately
simpleReset();
