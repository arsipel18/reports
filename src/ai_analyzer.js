import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { createDbConnection, closeDb, query } from './db.js';
import GoogleAIService from './google_ai.js';
import {
  POST_ANALYSIS_SYSTEM_PROMPT,
  COMMENT_ANALYSIS_SYSTEM_PROMPT,
  getDefaultAnalysis,
  validateAnalysis,
  sanitizeAnalysis
} from './prompts.js';

dotenv.config();

/**
 * One-time AI Analysis Script
 * Analyzes all posts and comments in the database with 5-second delays
 * Processes comments one by one for better analysis quality
 */
class OneTimeAnalysis {
  constructor() {
    this.googleAI = new GoogleAIService();
    this.batchSize = 10; // 10 comments per post
    this.delayMs = 3000; // 5 seconds between requests
  }

  async connect() {
    this.pool = await createDbConnection();
    console.log('✅ Connected to database');
  }

  /**
   * Get all unanalyzed posts
   */
  async getUnanalyzedPosts() {
    const queryText = `
      SELECT * FROM posts 
      WHERE analyzed = false 
      ORDER BY created_utc DESC
    `;
    
    const result = await query(queryText);
    console.log(`📊 Found ${result.rows.length} unanalyzed posts`);
    return result.rows;
  }

  /**
   * Get comments for a specific post (including those with null sentiment or intent)
   */
  async getCommentsForPost(postId, limit = 10) {
    const queryText = `
      SELECT c.* FROM comments c
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE c.post_id = $1 
      AND (c.analyzed = false OR ac.sentiment IS NULL OR ac.intent IS NULL)
      ORDER BY c.created_utc DESC
      LIMIT $2
    `;
    
    const result = await query(queryText, [postId, limit]);
    return result.rows;
  }

  /**
   * Get all comments with null sentiment or intent across all posts
   */
  async getAllCommentsWithNullAnalysis(limit = 1000) {
    const queryText = `
      SELECT c.*, p.id as post_id FROM comments c
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      LEFT JOIN posts p ON c.post_id = p.id
      WHERE ac.sentiment IS NULL OR ac.intent IS NULL
      ORDER BY c.created_utc DESC
      LIMIT $1
    `;
    
    const result = await query(queryText, [limit]);
    console.log(`📊 Found ${result.rows.length} comments with null sentiment or intent`);
    return result.rows;
  }

  /**
   * Get all comments with null intent specifically
   */
  async getAllCommentsWithNullIntent(limit = 1000) {
    const queryText = `
      SELECT c.*, p.id as post_id FROM comments c
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      LEFT JOIN posts p ON c.post_id = p.id
      WHERE ac.intent IS NULL
      ORDER BY c.created_utc DESC
      LIMIT $1
    `;
    
    const result = await query(queryText, [limit]);
    console.log(`📊 Found ${result.rows.length} comments with null intent`);
    return result.rows;
  }

