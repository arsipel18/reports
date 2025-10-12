import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';
import { OneTimeAnalysis } from './ai_analyzer.js';

dotenv.config();

/**
 * Comprehensive re-analyzer for both failed posts and failed comments
 */
class FailedAnalysesReanalyzer {
  constructor() {
    this.pool = null;
    this.analyzer = null;
  }

  async connect() {
    this.pool = await createDbConnection();
    this.analyzer = new OneTimeAnalysis();
    console.log('✅ Connected to database and initialized analyzer');
  }

  async disconnect() {
    if (this.pool) {
      await closeDb();
      console.log('📴 Database connection closed');
    }
  }

  /**
   * Get failed posts for re-analysis
   */
  async getFailedPosts(specificPostIds = null) {
    console.log('🔍 Getting failed posts for re-analysis...\n');
    
    try {
      let posts;
      
      if (specificPostIds && specificPostIds.length > 0) {
        console.log(`🎯 Re-analyzing specific posts: ${specificPostIds.join(', ')}\n`);
        
        posts = await query(`
          SELECT 
            p.id,
            p.title,
            p.body,
            p.author,
            p.created_utc,
            p.link_flair_text,
            p.num_comments
          FROM posts p
          WHERE p.id = ANY($1)
          ORDER BY p.created_utc DESC
        `, [specificPostIds]);
        
      } else {
        console.log('🔍 Automatically detecting failed posts...\n');
        
        posts = await query(`
          SELECT 
            p.id,
            p.title,
            p.body,
            p.author,
            p.created_utc,
            p.link_flair_text,
            p.num_comments
          FROM posts p
          LEFT JOIN analyses_post ap ON p.id = ap.post_id
          WHERE p.analyzed = true 
          AND (
            ap.summary = 'Analysis failed - using default values'
            OR ap.llm_model = 'default'
            OR ap.summary LIKE '%failed%'
            OR ap.summary IS NULL
            OR ap.llm_model IS NULL
          )
          ORDER BY p.created_utc DESC
        `);
      }

      console.log(`📊 Found ${posts.rows.length} posts to re-analyze:\n`);

      if (posts.rows.length === 0) {
        console.log('✅ No failed posts found to re-analyze');
        return [];
      }

      posts.rows.forEach((post, index) => {
        console.log(`${index + 1}. Post ID: ${post.id}`);
        console.log(`   Title: "${post.title}"`);
        console.log(`   Author: ${post.author}`);
        console.log(`   Created: ${new Date(post.created_utc * 1000).toLocaleString()}`);
        console.log(`   Body: "${(post.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return posts.rows;

    } catch (error) {
      console.error('❌ Error getting failed posts:', error);
      throw error;
    }
  }

  /**
   * Get failed comments for re-analysis
   */
  async getFailedComments(specificCommentIds = null) {
    console.log('🔍 Getting failed comments for re-analysis...\n');
    
    try {
      let comments;
      
      if (specificCommentIds && specificCommentIds.length > 0) {
        console.log(`🎯 Re-analyzing specific comments: ${specificCommentIds.join(', ')}\n`);
        
        comments = await query(`
          SELECT 
            c.id,
            c.body,
            c.author,
            c.created_utc,
            c.analyzed,
            c.analyzed_at,
            c.post_id,
            p.title as post_title
          FROM comments c
          LEFT JOIN posts p ON c.post_id = p.id
          WHERE c.id = ANY($1)
          ORDER BY c.created_utc DESC
        `, [specificCommentIds]);
        
      } else {
        console.log('🔍 Automatically detecting failed comments...\n');
        
        comments = await query(`
          SELECT 
            c.id,
            c.body,
            c.author,
            c.created_utc,
            c.analyzed,
            c.analyzed_at,
            c.post_id,
            p.title as post_title
          FROM comments c
          LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
          LEFT JOIN posts p ON c.post_id = p.id
          WHERE (
            (c.analyzed = true AND (
              ac.summary = 'Analysis failed - using default values'
              OR ac.llm_model = 'default'
              OR ac.summary LIKE '%failed%'
              OR ac.summary IS NULL
              OR ac.llm_model IS NULL
            ))
            OR (ac.sentiment IS NULL OR ac.intent IS NULL)
            OR (c.analyzed = false AND ac.comment_id IS NOT NULL)
          )
          ORDER BY c.created_utc DESC
          LIMIT 100
        `);
      }

      console.log(`📊 Found ${comments.rows.length} comments to re-analyze:\n`);

      if (comments.rows.length === 0) {
        console.log('✅ No failed comments found to re-analyze');
        return [];
      }

      comments.rows.forEach((comment, index) => {
        console.log(`${index + 1}. Comment ID: ${comment.id}`);
        console.log(`   Post: "${comment.post_title}" (${comment.post_id})`);
        console.log(`   Author: ${comment.author}`);
        console.log(`   Created: ${new Date(comment.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${comment.analyzed} (${comment.analyzed_at})`);
        console.log(`   Body: "${(comment.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return comments.rows;

    } catch (error) {
      console.error('❌ Error getting failed comments:', error);
      throw error;
    }
  }

  /**
   * Check for duplicate analyses (safety check)
   */
  async checkForDuplicates(postIds, commentIds) {
    console.log('🔍 Checking for existing valid analyses (duplicate prevention)...\n');
    
    try {
      let existingPostAnalyses = [];
      let existingCommentAnalyses = [];
      
      if (postIds && postIds.length > 0) {
        const postResults = await query(`
          SELECT 
            p.id,
            p.title,
            ap.llm_model,
            ap.summary,
            ap.created_at
          FROM posts p
          JOIN analyses_post ap ON p.id = ap.post_id
          WHERE p.id = ANY($1)
          AND ap.llm_model IS NOT NULL 
          AND ap.llm_model != 'default'
          AND ap.summary IS NOT NULL
          AND ap.summary != 'Analysis failed - using default values'
          AND ap.summary NOT LIKE '%failed%'
        `, [postIds]);
        existingPostAnalyses = postResults.rows;
      }
      
      if (commentIds && commentIds.length > 0) {
        const commentResults = await query(`
          SELECT 
            c.id,
            c.body,
            c.post_id,
            p.title as post_title,
            ac.llm_model,
            ac.summary,
            ac.created_at
          FROM comments c
          JOIN analyses_comment ac ON c.id = ac.comment_id
          LEFT JOIN posts p ON c.post_id = p.id
          WHERE c.id = ANY($1)
          AND ac.llm_model IS NOT NULL 
          AND ac.llm_model != 'default'
          AND ac.summary IS NOT NULL
          AND ac.summary != 'Analysis failed - using default values'
          AND ac.summary NOT LIKE '%failed%'
          AND ac.sentiment IS NOT NULL
          AND ac.intent IS NOT NULL
        `, [commentIds]);
        existingCommentAnalyses = commentResults.rows;
      }

      if (existingPostAnalyses.length > 0 || existingCommentAnalyses.length > 0) {
        console.log('⚠️ Found items with existing valid analyses:');
        
        existingPostAnalyses.forEach((analysis, index) => {
          console.log(`   Post ${index + 1}. ${analysis.id}: "${analysis.title}"`);
          console.log(`      Model: ${analysis.llm_model}, Summary: "${analysis.summary.substring(0, 50)}..."`);
        });
        
        existingCommentAnalyses.forEach((analysis, index) => {
          console.log(`   Comment ${index + 1}. ${analysis.id}: "${analysis.post_title}"`);
          console.log(`      Model: ${analysis.llm_model}, Summary: "${analysis.summary.substring(0, 50)}..."`);
        });
        console.log();
      }

      return { existingPostAnalyses, existingCommentAnalyses };

    } catch (error) {
      console.error('❌ Error checking for duplicates:', error);
      throw error;
    }
  }

  /**
   * Mark posts as unanalyzed so they can be re-analyzed
   */
  async markPostsAsUnanalyzed(postIds, forceReanalyze = false) {
    if (!postIds || postIds.length === 0) return true;
    
    console.log('🔄 Marking posts as unanalyzed...\n');
    
    try {
      const result = await query(`
        UPDATE posts 
        SET analyzed = false, analyzed_at = NULL
        WHERE id = ANY($1)
      `, [postIds]);

      console.log(`✅ Marked ${result.rowCount} posts as unanalyzed`);

      // Delete failed analysis entries
      const deleteResult = await query(`
        DELETE FROM analyses_post 
        WHERE post_id = ANY($1)
        ${forceReanalyze ? '' : `AND (
          summary = 'Analysis failed - using default values'
          OR llm_model = 'default'
          OR summary LIKE '%failed%'
          OR summary IS NULL
          OR llm_model IS NULL
        )`}
      `, [postIds]);
      
      console.log(`🗑️ Deleted ${deleteResult.rowCount} ${forceReanalyze ? 'analysis' : 'failed analysis'} entries`);
      console.log();
      return true;

    } catch (error) {
      console.error('❌ Error marking posts as unanalyzed:', error);
      throw error;
    }
  }

  /**
   * Mark comments as unanalyzed so they can be re-analyzed
   */
  async markCommentsAsUnanalyzed(commentIds, forceReanalyze = false) {
    if (!commentIds || commentIds.length === 0) return true;
    
    console.log('🔄 Marking comments as unanalyzed...\n');
    
    try {
      const result = await query(`
        UPDATE comments 
        SET analyzed = false, analyzed_at = NULL
        WHERE id = ANY($1)
      `, [commentIds]);

      console.log(`✅ Marked ${result.rowCount} comments as unanalyzed`);

      // Delete failed analysis entries
      const deleteResult = await query(`
        DELETE FROM analyses_comment 
        WHERE comment_id = ANY($1)
        ${forceReanalyze ? '' : `AND (
          summary = 'Analysis failed - using default values'
          OR llm_model = 'default'
          OR summary LIKE '%failed%'
          OR summary IS NULL
          OR llm_model IS NULL
          OR sentiment IS NULL
          OR intent IS NULL
        )`}
      `, [commentIds]);
      
      console.log(`🗑️ Deleted ${deleteResult.rowCount} ${forceReanalyze ? 'analysis' : 'failed analysis'} entries`);
      console.log();
      return true;

    } catch (error) {
      console.error('❌ Error marking comments as unanalyzed:', error);
      throw error;
    }
  }

  /**
   * Re-analyze posts
   */
  async reanalyzePosts(posts) {
    if (!posts || posts.length === 0) return { successCount: 0, failureCount: 0 };
    
    console.log('🤖 Starting re-analysis of failed posts...\n');
    
    let successCount = 0;
    let failureCount = 0;

    for (const post of posts) {
      try {
        console.log(`🔍 Re-analyzing post: ${post.id} - "${post.title}"`);
        
        const postData = {
          id: post.id,
          title: post.title,
          body: post.body || '',
          author: post.author,
          created_utc: post.created_utc,
          link_flair_text: post.link_flair_text,
          num_comments: post.num_comments
        };

        await this.analyzer.analyzePost(postData);
        console.log(`✅ Successfully re-analyzed post ${post.id}`);
        successCount++;

      } catch (error) {
        console.error(`❌ Failed to re-analyze post ${post.id}:`, error.message);
        failureCount++;
      }
      
      console.log(); // Add spacing
    }

    console.log('📊 Post Re-analysis Results:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   📈 Success Rate: ${((successCount / posts.length) * 100).toFixed(1)}%\n`);

    return { successCount, failureCount };
  }

  /**
   * Re-analyze comments
   */
  async reanalyzeComments(comments) {
    if (!comments || comments.length === 0) return { successCount: 0, failureCount: 0 };
    
    console.log('🤖 Starting re-analysis of failed comments...\n');
    
    let successCount = 0;
    let failureCount = 0;

    for (const comment of comments) {
      try {
        console.log(`🔍 Re-analyzing comment: ${comment.id} - "${(comment.body || 'N/A').substring(0, 50)}..."`);
        
        // Create individual prompt for this comment
        const userPrompt = `Post ID: ${comment.post_id}\n\nComment: ${comment.body || 'N/A'}`;
        
        const result = await this.analyzer.googleAI.chatJSONWithRetry({
          system: this.analyzer.googleAI.constructor.COMMENT_ANALYSIS_SYSTEM_PROMPT || 
                  "You are a precise labeller for Reddit comments about FACEIT. Output JSON with: intent, target, sentiment, category, summary, key_issues.",
          user: userPrompt
        });

        if (result) {
          // Import validation functions
          const { validateAnalysis, sanitizeAnalysis } = await import('./prompts.js');
          
          // Validate and sanitize the analysis
          const validation = validateAnalysis(result.json, 'comment');
          let analysis = result.json;
          
          if (!validation.isValid) {
            console.warn(`⚠️ Analysis validation failed for comment ${comment.id}:`, validation.errors);
            analysis = sanitizeAnalysis(analysis, 'comment');
          }
          
          // Save analysis to database
          await this.analyzer.saveCommentAnalysis(comment.id, comment.post_id, analysis, result.usage);
          successCount++;
          
          console.log(`✅ Comment re-analyzed: ${analysis.category} | ${analysis.sentiment} | ${analysis.intent}`);
          
        } else {
          // Use default analysis if API failed
          console.warn(`⚠️ Using default analysis for comment ${comment.id}`);
          const { getDefaultAnalysis } = await import('./prompts.js');
          const defaultAnalysis = getDefaultAnalysis('comment');
          await this.analyzer.saveCommentAnalysis(comment.id, comment.post_id, defaultAnalysis, {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cost_usd: 0,
            model: 'default'
          });
          failureCount++;
        }
        
        // Mark comment as analyzed
        await this.analyzer.updateCommentAnalyzed(comment.id);
        
        // Wait between requests (3 seconds)
        console.log(`⏳ Waiting 3 seconds before next comment...`);
        await new Promise(resolve => setTimeout(resolve, 3000));

      } catch (error) {
        console.error(`❌ Failed to re-analyze comment ${comment.id}:`, error.message);
        
        // Save default analysis for failed comment
        const { getDefaultAnalysis } = await import('./prompts.js');
        const defaultAnalysis = getDefaultAnalysis('comment');
        await this.analyzer.saveCommentAnalysis(comment.id, comment.post_id, defaultAnalysis, {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          model: 'default'
        });
        
        await this.analyzer.updateCommentAnalyzed(comment.id);
        failureCount++;
        
        // Still wait between requests even on error
        console.log(`⏳ Waiting 3 seconds before next comment...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      console.log(); // Add spacing
    }

    console.log('📊 Comment Re-analysis Results:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   📈 Success Rate: ${((successCount / comments.length) * 100).toFixed(1)}%\n`);

    return { successCount, failureCount };
  }

  /**
   * Verify the re-analysis results
   */
  async verifyResults(postIds, commentIds) {
    console.log('🔍 Verifying re-analysis results...\n');
    
    try {
      if (postIds && postIds.length > 0) {
        console.log('📋 Post Re-analysis Verification:\n');
        
        const postResults = await query(`
          SELECT 
            p.id,
            p.title,
            p.analyzed,
            p.analyzed_at,
            ap.intent,
            ap.target,
            ap.sentiment,
            ap.category,
            ap.summary,
            ap.llm_model
          FROM posts p
          LEFT JOIN analyses_post ap ON p.id = ap.post_id
          WHERE p.id = ANY($1)
          ORDER BY p.created_utc DESC
        `, [postIds]);

        postResults.rows.forEach((result, index) => {
          console.log(`${index + 1}. Post ID: ${result.id}`);
          console.log(`   Title: "${result.title}"`);
          console.log(`   Analyzed: ${result.analyzed}`);
          console.log(`   Analyzed At: ${result.analyzed_at || 'NULL'}`);
          console.log(`   Model: ${result.llm_model || 'NULL'}`);
          console.log(`   Intent: ${result.intent || 'NULL'} | Target: ${result.target || 'NULL'} | Sentiment: ${result.sentiment || 'NULL'}`);
          console.log(`   Category: ${result.category || 'NULL'}`);
          console.log(`   Summary: "${result.summary || 'NULL'}"`);
          console.log();
        });
      }

      if (commentIds && commentIds.length > 0) {
        console.log('📋 Comment Re-analysis Verification:\n');
        
        const commentResults = await query(`
          SELECT 
            c.id,
            c.body,
            c.analyzed,
            c.analyzed_at,
            c.post_id,
            p.title as post_title,
            ac.intent,
            ac.target,
            ac.sentiment,
            ac.category,
            ac.summary,
            ac.llm_model
          FROM comments c
          LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
          LEFT JOIN posts p ON c.post_id = p.id
          WHERE c.id = ANY($1)
          ORDER BY c.created_utc DESC
          LIMIT 20
        `, [commentIds]);

        commentResults.rows.forEach((result, index) => {
          console.log(`${index + 1}. Comment ID: ${result.id}`);
          console.log(`   Post: "${result.post_title}" (${result.post_id})`);
          console.log(`   Analyzed: ${result.analyzed}`);
          console.log(`   Analyzed At: ${result.analyzed_at || 'NULL'}`);
          console.log(`   Model: ${result.llm_model || 'NULL'}`);
          console.log(`   Intent: ${result.intent || 'NULL'} | Target: ${result.target || 'NULL'} | Sentiment: ${result.sentiment || 'NULL'}`);
          console.log(`   Category: ${result.category || 'NULL'}`);
          console.log(`   Summary: "${result.summary || 'NULL'}"`);
          console.log(`   Body: "${(result.body || 'N/A').substring(0, 80)}..."`);
          console.log();
        });
      }

    } catch (error) {
      console.error('❌ Error verifying results:', error);
      throw error;
    }
  }

  /**
   * Run the complete re-analysis process
   */
  async run(options = {}) {
    const {
      specificPostIds = null,
      specificCommentIds = null,
      forceReanalyze = false,
      postsOnly = false,
      commentsOnly = false
    } = options;

    console.log('🔄 FAILED ANALYSES RE-ANALYSIS\n');
    
    try {
      await this.connect();
      
      let posts = [];
      let comments = [];
      
      // Get failed posts (unless comments-only mode)
      if (!commentsOnly) {
        posts = await this.getFailedPosts(specificPostIds);
      }
      
      // Get failed comments (unless posts-only mode)
      if (!postsOnly) {
        comments = await this.getFailedComments(specificCommentIds);
      }
      
      if (posts.length === 0 && comments.length === 0) {
        console.log('✅ No failed analyses found to re-analyze');
        return;
      }

      const postIds = posts.map(post => post.id);
      const commentIds = comments.map(comment => comment.id);
      
      // Check for duplicates unless forced
      if (!forceReanalyze) {
        const duplicates = await this.checkForDuplicates(postIds, commentIds);
        if (duplicates.existingPostAnalyses.length > 0 || duplicates.existingCommentAnalyses.length > 0) {
          console.log('⚠️ Some items already have valid analyses. Use --force flag to re-analyze anyway.\n');
          return;
        }
      }
      
      // Mark as unanalyzed
      await this.markPostsAsUnanalyzed(postIds, forceReanalyze);
      await this.markCommentsAsUnanalyzed(commentIds, forceReanalyze);
      
      // Re-analyze
      const postResults = await this.reanalyzePosts(posts);
      const commentResults = await this.reanalyzeComments(comments);
      
      // Verify results
      await this.verifyResults(postIds, commentIds);
      
      // Final summary
      console.log('🎯 FINAL RE-ANALYSIS SUMMARY:');
      console.log(`📝 Posts: ${postResults.successCount} successful, ${postResults.failureCount} failed`);
      console.log(`💬 Comments: ${commentResults.successCount} successful, ${commentResults.failureCount} failed`);
      console.log(`📊 Total: ${postResults.successCount + commentResults.successCount} successful, ${postResults.failureCount + commentResults.failureCount} failed`);
      
      console.log('✅ Re-analysis process completed successfully');
      
    } catch (error) {
      console.error('❌ Re-analysis process failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Command line interface
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    specificPostIds: null,
    specificCommentIds: null,
    forceReanalyze: false,
    postsOnly: false,
    commentsOnly: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.forceReanalyze = true;
    } else if (arg === '--posts-only' || arg === '-p') {
      options.postsOnly = true;
    } else if (arg === '--comments-only' || arg === '-c') {
      options.commentsOnly = true;
    } else if (arg === '--posts' || arg === '--post-ids') {
      if (i + 1 < args.length) {
        options.specificPostIds = args[i + 1].split(',').map(id => id.trim()).filter(id => id);
        i++;
      }
    } else if (arg === '--comments' || arg === '--comment-ids') {
      if (i + 1 < args.length) {
        options.specificCommentIds = args[i + 1].split(',').map(id => id.trim()).filter(id => id);
        i++;
      }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
🔄 Failed Analyses Re-analyzer

USAGE:
  node src/reanalyze_failed_analyses.js [OPTIONS]

OPTIONS:
  --help, -h                    Show this help message
  --force, -f                   Force re-analysis even if valid analysis exists
  --posts-only, -p              Only re-analyze posts (skip comments)
  --comments-only, -c           Only re-analyze comments (skip posts)
  --posts <ids>, --post-ids     Re-analyze specific posts by ID (comma-separated)
  --comments <ids>, --comment-ids Re-analyze specific comments by ID (comma-separated)

EXAMPLES:
  # Automatically find and re-analyze all failed posts and comments
  node src/reanalyze_failed_analyses.js

  # Re-analyze only failed posts
  node src/reanalyze_failed_analyses.js --posts-only

  # Re-analyze only failed comments
  node src/reanalyze_failed_analyses.js --comments-only

  # Re-analyze specific posts and comments
  node src/reanalyze_failed_analyses.js --posts "1nruc62,1nr93tc" --comments "abc123,def456"

  # Force re-analysis of everything (ignore existing valid analyses)
  node src/reanalyze_failed_analyses.js --force

  # Re-analyze only comments with force
  node src/reanalyze_failed_analyses.js --comments-only --force

FEATURES:
  ✅ Handles both posts and comments
  ✅ Automatic duplicate prevention
  ✅ Safety checks to prevent overwriting valid analyses
  ✅ Support for specific IDs or automatic detection
  ✅ Force mode for manual override
  ✅ Detailed progress reporting
  ✅ Verification of results
  ✅ Flexible targeting (posts-only, comments-only, or both)

SAFETY:
  - By default, won't re-analyze items that already have valid analyses
  - Use --force flag only when you're sure you want to overwrite existing analyses
  - Failed analyses are always re-analyzed
  - Includes rate limiting for comment analysis (3 seconds between requests)
`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('reanalyze_failed_analyses.js'))) {
  const options = parseArguments();
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const reanalyzer = new FailedAnalysesReanalyzer();
  reanalyzer.run(options)
    .then(() => {
      console.log('\n🎉 Re-analysis completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Re-analysis failed:', error);
      process.exit(1);
    });
}

export { FailedAnalysesReanalyzer };
