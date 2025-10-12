import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';

dotenv.config();

/**
 * Find comments that failed AI analysis
 */
class FailedCommentsFinder {
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
   * Find comments that are marked as analyzed but have default/failed analysis
   */
  async findFailedComments() {
    console.log('🔍 Finding comments with failed AI analysis...\n');
    
    try {
      // Find comments that are marked as analyzed but have default analysis
      const failedComments = await query(`
        SELECT 
          c.id,
          c.body,
          c.author,
          c.created_utc,
          c.analyzed,
          c.analyzed_at,
          c.post_id,
          p.title as post_title,
          ac.intent,
          ac.target,
          ac.sentiment,
          ac.category,
          ac.summary,
          ac.llm_model,
          ac.created_at as analysis_created_at
        FROM comments c
        LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
        LEFT JOIN posts p ON c.post_id = p.id
        WHERE c.analyzed = true 
        AND (
          ac.summary = 'Analysis failed - using default values'
          OR ac.llm_model = 'default'
          OR ac.summary LIKE '%failed%'
          OR ac.summary IS NULL
        )
        ORDER BY c.created_utc DESC
        LIMIT 50
      `);

      console.log(`📊 Found ${failedComments.rows.length} comments with failed analysis:\n`);

      if (failedComments.rows.length === 0) {
        console.log('✅ No failed comments found - all analyses appear to be successful');
        return;
      }

      failedComments.rows.forEach((comment, index) => {
        console.log(`${index + 1}. Comment ID: ${comment.id}`);
        console.log(`   Post: "${comment.post_title}" (${comment.post_id})`);
        console.log(`   Author: ${comment.author}`);
        console.log(`   Created: ${new Date(comment.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${comment.analyzed} (${comment.analyzed_at})`);
        console.log(`   Analysis Model: ${comment.llm_model || 'NULL'}`);
        console.log(`   Analysis Summary: "${comment.summary || 'NULL'}"`);
        console.log(`   Intent: ${comment.intent || 'NULL'} | Target: ${comment.target || 'NULL'} | Sentiment: ${comment.sentiment || 'NULL'}`);
        console.log(`   Category: ${comment.category || 'NULL'}`);
        console.log(`   Analysis Created: ${comment.analysis_created_at || 'NULL'}`);
        console.log(`   Body: "${(comment.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return failedComments.rows;

    } catch (error) {
      console.error('❌ Error finding failed comments:', error);
      throw error;
    }
  }

  /**
   * Find comments with null sentiment or intent
   */
  async findCommentsWithNullAnalysis() {
    console.log('🔍 Finding comments with null sentiment or intent...\n');
    
    try {
      const nullComments = await query(`
        SELECT 
          c.id,
          c.body,
          c.author,
          c.created_utc,
          c.analyzed,
          c.analyzed_at,
          c.post_id,
          p.title as post_title,
          ac.intent,
          ac.target,
          ac.sentiment,
          ac.category,
          ac.summary,
          ac.llm_model,
          ac.created_at as analysis_created_at
        FROM comments c
        LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
        LEFT JOIN posts p ON c.post_id = p.id
        WHERE (ac.sentiment IS NULL OR ac.intent IS NULL)
        ORDER BY c.created_utc DESC
        LIMIT 50
      `);

      console.log(`📊 Found ${nullComments.rows.length} comments with null sentiment or intent:\n`);

      if (nullComments.rows.length === 0) {
        console.log('✅ No comments with null analysis found');
        return;
      }

      nullComments.rows.forEach((comment, index) => {
        console.log(`${index + 1}. Comment ID: ${comment.id}`);
        console.log(`   Post: "${comment.post_title}" (${comment.post_id})`);
        console.log(`   Author: ${comment.author}`);
        console.log(`   Created: ${new Date(comment.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${comment.analyzed} (${comment.analyzed_at})`);
        console.log(`   Analysis Model: ${comment.llm_model || 'NULL'}`);
        console.log(`   Analysis Summary: "${comment.summary || 'NULL'}"`);
        console.log(`   Intent: ${comment.intent || 'NULL'} | Target: ${comment.target || 'NULL'} | Sentiment: ${comment.sentiment || 'NULL'}`);
        console.log(`   Category: ${comment.category || 'NULL'}`);
        console.log(`   Analysis Created: ${comment.analysis_created_at || 'NULL'}`);
        console.log(`   Body: "${(comment.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return nullComments.rows;

    } catch (error) {
      console.error('❌ Error finding comments with null analysis:', error);
      throw error;
    }
  }

  /**
   * Find comments that are not analyzed yet
   */
  async findUnanalyzedComments() {
    console.log('🔍 Finding unanalyzed comments...\n');
    
    try {
      const unanalyzedComments = await query(`
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
        WHERE c.analyzed = false
        ORDER BY c.created_utc DESC
        LIMIT 20
      `);

      console.log(`📊 Found ${unanalyzedComments.rows.length} unanalyzed comments:\n`);

      if (unanalyzedComments.rows.length === 0) {
        console.log('✅ All comments are analyzed');
        return;
      }

      unanalyzedComments.rows.forEach((comment, index) => {
        console.log(`${index + 1}. Comment ID: ${comment.id}`);
        console.log(`   Post: "${comment.post_title}" (${comment.post_id})`);
        console.log(`   Author: ${comment.author}`);
        console.log(`   Created: ${new Date(comment.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${comment.analyzed}`);
        console.log(`   Body: "${(comment.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return unanalyzedComments.rows;

    } catch (error) {
      console.error('❌ Error finding unanalyzed comments:', error);
      throw error;
    }
  }

  /**
   * Find comments with analysis but not marked as analyzed
   */
  async findUnmarkedAnalyzedComments() {
    console.log('🔍 Finding comments with analysis but not marked as analyzed...\n');
    
    try {
      const unmarkedComments = await query(`
        SELECT 
          c.id,
          c.body,
          c.author,
          c.created_utc,
          c.analyzed,
          c.analyzed_at,
          c.post_id,
          p.title as post_title,
          ac.intent,
          ac.target,
          ac.sentiment,
          ac.category,
          ac.summary,
          ac.llm_model,
          ac.created_at as analysis_created_at
        FROM comments c
        INNER JOIN analyses_comment ac ON c.id = ac.comment_id
        LEFT JOIN posts p ON c.post_id = p.id
        WHERE c.analyzed = false
        ORDER BY c.created_utc DESC
        LIMIT 20
      `);

      console.log(`📊 Found ${unmarkedComments.rows.length} comments with analysis but not marked as analyzed:\n`);

      if (unmarkedComments.rows.length === 0) {
        console.log('✅ All analyzed comments are properly marked');
        return;
      }

      unmarkedComments.rows.forEach((comment, index) => {
        console.log(`${index + 1}. Comment ID: ${comment.id}`);
        console.log(`   Post: "${comment.post_title}" (${comment.post_id})`);
        console.log(`   Author: ${comment.author}`);
        console.log(`   Created: ${new Date(comment.created_utc * 1000).toLocaleString()}`);
        console.log(`   Analyzed: ${comment.analyzed} (${comment.analyzed_at})`);
        console.log(`   Analysis Model: ${comment.llm_model || 'NULL'}`);
        console.log(`   Analysis Summary: "${comment.summary || 'NULL'}"`);
        console.log(`   Intent: ${comment.intent || 'NULL'} | Target: ${comment.target || 'NULL'} | Sentiment: ${comment.sentiment || 'NULL'}`);
        console.log(`   Category: ${comment.category || 'NULL'}`);
        console.log(`   Analysis Created: ${comment.analysis_created_at || 'NULL'}`);
        console.log(`   Body: "${(comment.body || 'N/A').substring(0, 100)}..."`);
        console.log();
      });

      return unmarkedComments.rows;

    } catch (error) {
      console.error('❌ Error finding unmarked analyzed comments:', error);
      throw error;
    }
  }

  /**
   * Get analysis statistics
   */
  async getAnalysisStats() {
    console.log('📊 Comment Analysis Statistics:\n');
    
    try {
      const stats = await query(`
        SELECT 
          COUNT(*) as total_comments,
          COUNT(CASE WHEN analyzed = true THEN 1 END) as analyzed_comments,
          COUNT(CASE WHEN analyzed = false THEN 1 END) as unanalyzed_comments,
          COUNT(CASE WHEN ac.summary = 'Analysis failed - using default values' THEN 1 END) as failed_analyses,
          COUNT(CASE WHEN ac.llm_model = 'default' THEN 1 END) as default_model_analyses,
          COUNT(CASE WHEN ac.sentiment IS NULL OR ac.intent IS NULL THEN 1 END) as null_analysis_comments,
          COUNT(CASE WHEN c.analyzed = false AND ac.comment_id IS NOT NULL THEN 1 END) as unmarked_analyzed_comments
        FROM comments c
        LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      `);

      const stat = stats.rows[0];
      console.log(`   Total Comments: ${stat.total_comments}`);
      console.log(`   Analyzed Comments: ${stat.analyzed_comments}`);
      console.log(`   Unanalyzed Comments: ${stat.unanalyzed_comments}`);
      console.log(`   Failed Analyses: ${stat.failed_analyses}`);
      console.log(`   Default Model Analyses: ${stat.default_model_analyses}`);
      console.log(`   Comments with Null Analysis: ${stat.null_analysis_comments}`);
      console.log(`   Unmarked Analyzed Comments: ${stat.unmarked_analyzed_comments}`);
      console.log();

    } catch (error) {
      console.error('❌ Error getting analysis stats:', error);
    }
  }

  /**
   * Find comments with recent analysis (last hour)
   */
  async findRecentAnalyses() {
    console.log('🔍 Finding recent comment analyses (last hour)...\n');
    
    try {
      const recentAnalyses = await query(`
        SELECT 
          c.id,
          c.body,
          c.author,
          c.post_id,
          p.title as post_title,
          ac.summary,
          ac.llm_model,
          ac.created_at as analysis_created_at
        FROM comments c
        JOIN analyses_comment ac ON c.id = ac.comment_id
        LEFT JOIN posts p ON c.post_id = p.id
        WHERE ac.created_at >= NOW() - INTERVAL '1 hour'
        ORDER BY ac.created_at DESC
        LIMIT 20
      `);

      console.log(`📊 Found ${recentAnalyses.rows.length} recent comment analyses:\n`);

      recentAnalyses.rows.forEach((analysis, index) => {
        console.log(`${index + 1}. Comment ID: ${analysis.id}`);
        console.log(`   Post: "${analysis.post_title}" (${analysis.post_id})`);
        console.log(`   Author: ${analysis.author}`);
        console.log(`   Model: ${analysis.llm_model}`);
        console.log(`   Summary: "${analysis.summary}"`);
        console.log(`   Analyzed At: ${analysis.analysis_created_at}`);
        console.log(`   Body: "${(analysis.body || 'N/A').substring(0, 80)}..."`);
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
    console.log('🔍 FAILED COMMENTS INVESTIGATION\n');
    
    try {
      await this.connect();
      
      await this.getAnalysisStats();
      await this.findFailedComments();
      await this.findCommentsWithNullAnalysis();
      await this.findUnmarkedAnalyzedComments();
      await this.findUnanalyzedComments();
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
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('find_failed_comments.js'))) {
  const finder = new FailedCommentsFinder();
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

export { FailedCommentsFinder };
