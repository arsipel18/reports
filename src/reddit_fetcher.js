import dotenv from 'dotenv';
import snoowrap from 'snoowrap';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import ModeratorTrackingService from './moderator_tracking.js';
import ModeratorDetectionService from './moderator_detection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

/**
 * Realistic Reddit Data Fetcher
 * Fetches recent posts and comments (Reddit API limitations prevent historical data)
 */
class RealisticRedditFetcher {
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
  async fetchRecentData(keepPoolAlive = false) {
    try {
      console.log('🚀 Starting realistic Reddit data fetch...');
      console.log('📝 Note: Reddit API has limitations for historical data');
      console.log('📊 Fetching recent posts and comments from r/FACEITcom');
      
      await this.testConnection();
      
      // Fetch posts using multiple methods for maximum coverage
      const posts = await this.fetchPostsWithMultipleMethods();
      await this.processPosts(posts);
      
      this.printFinalStats();
      
    } catch (error) {
      console.error('❌ Fetch failed:', error);
      throw error;
    } finally {
      // Only close pool if not requested to keep it alive (for schedulers)
      if (!keepPoolAlive) {
        await this.pool.end();
      }
    }
  }

  /**
   * Main execution method that includes both fetching new data and updating existing posts
   */
  async fetchAndUpdateData(keepPoolAlive = false) {
    try {
      console.log('🚀 Starting comprehensive Reddit data fetch and update...');
      console.log('📝 Note: Reddit API has limitations for historical data');
      console.log('📊 Fetching recent posts and comments from r/FACEITcom');
      
      await this.testConnection();
      
      // First, update existing posts with latest data
      console.log('\n🔄 Phase 1: Updating existing posts...');
      await this.updateExistingPosts(true); // Keep pool alive
      
      // Then, fetch new posts
      console.log('\n📥 Phase 2: Fetching new posts...');
      const posts = await this.fetchPostsWithMultipleMethods();
      await this.processPosts(posts);
      
      this.printFinalStats();
      
    } catch (error) {
      console.error('❌ Fetch and update failed:', error);
      throw error;
    } finally {
      // Only close pool if not requested to keep it alive (for schedulers)
      if (!keepPoolAlive) {
        await this.pool.end();
      }
    }
  }

