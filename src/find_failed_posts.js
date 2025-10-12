import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';

dotenv.config();

/**
 * Find posts that failed AI analysis
 */
class FailedPostsFinder {
  constructor() {
    this.pool = null;
  }

  async connect() {
    this.pool = await createDbConnection();
    console.log('✅ Connected to database');
  }

  async disconnect() {
    if (this.pool) {
      await closeDb();
      console.log('📴 Database connection closed');
    }
  }

  /**
   * Find posts that are marked as analyzed but have default/failed analysis
   */
  async findFailedPosts() {
    console.log('🔍 Finding posts with failed AI analysis...\n');
    
    try {
      // Find posts that are marked as analyzed but have default analysis
      const failedPosts = await query(`
        SELECT 
          p.id,
          p.title,
          p.body,
          p.author,
          p.created_utc,
          p.analyzed,
          p.analyzed_at,
          ap.intent,
          ap.target,
          ap.sentiment,
          ap.category,
          ap.summary,
          ap.llm_model,
          ap.created_at as analysis_created_at
        FROM posts p
        LEFT JOIN analyses_post ap ON p.id = ap.post_id
        WHERE p.analyzed = true 
        AND (
          ap.summary = 'Analysis failed - using default values'
          OR ap.llm_model = 'default'
          OR ap.summary LIKE '%failed%'
          OR ap.summary IS NULL
        )
        ORDER BY p.created_utc DESC
      `);

      console.log(`📊 Found ${failedPosts.rows.length} posts with failed analysis:\n`);

      if (failedPosts.rows.length === 0) {
        console.log('✅ No failed posts found - all analyses appear to be successful');
        return;
      }

      failedPosts.rows.forEach((post, index) => {
        console.log(`${index + 1}. Post ID: ${post.id}`);
        console.log(`   Title: "${post.title}"`);
        console.log(`   Author: ${post.author}`);
        console.log(`   Created: ${new Date(post.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${post.analyzed} (${post.analyzed_at})`);
        console.log(`   Analysis Model: ${post.llm_model || 'NULL'}`);
        console.log(`   Analysis Summary: "${post.summary || 'NULL'}"`);
        console.log(`   Intent: ${post.intent || 'NULL'} | Target: ${post.target || 'NULL'} | Sentiment: ${post.sentiment || 'NULL'}`);
        console.log(`   Category: ${post.category || 'NULL'}`);
        console.log(`   Analysis Created: ${post.analysis_created_at || 'NULL'}`);
        console.log(`   Body: "${(post.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return failedPosts.rows;

    } catch (error) {
      console.error('❌ Error finding failed posts:', error);
      throw error;
    }
  }

  /**
   * Find posts that are not analyzed yet
   */
  async findUnanalyzedPosts() {
    console.log('🔍 Finding unanalyzed posts...\n');
    
    try {
      const unanalyzedPosts = await query(`
        SELECT 
          p.id,
          p.title,
          p.body,
          p.author,
          p.created_utc,
          p.analyzed,
          p.analyzed_at
        FROM posts p
        WHERE p.analyzed = false
        ORDER BY p.created_utc DESC
        LIMIT 10
      `);

      console.log(`📊 Found ${unanalyzedPosts.rows.length} unanalyzed posts:\n`);

      if (unanalyzedPosts.rows.length === 0) {
        console.log('✅ All posts are analyzed');
        return;
      }

      unanalyzedPosts.rows.forEach((post, index) => {
        console.log(`${index + 1}. Post ID: ${post.id}`);
        console.log(`   Title: "${post.title}"`);
        console.log(`   Author: ${post.author}`);
        console.log(`   Created: ${new Date(post.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${post.analyzed}`);
        console.log(`   Body: "${(post.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return unanalyzedPosts.rows;

    } catch (error) {
      console.error('❌ Error finding unanalyzed posts:', error);
      throw error;
    }
  }

  /**
   * Get analysis statistics
   */
  async getAnalysisStats() {
    console.log('📊 Analysis Statistics:\n');
    
    try {
      const stats = await query(`
        SELECT 
          COUNT(*) as total_posts,
          COUNT(CASE WHEN analyzed = true THEN 1 END) as analyzed_posts,
          COUNT(CASE WHEN analyzed = false THEN 1 END) as unanalyzed_posts,
          COUNT(CASE WHEN ap.summary = 'Analysis failed - using default values' THEN 1 END) as failed_analyses,
          COUNT(CASE WHEN ap.llm_model = 'default' THEN 1 END) as default_model_analyses
        FROM posts p
        LEFT JOIN analyses_post ap ON p.id = ap.post_id
      `);

      const stat = stats.rows[0];
      console.log(`   Total Posts: ${stat.total_posts}`);
      console.log(`   Analyzed Posts: ${stat.analyzed_posts}`);
      console.log(`   Unanalyzed Posts: ${stat.unanalyzed_posts}`);
      console.log(`   Failed Analyses: ${stat.failed_analyses}`);
      console.log(`   Default Model Analyses: ${stat.default_model_analyses}`);
      console.log();

    } catch (error) {
      console.error('❌ Error getting analysis stats:', error);
    }
  }

  /**
   * Find posts with recent analysis (last hour)
   */
  async findRecentAnalyses() {
    console.log('🔍 Finding recent analyses (last hour)...\n');
    
    try {
      const recentAnalyses = await query(`
        SELECT 
          p.id,
          p.title,
          p.author,
          ap.summary,
          ap.llm_model,
          ap.created_at as analysis_created_at
        FROM posts p
        JOIN analyses_post ap ON p.id = ap.post_id
        WHERE ap.created_at >= NOW() - INTERVAL '1 hour'
        ORDER BY ap.created_at DESC
      `);

      console.log(`📊 Found ${recentAnalyses.rows.length} recent analyses:\n`);

      recentAnalyses.rows.forEach((analysis, index) => {
        console.log(`${index + 1}. Post ID: ${analysis.id}`);
        console.log(`   Title: "${analysis.title}"`);
        console.log(`   Author: ${analysis.author}`);
        console.log(`   Model: ${analysis.llm_model}`);
        console.log(`   Summary: "${analysis.summary}"`);
        console.log(`   Analyzed At: ${analysis.analysis_created_at}`);
        console.log();
      });

      return recentAnalyses.rows;

    } catch (error) {
      console.error('❌ Error finding recent analyses:', error);
    }
  }

  /**
   * Run all checks
   */
  async run() {
    console.log('🔍 FAILED POSTS INVESTIGATION\n');
    
    try {
      await this.connect();
      
      await this.getAnalysisStats();
      await this.findFailedPosts();
      await this.findUnanalyzedPosts();
      await this.findRecentAnalyses();
      
      console.log('✅ Investigation completed');
      
    } catch (error) {
      console.error('❌ Investigation failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('find_failed_posts.js'))) {
  const finder = new FailedPostsFinder();
  finder.run()
    .then(() => {
      console.log('\n✅ Investigation completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Investigation failed:', error);
      process.exit(1);
    });
}

export { FailedPostsFinder };