  /**
   * Analyze a single post
   */
  async analyzePost(post) {
    try {
      console.log(`🔍 Analyzing post: ${post.id} - "${post.title.substring(0, 50)}..."`);
      
      const userPrompt = `Title: ${post.title}\n\nBody: ${post.body || 'N/A'}`;
      
      const result = await this.googleAI.chatJSONWithRetry({
        system: POST_ANALYSIS_SYSTEM_PROMPT,
        user: userPrompt
      });

      const analysis = validateAnalysis(result.json) ? result.json : sanitizeAnalysis(result.json);
      
      // Save post analysis
      await this.savePostAnalysis(post.id, analysis, result.usage);
      
      // Update post as analyzed
      await this.updatePostAnalyzed(post.id);
      
      console.log(`✅ Post analyzed: ${analysis.category} | ${analysis.sentiment} | ${analysis.intent}`);
      
      return { success: true, analysis };
      
    } catch (error) {
      console.error(`❌ Error analyzing post ${post.id}:`, error);
      
      // Save default analysis for failed posts
      const defaultAnalysis = getDefaultAnalysis('post');
      await this.savePostAnalysis(post.id, defaultAnalysis, null);
      await this.updatePostAnalyzed(post.id);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Analyze comments for a post (one by one)
   */
  async analyzeComments(postId, comments) {
    if (comments.length === 0) {
      console.log(`📝 No comments to analyze for post ${postId}`);
      return { success: true, analyzed: 0 };
    }

    console.log(`💬 Analyzing ${comments.length} comments for post ${postId} (one by one)`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const comment of comments) {
      try {
        console.log(`🔍 Analyzing comment: ${comment.id} - "${(comment.body || 'N/A').substring(0, 50)}..."`);
        
        // Create individual prompt for this comment
        const userPrompt = `Post ID: ${postId}\n\nComment: ${comment.body || 'N/A'}`;
        
        const result = await this.googleAI.chatJSONWithRetry({
          system: COMMENT_ANALYSIS_SYSTEM_PROMPT,
          user: userPrompt
        });

        if (result) {
          // Validate and sanitize the analysis
          const validation = validateAnalysis(result.json, 'comment');
          let analysis = result.json;
          
          if (!validation.isValid) {
            console.warn(`⚠️ Analysis validation failed for comment ${comment.id}:`, validation.errors);
            analysis = sanitizeAnalysis(analysis, 'comment');
          }
          
          // Save analysis to database
          await this.saveCommentAnalysis(comment.id, postId, analysis, result.usage);
          successCount++;
          
          console.log(`✅ Comment analyzed: ${analysis.category} | ${analysis.sentiment} | ${analysis.intent}`);
          
        } else {
          // Use default analysis if API failed
          console.warn(`⚠️ Using default analysis for comment ${comment.id}`);
          const defaultAnalysis = getDefaultAnalysis('comment');
          await this.saveCommentAnalysis(comment.id, postId, defaultAnalysis, {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cost_usd: 0,
            model: 'default'
          });
          failCount++;
        }
        
        // Mark comment as analyzed
        await this.updateCommentAnalyzed(comment.id);
        
        // Verify the update succeeded
        const verification = await query('SELECT analyzed FROM comments WHERE id = $1', [comment.id]);
        if (verification.rows.length === 0 || !verification.rows[0].analyzed) {
          console.error(`❌ CRITICAL: Comment ${comment.id} was not marked as analyzed!`);
          // Retry the update
          await this.updateCommentAnalyzed(comment.id);
        }
        
        // Wait between requests (5 seconds)
        console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next comment...`);
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
        
      } catch (error) {
        console.error(`❌ Error analyzing comment ${comment.id}:`, error);
        
        // Save default analysis for failed comment
        const defaultAnalysis = getDefaultAnalysis('comment');
        await this.saveCommentAnalysis(comment.id, postId, defaultAnalysis, {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          model: 'default'
        });
        
        await this.updateCommentAnalyzed(comment.id);
        
        // Verify the update succeeded even on error
        const verification = await query('SELECT analyzed FROM comments WHERE id = $1', [comment.id]);
        if (verification.rows.length === 0 || !verification.rows[0].analyzed) {
          console.error(`❌ CRITICAL: Comment ${comment.id} was not marked as analyzed after error!`);
          // Retry the update
          await this.updateCommentAnalyzed(comment.id);
        }
        
        failCount++;
        
        // Still wait between requests even on error
        console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next comment...`);
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }
    
    console.log(`✅ Comment analysis complete: ${successCount} successful, ${failCount} failed`);
    return { success: true, analyzed: comments.length };
  }

  /**
   * Save post analysis to database with strict validation
   */
  async savePostAnalysis(postId, analysis, usage) {
    // Strict validation before insertion
    const validation = validateAnalysis(analysis, 'post');
    if (!validation.isValid) {
      console.error(`❌ CRITICAL: Invalid post analysis for ${postId}:`, validation.errors);
      throw new Error(`Invalid analysis data: ${validation.errors.join(', ')}`);
    }

    // Additional strict checks
    if (!postId || typeof postId !== 'string') {
      throw new Error('Post ID must be a non-empty string');
    }

    if (!analysis.intent || !['help', 'comment'].includes(analysis.intent)) {
      throw new Error(`Invalid intent: ${analysis.intent}. Must be 'help' or 'comment'`);
    }

    if (!analysis.target || !['faceit', 'not_faceit'].includes(analysis.target)) {
      throw new Error(`Invalid target: ${analysis.target}. Must be 'faceit' or 'not_faceit'`);
    }

    if (!analysis.sentiment || !['pos', 'neg', 'neu'].includes(analysis.sentiment)) {
      throw new Error(`Invalid sentiment: ${analysis.sentiment}. Must be 'pos', 'neg', or 'neu'`);
    }

    const validCategories = [
      'account_recovery', 'verification', '2fa', 'matchmaking_issues', 
      'game_registration_issues', 'afk_leaver_bans', 'griefing', 
      'verbal_abuse', 'smurfs', 'cheaters', 'anti_cheat', 'subscriptions', 
      'faceit_shop', 'technical_client', 'platform_website', 
      'steam_issues_game_update', 'tournaments_leagues', 'esea', 'mission', 
      'moderation_community', 'feature_request', 'track_stats', 'ow2', 
      'dota2', 'legal_issues_gdpr', 'other'
    ];

    if (!analysis.category || !validCategories.includes(analysis.category)) {
      throw new Error(`Invalid category: ${analysis.category}. Must be one of: ${validCategories.join(', ')}`);
    }

    if (!analysis.summary || typeof analysis.summary !== 'string' || analysis.summary.length > 500) {
      throw new Error('Summary must be a string with max 500 characters');
    }

    if (!Array.isArray(analysis.key_issues)) {
      throw new Error('Key issues must be an array');
    }

    // Get post's created_utc from posts table
    const postResult = await query('SELECT created_utc FROM posts WHERE id = $1', [postId]);
    const postCreatedUtc = postResult.rows[0]?.created_utc || null;

    const queryText = `
      INSERT INTO analyses_post (
        post_id, intent, target, sentiment, category, 
        summary, key_issues, llm_model, llm_tokens_in, 
        llm_tokens_out, llm_cost_usd, post_created_utc
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (post_id) DO UPDATE SET
        intent = EXCLUDED.intent,
        target = EXCLUDED.target,
        sentiment = EXCLUDED.sentiment,
        category = EXCLUDED.category,
        summary = EXCLUDED.summary,
        key_issues = EXCLUDED.key_issues,
        llm_model = EXCLUDED.llm_model,
        llm_tokens_in = EXCLUDED.llm_tokens_in,
        llm_tokens_out = EXCLUDED.llm_tokens_out,
        llm_cost_usd = EXCLUDED.llm_cost_usd,
        post_created_utc = EXCLUDED.post_created_utc
    `;
    
    const values = [
      postId,
      analysis.intent,
      analysis.target,
      analysis.sentiment,
      analysis.category,
      analysis.summary,
      JSON.stringify(analysis.key_issues),
      usage?.model || 'unknown',
      usage?.prompt_tokens || 0,
      usage?.completion_tokens || 0,
      usage?.cost_usd || 0,
      postCreatedUtc
    ];
    
    await query(queryText, values);
    console.log(`✅ Post analysis saved for ${postId}: ${analysis.category} | ${analysis.sentiment} | ${analysis.intent}`);
  }

  /**
   * Save comment analysis to database with strict validation
   */
  async saveCommentAnalysis(commentId, postId, analysis, usage) {
    // Strict validation before insertion
    const validation = validateAnalysis(analysis, 'comment');
    if (!validation.isValid) {
      console.error(`❌ CRITICAL: Invalid comment analysis for ${commentId}:`, validation.errors);
      throw new Error(`Invalid analysis data: ${validation.errors.join(', ')}`);
    }

    // Additional strict checks
    if (!commentId || typeof commentId !== 'string') {
      throw new Error('Comment ID must be a non-empty string');
    }

    if (!postId || typeof postId !== 'string') {
      throw new Error('Post ID must be a non-empty string');
    }

    if (!analysis.intent || !['help', 'comment'].includes(analysis.intent)) {
      throw new Error(`Invalid intent: ${analysis.intent}. Must be 'help' or 'comment'`);
    }

    if (!analysis.target || !['faceit', 'not_faceit'].includes(analysis.target)) {
      throw new Error(`Invalid target: ${analysis.target}. Must be 'faceit' or 'not_faceit'`);
    }

    if (!analysis.sentiment || !['pos', 'neg', 'neu'].includes(analysis.sentiment)) {
      throw new Error(`Invalid sentiment: ${analysis.sentiment}. Must be 'pos', 'neg', or 'neu'`);
    }

    const validCategories = [
      'account_recovery', 'verification', '2fa', 'matchmaking_issues', 
      'game_registration_issues', 'afk_leaver_bans', 'griefing', 
      'verbal_abuse', 'smurfs', 'cheaters', 'anti_cheat', 'subscriptions', 
      'faceit_shop', 'technical_client', 'platform_website', 
      'steam_issues_game_update', 'tournaments_leagues', 'esea', 'mission', 
      'moderation_community', 'feature_request', 'track_stats', 'ow2', 
      'dota2', 'legal_issues_gdpr', 'other'
    ];

    if (!analysis.category || !validCategories.includes(analysis.category)) {
      throw new Error(`Invalid category: ${analysis.category}. Must be one of: ${validCategories.join(', ')}`);
    }

    if (!analysis.summary || typeof analysis.summary !== 'string' || analysis.summary.length > 500) {
      throw new Error('Summary must be a string with max 500 characters');
    }

    if (!Array.isArray(analysis.key_issues)) {
      throw new Error('Key issues must be an array');
    }

    const queryText = `
      INSERT INTO analyses_comment (
        comment_id, post_id, intent, target, sentiment, category, 
        summary, key_issues, llm_model, llm_tokens_in, 
        llm_tokens_out, llm_cost_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (comment_id) DO UPDATE SET
        post_id = EXCLUDED.post_id,
        intent = EXCLUDED.intent,
        target = EXCLUDED.target,
        sentiment = EXCLUDED.sentiment,
        category = EXCLUDED.category,
        summary = EXCLUDED.summary,
        key_issues = EXCLUDED.key_issues,
        llm_model = EXCLUDED.llm_model,
        llm_tokens_in = EXCLUDED.llm_tokens_in,
        llm_tokens_out = EXCLUDED.llm_tokens_out,
        llm_cost_usd = EXCLUDED.llm_cost_usd
    `;
    
    const values = [
      commentId,
      postId,
      analysis.intent,
      analysis.target,
      analysis.sentiment,
      analysis.category,
      analysis.summary,
      JSON.stringify(analysis.key_issues),
      usage?.model || 'unknown',
      usage?.prompt_tokens || 0,
      usage?.completion_tokens || 0,
      usage?.cost_usd || 0
    ];
    
    await query(queryText, values);
    console.log(`✅ Comment analysis saved for ${commentId}: ${analysis.category} | ${analysis.sentiment} | ${analysis.intent}`);
  }

  /**
   * Update post as analyzed
   */
  async updatePostAnalyzed(postId) {
    const queryText = `
      UPDATE posts 
      SET analyzed = true, analyzed_at = NOW() 
      WHERE id = $1
    `;
    
    await query(queryText, [postId]);
  }

  /**
   * Update comment as analyzed
   */
  async updateCommentAnalyzed(commentId) {
    const queryText = `
      UPDATE comments 
      SET analyzed = true, analyzed_at = NOW() 
      WHERE id = $1
    `;
    
    try {
      const result = await query(queryText, [commentId]);
      if (result.rowCount === 0) {
        console.warn(`⚠️ No comment found with ID ${commentId} to mark as analyzed`);
      } else {
        console.log(`✅ Comment ${commentId} marked as analyzed`);
      }
    } catch (error) {
      console.error(`❌ Failed to mark comment ${commentId} as analyzed:`, error);
      throw error;
    }
  }

  /**
   * Check for post author positive comments and update post sentiment
   */
  async checkPostAuthorPositiveComments() {
    console.log('🔍 Checking for post author positive comments...');
    
    try {
      // Get posts where the author has commented with positive sentiment
      const queryText = `
        SELECT DISTINCT p.id as post_id, p.author, ap.sentiment as current_sentiment, ap.sentiment_before_comment, p.created_utc
        FROM posts p
        JOIN analyses_post ap ON p.id = ap.post_id
        JOIN comments c ON p.id = c.post_id AND c.author = p.author
        JOIN analyses_comment ac ON c.id = ac.comment_id
        WHERE ac.sentiment = 'pos' 
        AND ac.intent = 'comment'
        AND (ap.sentiment_before_comment IS NULL OR ap.sentiment != 'pos')
        AND p.created_utc >= EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days') * 1000
        ORDER BY p.created_utc DESC
      `;
      
      const result = await query(queryText);
      
      if (result.rows.length === 0) {
        console.log('✅ No post author positive comments found');
        return { updated: 0 };
      }
      
      console.log(`📝 Found ${result.rows.length} posts with author positive comments`);
      
      let updatedCount = 0;
      
      for (const row of result.rows) {
        try {
          // Store original sentiment if not already stored
          if (!row.sentiment_before_comment) {
            await query(`
              UPDATE analyses_post 
              SET sentiment_before_comment = $1 
              WHERE post_id = $2
            `, [row.current_sentiment, row.post_id]);
            
            console.log(`💾 Stored original sentiment '${row.current_sentiment}' for post ${row.post_id}`);
          }
          
          // Update post sentiment to positive
          await query(`
            UPDATE analyses_post 
            SET sentiment = 'pos' 
            WHERE post_id = $1
          `, [row.post_id]);
          
          console.log(`✅ Updated post ${row.post_id} sentiment to positive (author: ${row.author})`);
          updatedCount++;
          
        } catch (error) {
          console.error(`❌ Error updating post ${row.post_id}:`, error);
        }
      }
      
      console.log(`🎉 Updated ${updatedCount} posts with positive sentiment from author comments`);
      return { updated: updatedCount };
      
    } catch (error) {
      console.error('❌ Error checking post author positive comments:', error);
      throw error;
    }
  }

  /**
   * Wait for specified delay
   */
  async wait() {
    console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next request...`);
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
  }

  /**
   * Run the complete one-time analysis
   */
  async run() {
    console.log('🚀 Starting one-time AI analysis of all posts and comments...');
    const startTime = Date.now();
    
    try {
      await this.connect();
      
      // Get all unanalyzed posts
      const posts = await this.getUnanalyzedPosts();
      
      if (posts.length === 0) {
        console.log('✅ No posts need analysis');
        return;
      }
      
      let postSuccessCount = 0;
      let postFailCount = 0;
      let totalCommentsAnalyzed = 0;
      
      // Process each post
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        console.log(`\n📝 Processing post ${i + 1}/${posts.length}: ${post.id}`);
        
        // Analyze the post
        const postResult = await this.analyzePost(post);
        if (postResult.success) {
          postSuccessCount++;
        } else {
          postFailCount++;
        }
        
        // Wait between requests
        await this.wait();
        
        // Get and analyze ALL comments for this post (including those with null data)
        let commentOffset = 0;
        const commentBatchSize = 100; // Get more comments per batch since we analyze one by one
        
        while (true) {
          const comments = await this.getCommentsForPost(post.id, commentBatchSize);
          
          if (comments.length === 0) {
            break; // No more comments to process
          }
          
          console.log(`📝 Found ${comments.length} comments to analyze for post ${post.id}`);
          
          const commentResult = await this.analyzeComments(post.id, comments);
          if (commentResult.success) {
            totalCommentsAnalyzed += commentResult.analyzed;
          }
          
          // If we got fewer comments than the batch size, we've processed all comments
          if (comments.length < commentBatchSize) {
            break;
          }
          
          commentOffset += commentBatchSize;
        }
      }
      
      // Process all comments with null sentiment or intent across all posts
      console.log('\n🔍 Processing comments with null sentiment or intent...');
      const commentsWithNullData = await this.getAllCommentsWithNullAnalysis();
      
      if (commentsWithNullData.length > 0) {
        console.log(`📝 Found ${commentsWithNullData.length} comments with null sentiment or intent to re-analyze`);
        
        let nullCommentSuccessCount = 0;
        let nullCommentFailCount = 0;
        
        for (const comment of commentsWithNullData) {
          try {
            console.log(`🔍 Re-analyzing comment: ${comment.id} - "${(comment.body || 'N/A').substring(0, 50)}..."`);
            
            // Create individual prompt for this comment
            const userPrompt = `Post ID: ${comment.post_id}\n\nComment: ${comment.body || 'N/A'}`;
            
            const result = await this.googleAI.chatJSONWithRetry({
              system: COMMENT_ANALYSIS_SYSTEM_PROMPT,
              user: userPrompt
            });

            if (result) {
              // Validate and sanitize the analysis
              const validation = validateAnalysis(result.json, 'comment');
              let analysis = result.json;
              
              if (!validation.isValid) {
                console.warn(`⚠️ Analysis validation failed for comment ${comment.id}:`, validation.errors);
                analysis = sanitizeAnalysis(analysis, 'comment');
              }
              
              // Save analysis to database
              await this.saveCommentAnalysis(comment.id, comment.post_id, analysis, result.usage);
              nullCommentSuccessCount++;
              
              console.log(`✅ Comment re-analyzed: ${analysis.category} | ${analysis.sentiment} | ${analysis.intent}`);
              
            } else {
              // Use default analysis if API failed
              console.warn(`⚠️ Using default analysis for comment ${comment.id}`);
              const defaultAnalysis = getDefaultAnalysis('comment');
              await this.saveCommentAnalysis(comment.id, comment.post_id, defaultAnalysis, {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                cost_usd: 0,
                model: 'default'
              });
              nullCommentFailCount++;
            }
            
            // Wait between requests (5 seconds)
            console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next comment...`);
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
            
          } catch (error) {
            console.error(`❌ Error re-analyzing comment ${comment.id}:`, error);
            
            // Save default analysis for failed comment
            const defaultAnalysis = getDefaultAnalysis('comment');
            await this.saveCommentAnalysis(comment.id, comment.post_id, defaultAnalysis, {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              cost_usd: 0,
              model: 'default'
            });
            
            nullCommentFailCount++;
            
            // Still wait between requests even on error
            console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next comment...`);
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
          }
        }
        
        console.log(`✅ Null sentiment/intent comment re-analysis complete: ${nullCommentSuccessCount} successful, ${nullCommentFailCount} failed`);
        totalCommentsAnalyzed += nullCommentSuccessCount + nullCommentFailCount;
      } else {
        console.log('✅ No comments with null sentiment or intent found');
      }
      
      // Process all comments with null intent specifically
      console.log('\n🔍 Processing comments with null intent...');
      const commentsWithNullIntent = await this.getAllCommentsWithNullIntent();
      
      if (commentsWithNullIntent.length > 0) {
        console.log(`📝 Found ${commentsWithNullIntent.length} comments with null intent to re-analyze`);
        
        let intentSuccessCount = 0;
        let intentFailCount = 0;
        
        for (const comment of commentsWithNullIntent) {
          try {
            console.log(`🔍 Re-analyzing intent for comment: ${comment.id} - "${(comment.body || 'N/A').substring(0, 50)}..."`);
            
            // Create individual prompt for this comment
            const userPrompt = `Post ID: ${comment.post_id}\n\nComment: ${comment.body || 'N/A'}`;
            
            const result = await this.googleAI.chatJSONWithRetry({
              system: COMMENT_ANALYSIS_SYSTEM_PROMPT,
              user: userPrompt
            });

            if (result) {
              // Validate and sanitize the analysis
              const validation = validateAnalysis(result.json, 'comment');
              let analysis = result.json;
              
              if (!validation.isValid) {
                console.warn(`⚠️ Analysis validation failed for comment ${comment.id}:`, validation.errors);
                analysis = sanitizeAnalysis(analysis, 'comment');
              }
              
              // Save analysis to database
              await this.saveCommentAnalysis(comment.id, comment.post_id, analysis, result.usage);
              intentSuccessCount++;
              
              console.log(`✅ Comment intent re-analyzed: ${analysis.intent} | ${analysis.category}`);
              
            } else {
              // Use default analysis if API failed
              console.warn(`⚠️ Using default analysis for comment ${comment.id}`);
              const defaultAnalysis = getDefaultAnalysis('comment');
              await this.saveCommentAnalysis(comment.id, comment.post_id, defaultAnalysis, {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                cost_usd: 0,
                model: 'default'
            });
            intentFailCount++;
            }
            
            // Wait between requests (5 seconds)
            console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next comment...`);
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
            
          } catch (error) {
            console.error(`❌ Error re-analyzing intent for comment ${comment.id}:`, error);
            
            // Save default analysis for failed comment
            const defaultAnalysis = getDefaultAnalysis('comment');
            await this.saveCommentAnalysis(comment.id, comment.post_id, defaultAnalysis, {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
              cost_usd: 0,
              model: 'default'
            });
            
            intentFailCount++;
            
            // Still wait between requests even on error
            console.log(`⏳ Waiting ${this.delayMs / 1000} seconds before next comment...`);
            await new Promise(resolve => setTimeout(resolve, this.delayMs));
          }
        }
        
        console.log(`✅ Null intent comment re-analysis complete: ${intentSuccessCount} successful, ${intentFailCount} failed`);
        totalCommentsAnalyzed += intentSuccessCount + intentFailCount;
      } else {
        console.log('✅ No comments with null intent found');
      }
      
      // Step 4: Check for post author positive comments and update sentiment
      console.log('\n🔍 Checking for post author positive comments...');
      const sentimentUpdateResult = await this.checkPostAuthorPositiveComments();
      console.log(`✅ Sentiment update complete: ${sentimentUpdateResult.updated} posts updated`);
      
      const duration = Math.round((Date.now() - startTime) / 1000);
      console.log('\n🎉 One-time analysis completed!');
      console.log(`📊 Results:`);
      console.log(`  • Posts analyzed: ${postSuccessCount} successful, ${postFailCount} failed`);
      console.log(`  • Comments analyzed: ${totalCommentsAnalyzed}`);
      console.log(`  • Posts with sentiment updated: ${sentimentUpdateResult.updated}`);
      console.log(`  • Total time: ${duration} seconds`);
      console.log(`  • Average time per post: ${Math.round(duration / posts.length)} seconds`);
      
    } catch (error) {
      console.error('❌ One-time analysis failed:', error);
      throw error;
    } finally {
      await closeDb();
      console.log('📴 Database connection closed');
    }
  }
}

// CLI Interface
async function runOneTimeAnalysis() {
  console.log('🚀 Starting one-time analysis script...');
  const analysis = new OneTimeAnalysis();
  
  try {
    await analysis.run();
    console.log('✅ One-time analysis completed successfully');
  } catch (error) {
    console.error('❌ One-time analysis failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await closeDb();
  process.exit(0);
});

// Run the analysis only when called directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('ai_analyzer.js'))) {
  console.log('🚀 One-time analysis script starting...');
  runOneTimeAnalysis()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

export { OneTimeAnalysis };