  /**
   * Update existing posts with latest data (votes, comments, moderator activity)
   */
  async updateExistingPosts(keepPoolAlive = false) {
    try {
      console.log('🔄 Starting update of existing Reddit posts...');
      console.log('📊 Updating votes, comments, and moderator activity for recent posts');
      
      // Get recent posts from database that need updates (last 7 days)
      const sevenDaysAgo = Math.floor((Date.now() - (7 * 24 * 60 * 60 * 1000)) / 1000);
      const recentPosts = await this.getRecentPostsForUpdate(sevenDaysAgo);
      
      console.log(`🔍 Found ${recentPosts.length} recent posts to update`);
      
      if (recentPosts.length === 0) {
        console.log('✅ No recent posts need updating');
        return;
      }

      // Update posts in smaller batches to avoid rate limiting
      const batchSize = 25; // Reduced batch size
      let updatedCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < recentPosts.length; i += batchSize) {
        const batch = recentPosts.slice(i, i + batchSize);
        console.log(`🔄 Updating batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(recentPosts.length/batchSize)} (${batch.length} posts)`);
        
        for (const post of batch) {
          try {
            await this.updateSinglePost(post);
            updatedCount++;
            
            // Rate limiting between posts
            await this.sleep(1000); // Increased delay
            
          } catch (error) {
            console.error(`❌ Failed to update post ${post.id}:`, error.message);
            errorCount++;
            this.stats.errors++;
            
            // If we get too many errors, slow down more
            if (errorCount > 5) {
              console.log('⚠️ High error rate detected, increasing delays...');
              await this.sleep(3000);
            }
          }
        }
        
        // Longer pause between batches
        console.log(`⏸️ Pausing between batches...`);
        await this.sleep(5000); // Increased batch delay
        
        // Reset error count after successful batch
        if (errorCount > 0) {
          console.log(`📊 Batch completed with ${errorCount} errors`);
          errorCount = 0;
        }
      }
      
      console.log(`✅ Updated ${updatedCount}/${recentPosts.length} posts successfully`);
      console.log(`📊 Total errors encountered: ${this.stats.errors}`);
      
    } catch (error) {
      console.error('❌ Update existing posts failed:', error);
      throw error;
    } finally {
      // Only close pool if not requested to keep it alive (for schedulers)
      if (!keepPoolAlive) {
        await this.pool.end();
      }
    }
  }

  /**
   * Get recent posts from database that need updates
   */
  async getRecentPostsForUpdate(sinceTimestamp) {
    const queryText = `
      SELECT id, created_utc, title, num_comments, score 
      FROM posts 
      WHERE created_utc >= $1 
      ORDER BY created_utc DESC
      LIMIT 500
    `;
    
    const result = await this.pool.query(queryText, [sinceTimestamp]);
    return result.rows;
  }

  /**
   * Update a single post with latest Reddit data
   */
  async updateSinglePost(postData) {
    try {
      console.log(`🔄 Updating post ${postData.id}...`);
      
      // Get updated post data from Reddit
      const submission = await this.reddit.getSubmission(postData.id);
      
      // Await the properties since snoowrap returns promises
      const score = parseInt(await submission.score) || 0;
      const upvoteRatio = parseFloat(await submission.upvote_ratio) || 0.0;
      const numComments = parseInt(await submission.num_comments) || 0;
      
      // Update post metadata with safe calculations
      const updatedData = {
        id: postData.id,
        score: score,
        upvote_ratio: upvoteRatio,
        approx_upvotes: Math.round(score * upvoteRatio) || 0,
        approx_downvotes: Math.round(score * (1 - upvoteRatio)) || 0,
        num_comments: numComments
      };
      
      // Update in database
      await this.updatePostInDatabase(updatedData);
      
      console.log(`✅ Updated post ${postData.id}: score=${score}, comments=${numComments}, upvote_ratio=${upvoteRatio.toFixed(2)}`);
      
      // Process new comments if comment count increased
      // Always fetch comments for recent posts (last 48 hours) or if comment count increased
      const postAgeHours = (Date.now() - postData.created_utc) / (1000 * 60 * 60);
      const shouldFetchComments = updatedData.num_comments > postData.num_comments || postAgeHours <= 48;
      
      if (shouldFetchComments) {
        if (updatedData.num_comments > postData.num_comments) {
          console.log(`📈 Post ${postData.id} has new comments (${postData.num_comments} -> ${updatedData.num_comments})`);
        } else {
          console.log(`🕒 Post ${postData.id} is recent (${Math.round(postAgeHours)}h old), fetching comments`);
        }
        
        const newCommentsCount = await this.processPostComments(postData.id, submission);
        console.log(`💬 Processed ${newCommentsCount} new comments for post ${postData.id}`);
      }
      
    } catch (error) {
      // Handle deleted/removed posts gracefully
      if (error.message?.includes('404') || error.message?.includes('deleted') || error.message?.includes('removed')) {
        console.log(`⚠️ Post ${postData.id} appears to be deleted/removed, skipping update`);
        return;
      }
      console.error(`❌ Error updating post ${postData.id}:`, error.message);
      throw error;
    }
  }

  /**
   * Update post data in database
   */
  async updatePostInDatabase(postData) {
    const queryText = `
      UPDATE posts SET
        score = $2::INTEGER,
        upvote_ratio = $3::REAL,
        approx_upvotes = $4::INTEGER,
        approx_downvotes = $5::INTEGER,
        num_comments = $6::INTEGER,
        comments_updated_at = NOW()
      WHERE id = $1
    `;
    
    const values = [
      postData.id,
      postData.score,
      postData.upvote_ratio,
      postData.approx_upvotes,
      postData.approx_downvotes,
      postData.num_comments
    ];
    
    await this.pool.query(queryText, values);
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
   * Fetch posts using multiple methods for maximum coverage
   */
  async fetchPostsWithMultipleMethods() {
    try {
      console.log('📅 Fetching posts using multiple methods for maximum coverage...');
      
      const subreddit = await this.reddit.getSubreddit('FACEITcom');
      
      let allPosts = new Map(); // Use Map to avoid duplicates
      const maxPosts = parseInt(process.env.MAX_POSTS_TO_FETCH) || 2000; // Minimum 1000 posts
      const postsPerRequest = 100;
      
      console.log(`🎯 Target: Fetch up to ${maxPosts} posts using multiple methods`);
      
      // Method 1: Get new posts
      await this.fetchPostsByMethod(subreddit, 'getNew', allPosts, maxPosts, postsPerRequest, 'new');
      
      // Method 2: Get hot posts
      await this.fetchPostsByMethod(subreddit, 'getHot', allPosts, maxPosts, postsPerRequest, 'hot');
      
      // Method 3: Get top posts (all time)
      await this.fetchPostsByMethod(subreddit, 'getTop', allPosts, maxPosts, postsPerRequest, 'top');
      
      // Method 4: Get controversial posts
      await this.fetchPostsByMethod(subreddit, 'getControversial', allPosts, maxPosts, postsPerRequest, 'controversial');
      
      const postsArray = Array.from(allPosts.values());
      console.log(`📊 Found ${postsArray.length} unique posts to process`);
      
      return postsArray;
      
    } catch (error) {
      console.error(`❌ Error fetching posts with multiple methods:`, error);
      throw error;
    }
  }

  /**
   * Fetch posts using a specific method
   */
  async fetchPostsByMethod(subreddit, methodName, allPosts, maxPosts, postsPerRequest, methodLabel) {
    try {
      console.log(`📊 Fetching ${methodLabel} posts...`);
      
      let after = null;
      let fetchedCount = 0;
      const maxForThisMethod = Math.floor(maxPosts / 4); // Divide equally among methods (250 each for 1000 total)
      
      while (fetchedCount < maxForThisMethod && allPosts.size < maxPosts) {
        try {
          const posts = await subreddit[methodName]({
            time: 'all',
            limit: postsPerRequest,
            after: after
          });
          
          if (posts.length === 0) {
            console.log(`📭 No more ${methodLabel} posts available`);
            break;
          }
          
          // Add posts to map (automatically handles duplicates)
          posts.forEach(post => {
            allPosts.set(post.id, post);
          });
          
          fetchedCount += posts.length;
          after = posts[posts.length - 1].name;
          
          console.log(`✅ Fetched ${posts.length} ${methodLabel} posts (total unique: ${allPosts.size})`);
          
          // Rate limiting
          await this.sleep(1000);
          
        } catch (error) {
          console.error(`❌ Error fetching ${methodLabel} batch:`, error.message);
          break;
        }
      }
      
      console.log(`✅ Completed ${methodLabel} posts: ${fetchedCount} fetched, ${allPosts.size} total unique`);
      
    } catch (error) {
      console.error(`❌ Error with ${methodLabel} method:`, error.message);
    }
  }

  /**
   * Process fetched posts
   */
  async processPosts(posts) {
    try {
      console.log(`📊 Processing ${posts.length} posts...`);
      
      let processedCount = 0;
      let skippedCount = 0;
      
      for (const post of posts) {
        try {
          // Check if post already exists
          const exists = await this.postExists(post.id);
          if (exists) {
            skippedCount++;
            continue;
          }
          
          // Process the post
          await this.processPost(post);
          processedCount++;
          
          // Process moderator responses
          try {
            await this.moderatorTracking.processModeratorResponses(post.id);
          } catch (error) {
            console.error(`❌ Error processing moderator responses for post ${post.id}:`, error.message);
          }
          
          // Rate limiting between posts
          await this.sleep(2000);
          
          if (processedCount % 10 === 0) {
            console.log(`📈 Processed ${processedCount} posts, skipped ${skippedCount}`);
          }
          
        } catch (error) {
          console.error(`❌ Error processing post ${post.id}:`, error.message);
          this.stats.errors++;
        }
      }
      
      console.log(`✅ Completed: ${processedCount} posts processed, ${skippedCount} skipped`);
      
      this.stats.postsProcessed = processedCount;
      this.stats.postsSkipped = skippedCount;
      
    } catch (error) {
      console.error(`❌ Error processing posts:`, error);
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
        created_utc: Math.floor(post.created_utc), // Convert to integer for BIGINT column
        title: post.title,
        body: post.selftext || '',
        author: post.author ? post.author.name : '[deleted]',
        permalink: post.permalink,
        link_flair_text: post.link_flair_text,
        score: parseInt(await post.score) || 0, // Ensure integer - await the promise
        upvote_ratio: parseFloat(await post.upvote_ratio) || 0.0, // Ensure float - await the promise
        approx_upvotes: Math.round((parseInt(await post.score) || 0) * (parseFloat(await post.upvote_ratio) || 0)) || 0,
        approx_downvotes: Math.round((parseInt(await post.score) || 0) * (1 - (parseFloat(await post.upvote_ratio) || 0))) || 0,
        num_comments: parseInt(await post.num_comments) || 0 // Ensure integer - await the promise
      };
      
      await this.savePost(postData);
      console.log(`📝 Saved post: ${post.id} - "${post.title.substring(0, 50)}..."`);
      
      // Fetch and process comments
      const commentCount = await this.processPostComments(post.id, post);
      this.stats.commentsProcessed += commentCount;
      
    } catch (error) {
      console.error(`❌ Error processing post ${post.id}:`, error);
      throw error;
    }
  }

  /**
   * Process comments for a post
   */
  async processPostComments(postId, submission = null) {
    try {
      console.log(`💬 Fetching comments for post ${postId}...`);
      
      // Get the post's comments directly from Reddit API
      const postWithComments = submission || await this.reddit.getSubmission(postId);
      
      // Get comments using the proper snoowrap method
      let allComments = [];
      
      try {
        // Method 1: Try the basic comments property (most reliable)
        allComments = await postWithComments.comments;
        
        // Method 2: If that doesn't work, try fetchAll
        if (!allComments || allComments.length === 0) {
          console.log(`🔄 Trying fetchAll for post ${postId}...`);
          allComments = await postWithComments.comments.fetchAll();
        }
        
        // Method 3: If still no comments, try to get them directly
        if (!allComments || allComments.length === 0) {
          console.log(`🔄 Trying direct comment access for post ${postId}...`);
          try {
            // Force refresh the submission to get comments
            const refreshedSubmission = await this.reddit.getSubmission(postId);
            allComments = await refreshedSubmission.comments;
          } catch (refreshError) {
            console.log(`⚠️ Could not refresh submission for post ${postId}: ${refreshError.message}`);
          }
        }
        
      } catch (error) {
        console.log(`⚠️ Could not fetch comments for post ${postId}: ${error.message}`);
        // Try alternative method
        try {
          console.log(`🔄 Trying alternative comment fetch for post ${postId}...`);
          allComments = await postWithComments.comments;
        } catch (altError) {
          console.log(`⚠️ Alternative comment fetch also failed for post ${postId}: ${altError.message}`);
          allComments = [];
        }
      }
      
      console.log(`🔍 Debug: Found ${allComments.length} total comments for post ${postId}`);
      
      // Small delay to avoid rate limiting
      await this.sleep(500);
      
      const comments = [];
      const maxComments = parseInt(process.env.MAX_COMMENTS_PER_POST) || 200;
      
      // Ensure allComments is an array before filtering
      if (!Array.isArray(allComments)) {
        console.log(`⚠️ Comments is not an array for post ${postId}, skipping comment processing`);
        return 0;
      }
      
      // Flatten all comments (including nested replies) and sort by score
      const flattenedComments = this.flattenComments(allComments)
        .filter(comment => comment && comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]')
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, maxComments);
      
      console.log(`💬 Processing ${flattenedComments.length} comments (including nested replies) for post ${postId}`);
      
      for (const comment of flattenedComments) {
        try {
          const author = comment.author ? comment.author.name : '[deleted]';
          
          // Check if author is a moderator (regardless of Reddit's distinguished field)
          const isModerator = await this.moderatorDetection.isModerator(author);
          
          const commentData = {
            id: comment.id,
            post_id: postId,
            created_utc: Math.floor(comment.created_utc), // Convert to integer for BIGINT column
            body: comment.body,
            author: author,
            score: parseInt(await comment.score) || 0, // Ensure integer - await the promise
            distinguished: isModerator ? 'moderator' : (comment.distinguished || null)
          };
          
          // Check if comment already exists
          const exists = await this.commentExists(comment.id);
          if (!exists) {
            await this.saveComment(commentData);
            comments.push(commentData);
            
            // Log moderator comments
            if (commentData.distinguished) {
              console.log(`👮 Moderator comment found: ${commentData.author} (${commentData.distinguished})`);
            }
          } else {
            console.log(`⏭️ Comment ${comment.id} already exists, skipping`);
          }
          
        } catch (error) {
          console.error(`❌ Error processing comment ${comment.id}:`, error.message);
        }
      }
      
      console.log(`✅ Saved ${comments.length} comments for post ${postId}`);
      return comments.length;
      
    } catch (error) {
      console.error(`❌ Error fetching comments for post ${postId}:`, error);
      return 0;
    }
  }

  /**
   * Save post to database
   */
  async savePost(postData) {
    // Debug: Log the data types being passed
    console.log(`🔍 Debug postData for ${postData.id}:`, {
      created_utc: typeof postData.created_utc,
      score: typeof postData.score,
      upvote_ratio: typeof postData.upvote_ratio,
      approx_upvotes: typeof postData.approx_upvotes,
      approx_downvotes: typeof postData.approx_downvotes,
      num_comments: typeof postData.num_comments
    });
    
    const queryText = `
      INSERT INTO posts (
        id, created_utc, created_at, title, body, author, permalink, link_flair_text,
        score, upvote_ratio, approx_upvotes, approx_downvotes, num_comments
      ) VALUES ($1, $2::BIGINT, to_timestamp($2::BIGINT), $3, $4, $5, $6, $7, $8::INTEGER, $9::REAL, $10::INTEGER, $11::INTEGER, $12::INTEGER)
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
    
    try {
      await this.pool.query(queryText, values);
      console.log(`✅ Post ${postData.id} saved/updated successfully`);
    } catch (error) {
      console.error(`❌ Failed to save post ${postData.id}:`, error.message);
      throw error;
    }
  }

  /**
   * Save comment to database
   */
  async saveComment(commentData) {
    const queryText = `
      INSERT INTO comments (
        id, post_id, created_utc, created_at, body, author, score, distinguished
      ) VALUES ($1, $2, $3::BIGINT, to_timestamp($3::BIGINT), $4, $5, $6::INTEGER, $7)
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
    
    try {
      await this.pool.query(queryText, values);
      console.log(`✅ Comment ${commentData.id} saved/updated successfully`);
    } catch (error) {
      console.error(`❌ Failed to save comment ${commentData.id}:`, error.message);
      throw error;
    }
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
   * Flatten nested comments into a single array
   */
  flattenComments(comments, flattened = []) {
    if (!Array.isArray(comments)) {
      return flattened;
    }
    
    for (const comment of comments) {
      if (comment && comment.id) {
        flattened.push(comment);
        
        // Recursively flatten replies
        if (comment.replies && Array.isArray(comment.replies)) {
          this.flattenComments(comment.replies, flattened);
        }
      }
    }
    
    return flattened;
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
    console.log('\n🎉 Fetch completed!');
    console.log('📊 Final Statistics:');
    console.log(`   Posts processed: ${this.stats.postsProcessed}`);
    console.log(`   Comments processed: ${this.stats.commentsProcessed}`);
    console.log(`   Posts skipped: ${this.stats.postsSkipped}`);
    console.log(`   Comments skipped: ${this.stats.commentsSkipped}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`   Total data points: ${this.stats.postsProcessed + this.stats.commentsProcessed}`);
  }
}

// Run if called directly (more strict check)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
const isDirectCall = process.argv[1] && process.argv[1].endsWith('reddit_fetcher.js');

if (isMainModule || isDirectCall) {
  const fetcher = new RealisticRedditFetcher();
  
  // Check command line arguments to determine which method to use
  const args = process.argv.slice(2);
  const updateOnly = args.includes('--update-only');
  const fetchOnly = args.includes('--fetch-only');
  
  let method;
  if (updateOnly) {
    method = fetcher.updateExistingPosts();
    console.log('🔄 Running in update-only mode...');
  } else if (fetchOnly) {
    method = fetcher.fetchRecentData();
    console.log('📥 Running in fetch-only mode...');
  } else {
    method = fetcher.fetchAndUpdateData();
    console.log('🚀 Running in comprehensive fetch and update mode...');
  }
  
  method
    .then(() => {
      console.log('✅ Reddit fetcher script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Reddit fetcher script failed:', error);
      process.exit(1);
    });
}

export { RealisticRedditFetcher };
