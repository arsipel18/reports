import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { createDbConnection, closeDb, query } from './db.js';

dotenv.config();

/**
 * One-time script to mark comments as analyzed if they have analysis data
 * This fixes the issue where comments have analysis but are not marked as analyzed=true
 */
class MarkAnalyzedComments {
  constructor() {
    this.batchSize = 100; // Process in batches
  }

  async connect() {
    this.pool = await createDbConnection();
    console.log('✅ Connected to database');
  }

  /**
   * Find comments that have analysis but are not marked as analyzed
   */
  async findUnmarkedAnalyzedComments() {
    const queryText = `
      SELECT c.id, c.analyzed, ac.sentiment, ac.intent, ac.category
      FROM comments c 
      INNER JOIN analyses_comment ac ON c.id = ac.comment_id 
      WHERE c.analyzed = false
      ORDER BY c.created_utc DESC
    `;
    
    const result = await query(queryText);
    console.log(`📊 Found ${result.rows.length} comments with analysis but not marked as analyzed`);
    return result.rows;
  }

  /**
   * Mark a batch of comments as analyzed
   */
  async markCommentsAsAnalyzed(commentIds) {
    if (commentIds.length === 0) return 0;

    const placeholders = commentIds.map((_, index) => `$${index + 1}`).join(',');
    const queryText = `
      UPDATE comments 
      SET analyzed = true, analyzed_at = NOW() 
      WHERE id IN (${placeholders})
    `;
    
    try {
      const result = await query(queryText, commentIds);
      console.log(`✅ Marked ${result.rowCount} comments as analyzed`);
      return result.rowCount;
    } catch (error) {
      console.error(`❌ Error marking comments as analyzed:`, error);
      throw error;
    }
  }

  /**
   * Process comments in batches
   */
  async processBatches(comments) {
    let totalProcessed = 0;
    let totalBatches = Math.ceil(comments.length / this.batchSize);
    
    console.log(`📦 Processing ${comments.length} comments in ${totalBatches} batches of ${this.batchSize}`);
    
    for (let i = 0; i < comments.length; i += this.batchSize) {
      const batch = comments.slice(i, i + this.batchSize);
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      
      console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} comments)`);
      
      const commentIds = batch.map(comment => comment.id);
      const processed = await this.markCommentsAsAnalyzed(commentIds);
      totalProcessed += processed;
      
      console.log(`✅ Batch ${batchNumber} complete: ${processed} comments marked as analyzed`);
    }
    
    return totalProcessed;
  }

  /**
   * Verify the results
   */
  async verifyResults() {
    console.log('\n🔍 Verifying results...');
    
    // Check for remaining unmarked analyzed comments
    const remaining = await this.findUnmarkedAnalyzedComments();
    
    if (remaining.length === 0) {
      console.log('✅ All comments with analysis are now marked as analyzed');
    } else {
      console.log(`⚠️ ${remaining.length} comments still have analysis but are not marked as analyzed`);
    }
    
    // Get final statistics
    const stats = await query(`
      SELECT 
        COUNT(*) as total_comments,
        COUNT(CASE WHEN analyzed = true THEN 1 END) as analyzed_comments,
        COUNT(CASE WHEN analyzed = false THEN 1 END) as unanalyzed_comments,
        COUNT(CASE WHEN analyzed = false AND id IN (SELECT comment_id FROM analyses_comment) THEN 1 END) as unmarked_analyzed_comments
      FROM comments
    `);
    
    const statsRow = stats.rows[0];
    console.log('\n📊 Final Statistics:');
    console.log(`  • Total comments: ${statsRow.total_comments}`);
    console.log(`  • Analyzed comments: ${statsRow.analyzed_comments}`);
    console.log(`  • Unanalyzed comments: ${statsRow.unanalyzed_comments}`);
    console.log(`  • Unmarked analyzed comments: ${statsRow.unmarked_analyzed_comments}`);
    
    return remaining.length === 0;
  }

  /**
   * Run the complete process
   */
  async run() {
    console.log('🚀 Starting to mark analyzed comments as analyzed...');
    const startTime = Date.now();
    
    try {
      await this.connect();
      
      // Find comments that need to be marked
      const unmarkedComments = await this.findUnmarkedAnalyzedComments();
      
      if (unmarkedComments.length === 0) {
        console.log('✅ No comments need to be marked as analyzed');
        return;
      }
      
      // Process in batches
      const totalProcessed = await this.processBatches(unmarkedComments);
      
      // Verify results
      const success = await this.verifyResults();
      
      const duration = Math.round((Date.now() - startTime) / 1000);
      console.log('\n🎉 Mark analyzed comments process completed!');
      console.log(`📊 Results:`);
      console.log(`  • Comments processed: ${totalProcessed}`);
      console.log(`  • Total time: ${duration} seconds`);
      console.log(`  • Success: ${success ? '✅' : '⚠️'}`);
      
    } catch (error) {
      console.error('❌ Mark analyzed comments process failed:', error);
      throw error;
    } finally {
      await closeDb();
      console.log('📴 Database connection closed');
    }
  }
}

// CLI Interface
async function runMarkAnalyzedComments() {
  console.log('🚀 Starting mark analyzed comments script...');
  const marker = new MarkAnalyzedComments();
  
  try {
    await marker.run();
    console.log('✅ Mark analyzed comments completed successfully');
  } catch (error) {
    console.error('❌ Mark analyzed comments failed:', error);
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

// Run the script only when called directly
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('mark_analyzed_comments.js'))) {
  console.log('🚀 Mark analyzed comments script starting...');
  runMarkAnalyzedComments()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

export { MarkAnalyzedComments };
