import dotenv from 'dotenv';
import snoowrap from 'snoowrap';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import BULK_FETCH_CONFIG from './bulk_fetch_config.js';
import ModeratorTrackingService from './moderator_tracking.js';
import ModeratorDetectionService from './moderator_detection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

/**
 * Bulk Reddit Data Fetcher
 * Fetches posts and comments from January 1st to September 15th, 2025
 * Ensures proper post-comment relationships for AI analysis
 */
class BulkRedditFetcher {
  constructor() {
    // Debug: Check if Reddit credentials are available
    const requiredEnvVars = ['REDDIT_USER_AGENT', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_REFRESH_TOKEN'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ Missing Reddit environment variables:', missingVars.join(', '));
      console.error('Please check your .env file and ensure all Reddit credentials are set.');
      throw new Error(`Missing Reddit credentials: ${missingVars.join(', ')}`);
    }

    this.reddit = new snoowrap({
      userAgent: process.env.REDDIT_USER_AGENT,
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      refreshToken: process.env.REDDIT_REFRESH_TOKEN
    });

    this.pool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
    });

    this.startDate = new Date(BULK_FETCH_CONFIG.START_DATE);
    this.endDate = new Date(BULK_FETCH_CONFIG.END_DATE);
    
    this.moderatorTracking = new ModeratorTrackingService();
    this.moderatorDetection = new ModeratorDetectionService();
    
    this.stats = {
      postsProcessed: 0,
      commentsProcessed: 0,
      postsSkipped: 0,
      commentsSkipped: 0,
      errors: 0
    };
  }

  /**
   * Main execution method
   */
  async fetchAllData() {
    try {
      console.log('🚀 Starting bulk Reddit data fetch...');
      console.log(`📅 Date range: ${this.startDate.toISOString()} to ${this.endDate.toISOString()}`);
      
      await this.testConnection();
      
      // Fetch posts in batches by month
      const months = this.getMonthsInRange();
      
      for (const month of months) {
        console.log(`\n📊 Processing month: ${month.name}`);
        await this.fetchPostsForMonth(month);
        
        // Rate limiting between months
        console.log(`⏰ Waiting ${BULK_FETCH_CONFIG.DELAY_BETWEEN_MONTHS / 1000} seconds before next month...`);
        await this.sleep(BULK_FETCH_CONFIG.DELAY_BETWEEN_MONTHS);
      }
      
      this.printFinalStats();
      
    } catch (error) {
      console.error('❌ Bulk fetch failed:', error);
      throw error;
    } finally {
      await this.pool.end();
    }
  }

  /**
   * Test database and Reddit connections
   */
  async testConnection() {
    try {
      console.log('🔍 Testing connections...');
      
      // Test database
      await this.pool.query('SELECT 1');
      console.log('✅ Database connection successful');
      
      // Test Reddit API
      const testSubreddit = await this.reddit.getSubreddit('FACEITcom');
      console.log('✅ Reddit API connection successful');
      
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      throw error;
    }
  }

  /**
   * Get list of months in the date range
   */
  getMonthsInRange() {
    const months = [];
    const current = new Date(this.startDate);
    
    while (current <= this.endDate) {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59);
      
      // Adjust for our actual date range
      const actualStart = monthStart < this.startDate ? this.startDate : monthStart;
      const actualEnd = monthEnd > this.endDate ? this.endDate : monthEnd;
      
      months.push({
        name: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
        start: actualStart,
        end: actualEnd
      });
      
      current.setMonth(current.getMonth() + 1);
    }
    
    return months;
  }

  /**
   * Fetch posts for a specific month
   */
  async fetchPostsForMonth(month) {
    try {
      console.log(`📅 Fetching posts for ${month.name}...`);
      
      const subreddit = await this.reddit.getSubreddit('FACEITcom');
      
      // Get posts from the month
      const posts = await subreddit.getNew({
        time: 'all',
        limit: BULK_FETCH_CONFIG.POSTS_PER_BATCH
      });
      
      console.log(`📊 Found ${posts.length} posts to process`);
      
      let monthStats = {
        postsProcessed: 0,
        commentsProcessed: 0,
        postsSkipped: 0,
        commentsSkipped: 0
      };
      
      for (const post of posts) {
        try {
          // Check if post is within our date range
          const postDate = new Date(post.created_utc * 1000);
          if (postDate < month.start || postDate > month.end) {
            if (BULK_FETCH_CONFIG.VERBOSE_LOGGING) {
              console.log(`⏭️ Skipping post ${post.id} - date ${postDate.toISOString()} outside range ${month.start.toISOString()} to ${month.end.toISOString()}`);
            }
            monthStats.postsSkipped++;
            continue;
          }
          
          // Check if post already exists
          const exists = await this.postExists(post.id);
          if (exists) {
            if (BULK_FETCH_CONFIG.VERBOSE_LOGGING) {
              console.log(`⏭️ Skipping post ${post.id} - already exists in database`);
            }
            monthStats.postsSkipped++;
            continue;
          }
          
          // Process the post
          await this.processPost(post);
          monthStats.postsProcessed++;
          
          // Fetch and process comments for this post
          const commentCount = await this.processPostComments(post);
          monthStats.commentsProcessed += commentCount;
          
          // Rate limiting between posts
          await this.sleep(BULK_FETCH_CONFIG.DELAY_BETWEEN_POSTS);
          
        } catch (error) {
          console.error(`❌ Error processing post ${post.id}:`, error.message);
          this.stats.errors++;
        }
      }
      
      console.log(`✅ Month ${month.name} completed:`);
      console.log(`   Posts processed: ${monthStats.postsProcessed}`);
      console.log(`   Comments processed: ${monthStats.commentsProcessed}`);
      console.log(`   Posts skipped: ${monthStats.postsSkipped}`);
      console.log(`   Comments skipped: ${monthStats.commentsSkipped}`);
      
      // Update global stats
      this.stats.postsProcessed += monthStats.postsProcessed;
      this.stats.commentsProcessed += monthStats.commentsProcessed;
      this.stats.postsSkipped += monthStats.postsSkipped;
      this.stats.commentsSkipped += monthStats.commentsSkipped;
      
    } catch (error) {
      console.error(`❌ Error fetching posts for month ${month.name}:`, error);
      throw error;
    }
  }

  /**
   * Process a single post
   */
  async processPost(post) {
    try {
      const postData = {
        id: post.id,
        created_utc: post.created_utc,
        title: post.title,
        body: post.selftext || '',
        author: post.author ? post.author.name : '[deleted]',
        permalink: post.permalink,
        link_flair_text: post.link_flair_text,
        score: parseInt(post.score) || 0,
        upvote_ratio: parseFloat(post.upvote_ratio) || 0.0,
        approx_upvotes: Math.round((parseInt(post.score) || 0) * (parseFloat(post.upvote_ratio) || 0)) || 0,
        approx_downvotes: Math.round((parseInt(post.score) || 0) * (1 - (parseFloat(post.upvote_ratio) || 0))) || 0,
        num_comments: parseInt(post.num_comments) || 0
      };
      
      await this.savePost(postData);
      console.log(`📝 Saved post: ${post.id} - "${post.title.substring(0, 50)}..."`);
      
    } catch (error) {
      console.error(`❌ Error processing post ${post.id}:`, error);
      throw error;
    }
  }

  /**
   * Process comments for a post
   */
  async processPostComments(post) {
    try {
      // Expand replies to get comments
      await post.expandReplies({ limit: Infinity, depth: 1 });
      
      const comments = [];
      const maxComments = BULK_FETCH_CONFIG.MAX_COMMENTS_PER_POST;
      
      // Get top-level comments and sort by score
      const topComments = post.comments
        .filter(comment => comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]')
        .sort((a, b) => b.score - a.score)
        .slice(0, maxComments);
      
      console.log(`💬 Processing ${topComments.length} comments for post ${post.id}`);
      
      for (const comment of topComments) {
        try {
          const author = comment.author ? comment.author.name : '[deleted]';
          
          // Check if author is a moderator (regardless of Reddit's distinguished field)
          const isModerator = await this.moderatorDetection.isModerator(author);
          
          const commentData = {
            id: comment.id,
            post_id: post.id, // Ensure post-comment relationship
            created_utc: comment.created_utc,
            body: comment.body,
            author: author,
            score: comment.score,
            distinguished: isModerator ? 'moderator' : (comment.distinguished || null)
          };
          
          // Check if comment already exists
          const exists = await this.commentExists(comment.id);
          if (!exists) {
            await this.saveComment(commentData);
            comments.push(commentData);
          }
          
        } catch (error) {
          console.error(`❌ Error processing comment ${comment.id}:`, error.message);
        }
      }
      
      console.log(`✅ Saved ${comments.length} comments for post ${post.id}`);
      return comments.length;
      
    } catch (error) {
      console.error(`❌ Error fetching comments for post ${post.id}:`, error);
      return 0;
    }
  }

  /**
   * Save post to database
   */
  async savePost(postData) {
    const queryText = `
      INSERT INTO posts (
        id, created_utc, created_at, title, body, author, permalink, link_flair_text,
        score, upvote_ratio, approx_upvotes, approx_downvotes, num_comments
      ) VALUES ($1, $2, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        score = EXCLUDED.score,
        upvote_ratio = EXCLUDED.upvote_ratio,
        approx_upvotes = EXCLUDED.approx_upvotes,
        approx_downvotes = EXCLUDED.approx_downvotes,
        num_comments = EXCLUDED.num_comments,
        comments_updated_at = NOW()
    `;
    
    const values = [
      postData.id,
      postData.created_utc,
      postData.title,
      postData.body,
      postData.author,
      postData.permalink,
      postData.link_flair_text,
      postData.score,
      postData.upvote_ratio,
      postData.approx_upvotes,
      postData.approx_downvotes,
      postData.num_comments
    ];
    
    await this.pool.query(queryText, values);
  }

  /**
   * Save comment to database
   */
  async saveComment(commentData) {
    const queryText = `
      INSERT INTO comments (
        id, post_id, created_utc, created_at, body, author, score, distinguished
      ) VALUES ($1, $2, $3, to_timestamp($3), $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        score = EXCLUDED.score,
        distinguished = EXCLUDED.distinguished
    `;
    
    const values = [
      commentData.id,
      commentData.post_id,
      commentData.created_utc,
      commentData.body,
      commentData.author,
      commentData.score,
      commentData.distinguished
    ];
    
    await this.pool.query(queryText, values);
  }

  /**
   * Check if post already exists
   */
  async postExists(postId) {
    const result = await this.pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    return result.rows.length > 0;
  }

  /**
   * Check if comment already exists
   */
  async commentExists(commentId) {
    const result = await this.pool.query('SELECT 1 FROM comments WHERE id = $1', [commentId]);
    return result.rows.length > 0;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Print final statistics
   */
  printFinalStats() {
    console.log('\n🎉 Bulk fetch completed!');
    console.log('📊 Final Statistics:');
    console.log(`   Posts processed: ${this.stats.postsProcessed}`);
    console.log(`   Comments processed: ${this.stats.commentsProcessed}`);
    console.log(`   Posts skipped: ${this.stats.postsSkipped}`);
    console.log(`   Comments skipped: ${this.stats.commentsSkipped}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`   Total data points: ${this.stats.postsProcessed + this.stats.commentsProcessed}`);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('bulk_fetch_reddit.js')) {
  const fetcher = new BulkRedditFetcher();
  
  fetcher.fetchAllData()
    .then(() => {
      console.log('✅ Bulk fetch script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Bulk fetch script failed:', error);
      process.exit(1);
    });
}

export { BulkRedditFetcher };
