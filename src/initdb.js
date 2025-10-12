import dotenv from 'dotenv';
import { createDbConnection, closeDb } from './db.js';

dotenv.config();

const createTables = async () => {
  let pool = null;
  
  try {
    console.log('🗄️ Initializing database tables...');
    pool = await createDbConnection();
    
    // Create posts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
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
        category TEXT, -- for FACEIT issue categorization
        analyzed BOOLEAN DEFAULT FALSE,
        analyzed_at TIMESTAMP,
        comments_updated_at TIMESTAMP, -- track last comment/vote update
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Posts table created/verified');

    // Create comments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
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
    console.log('✅ Comments table created/verified');

    // Create analyses_post table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analyses_post (
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
        summary TEXT,     -- short abstractive summary
        key_issues TEXT,  -- JSON array of bullet items
        llm_model TEXT,
        llm_tokens_in INTEGER,
        llm_tokens_out INTEGER,
        llm_cost_usd NUMERIC(10,6),
        post_created_utc BIGINT,  -- actual post creation date from Reddit
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Post analyses table created/verified');

    // Create analyses_comment table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analyses_comment (
        comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        sentiment TEXT CHECK (sentiment IN ('pos','neg','neu')),
        target TEXT CHECK (target IN ('faceit','not_faceit')),
        intent TEXT CHECK (intent IN ('help','comment')),
        category TEXT CHECK (category IN (
          'account_recovery','verification','2fa','matchmaking_issues',
          'game_registration_issues','afk_leaver_bans','griefing',
          'verbal_abuse','smurfs','cheaters','anti_cheat','subscriptions',
          'faceit_shop','technical_client','platform_website',
          'steam_issues_game_update','tournaments_leagues','esea',
          'mission','moderation_community','feature_request',
          'track_stats','ow2','dota2','legal_issues_gdpr','other'
        )),
        summary TEXT,     -- short abstractive summary
        key_issues TEXT,  -- JSON array of bullet items
        llm_model TEXT,
        llm_tokens_in INTEGER,
        llm_tokens_out INTEGER,
        llm_cost_usd NUMERIC(10,6),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Comment analyses table created/verified');

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_created_utc ON posts(created_utc);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_analyzed ON posts(analyzed);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_comments_analyzed ON comments(analyzed);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_post_sentiment ON analyses_post(sentiment);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_post_category ON analyses_post(category);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_comment_sentiment ON analyses_comment(sentiment);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_post_created_at ON analyses_post(created_at);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_comment_created_at ON analyses_comment(created_at);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_comments_updated_at ON posts(comments_updated_at);
    `);
    console.log('✅ Database indexes created/verified');

    // Test the database by querying table info
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('posts', 'comments', 'analyses_post', 'analyses_comment')
      ORDER BY table_name;
    `);
    
    console.log('📋 Created tables:', result.rows.map(row => row.table_name).join(', '));
    console.log('🎉 Database initialization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    if (pool) {
      await closeDb();
    }
  }
};

// Utility function to calculate upvotes/downvotes from score and ratio
export const calculateVotes = (score, upvoteRatio) => {
  if (!upvoteRatio || upvoteRatio <= 0 || upvoteRatio >= 1) {
    return { approxUpvotes: null, approxDownvotes: null };
  }
  
  const denominator = 2 * upvoteRatio - 1;
  if (denominator <= 0) {
    return { approxUpvotes: null, approxDownvotes: null };
  }
  
  const totalVotes = score / denominator;
  const approxUpvotes = Math.round(upvoteRatio * totalVotes);
  const approxDownvotes = Math.round((1 - upvoteRatio) * totalVotes);
  
  return { approxUpvotes, approxDownvotes };
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createTables()
    .then(() => {
      console.log('✅ Database setup complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database setup failed:', error);
      process.exit(1);
    });
}

export { createTables };
