import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';
import { OneTimeAnalysis } from './ai_analyzer.js';

dotenv.config();

/**
 * Re-analyze posts that failed AI analysis
 */
class FailedPostsReanalyzer {
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
   * Get failed posts for re-analysis (supports both specific IDs and automatic detection)
   */
  async getFailedPosts(specificPostIds = null) {
    console.log('🔍 Getting failed posts for re-analysis...\n');
    
    try {
      let posts;
      
      if (specificPostIds && specificPostIds.length > 0) {
        // Re-analyze specific posts by ID
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
        // Automatically find all failed posts
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
   * Check if posts already have valid analysis (duplicate prevention)
   */
  async checkForDuplicates(postIds) {
    console.log('🔍 Checking for existing valid analyses (duplicate prevention)...\n');
    
    try {
      const existingAnalyses = await query(`
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

      if (existingAnalyses.rows.length > 0) {
        console.log('⚠️ Found posts with existing valid analyses:');
        existingAnalyses.rows.forEach((analysis, index) => {
          console.log(`   ${index + 1}. ${analysis.id}: "${analysis.title}"`);
          console.log(`      Model: ${analysis.llm_model}, Summary: "${analysis.summary.substring(0, 50)}..."`);
        });
        console.log();
      }

      return existingAnalyses.rows;

    } catch (error) {
      console.error('❌ Error checking for duplicates:', error);
      throw error;
    }
  }

  /**
   * Mark posts as unanalyzed so they can be re-analyzed (with safety checks)
   */
  async markPostsAsUnanalyzed(postIds, forceReanalyze = false) {
    console.log('🔄 Marking posts as unanalyzed...\n');
    
    try {
      // Check for duplicates unless forced
      if (!forceReanalyze) {
        const existingAnalyses = await this.checkForDuplicates(postIds);
        if (existingAnalyses.length > 0) {
          console.log('⚠️ Some posts already have valid analyses. Use --force flag to re-analyze anyway.\n');
          return false; // Don't proceed
        }
      }

      const result = await query(`
        UPDATE posts 
        SET analyzed = false, analyzed_at = NULL
        WHERE id = ANY($1)
      `, [postIds]);

      console.log(`✅ Marked ${result.rowCount} posts as unanalyzed`);

      // Also delete the failed analysis entries (but keep valid ones if not forced)
      if (forceReanalyze) {
        const deleteResult = await query(`
          DELETE FROM analyses_post 
          WHERE post_id = ANY($1)
        `, [postIds]);
        console.log(`🗑️ Deleted ${deleteResult.rowCount} analysis entries (forced re-analysis)`);
      } else {
        const deleteResult = await query(`
          DELETE FROM analyses_post 
          WHERE post_id = ANY($1)
          AND (
            summary = 'Analysis failed - using default values'
            OR llm_model = 'default'
            OR summary LIKE '%failed%'
            OR summary IS NULL
            OR llm_model IS NULL
          )
        `, [postIds]);
        console.log(`🗑️ Deleted ${deleteResult.rowCount} failed analysis entries`);
      }

      console.log();
      return true;

    } catch (error) {
      console.error('❌ Error marking posts as unanalyzed:', error);
      throw error;
    }
  }

  /**
   * Re-analyze specific posts
   */
  async reanalyzePosts(posts) {
    console.log('🤖 Starting re-analysis of failed posts...\n');
    
    let successCount = 0;
    let failureCount = 0;

    for (const post of posts) {
      try {
        console.log(`🔍 Re-analyzing post: ${post.id} - "${post.title}"`);
        
        // Create post object in the format expected by the analyzer
        const postData = {
          id: post.id,
          title: post.title,
          body: post.body || '',
          author: post.author,
          created_utc: post.created_utc,
          link_flair_text: post.link_flair_text,
          num_comments: post.num_comments
        };

        // Run the analysis
        await this.analyzer.analyzePost(postData);
        
        console.log(`✅ Successfully re-analyzed post ${post.id}`);
        successCount++;

      } catch (error) {
        console.error(`❌ Failed to re-analyze post ${post.id}:`, error.message);
        failureCount++;
      }
      
      console.log(); // Add spacing
    }

    console.log('📊 Re-analysis Results:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log(`   📈 Success Rate: ${((successCount / posts.length) * 100).toFixed(1)}%`);

    return { successCount, failureCount };
  }

  /**
   * Verify the re-analysis results
   */
  async verifyResults(postIds) {
    console.log('🔍 Verifying re-analysis results...\n');
    
    try {
      const results = await query(`
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

      console.log('📋 Re-analysis Verification:\n');

      results.rows.forEach((result, index) => {
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

      return results.rows;

    } catch (error) {
      console.error('❌ Error verifying results:', error);
      throw error;
    }
  }

  /**
   * Run the complete re-analysis process
   */
  async run(specificPostIds = null, forceReanalyze = false) {
    console.log('🔄 FAILED POSTS RE-ANALYSIS\n');
    
    try {
      await this.connect();
      
      // Get the failed posts
      const failedPosts = await this.getFailedPosts(specificPostIds);
      
      if (failedPosts.length === 0) {
        console.log('✅ No failed posts found to re-analyze');
        return;
      }

      const postIds = failedPosts.map(post => post.id);
      
      // Mark as unanalyzed (with duplicate prevention)
      const canProceed = await this.markPostsAsUnanalyzed(postIds, forceReanalyze);
      
      if (!canProceed) {
        console.log('❌ Re-analysis cancelled due to existing valid analyses');
        return;
      }
      
      // Re-analyze the posts
      const results = await this.reanalyzePosts(failedPosts);
      
      // Verify the results
      await this.verifyResults(postIds);
      
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
    forceReanalyze: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.forceReanalyze = true;
    } else if (arg === '--posts' || arg === '-p') {
      // Next argument should be comma-separated post IDs
      if (i + 1 < args.length) {
        options.specificPostIds = args[i + 1].split(',').map(id => id.trim()).filter(id => id);
        i++; // Skip the next argument since we processed it
      }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
🔄 Failed Posts Re-analyzer

USAGE:
  node src/reanalyze_failed_posts.js [OPTIONS]

OPTIONS:
  --help, -h              Show this help message
  --force, -f             Force re-analysis even if valid analysis exists
  --posts <ids>, -p <ids> Re-analyze specific posts by ID (comma-separated)

EXAMPLES:
  # Automatically find and re-analyze all failed posts
  node src/reanalyze_failed_posts.js

  # Re-analyze specific posts
  node src/reanalyze_failed_posts.js --posts "1nruc62,1nr93tc"

  # Force re-analysis of specific posts (even if valid analysis exists)
  node src/reanalyze_failed_posts.js --posts "1nruc62" --force

  # Re-analyze all failed posts with force (ignore existing valid analyses)
  node src/reanalyze_failed_posts.js --force

FEATURES:
  ✅ Automatic duplicate prevention
  ✅ Safety checks to prevent overwriting valid analyses
  ✅ Support for specific post IDs or automatic detection
  ✅ Force mode for manual override
  ✅ Detailed progress reporting
  ✅ Verification of results

SAFETY:
  - By default, won't re-analyze posts that already have valid analyses
  - Use --force flag only when you're sure you want to overwrite existing analyses
  - Failed analyses (with "Analysis failed" summary) are always re-analyzed
`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('reanalyze_failed_posts.js'))) {
  const options = parseArguments();
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const reanalyzer = new FailedPostsReanalyzer();
  reanalyzer.run(options.specificPostIds, options.forceReanalyze)
    .then(() => {
      console.log('\n🎉 Re-analysis completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Re-analysis failed:', error);
      process.exit(1);
    });
}

export { FailedPostsReanalyzer };
