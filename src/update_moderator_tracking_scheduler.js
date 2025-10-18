import dotenv from 'dotenv';
import { Pool } from 'pg';
import ModeratorTrackingService from './moderator_tracking.js';

dotenv.config();

/**
 * Update moderator tracking tables without closing the database pool
 * This version is designed to be called from the scheduler
 */
export async function updateModeratorTrackingForScheduler() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Updating moderator tracking tables...');
    console.log('=' .repeat(60));
    
    // Initialize moderator tracking service
    const moderatorTracking = new ModeratorTrackingService();
    await moderatorTracking.initialize();
    
    // Get current statistics
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_comments,
        COUNT(CASE WHEN distinguished = 'moderator' THEN 1 END) as moderator_comments
      FROM comments
    `);
    
    const existingResult = await pool.query(`
      SELECT COUNT(*) as existing_responses FROM moderator_responses
    `);
    
    console.log('📊 Current data:');
    console.log(`  Total comments: ${statsResult.rows[0].total_comments}`);
    console.log(`  Moderator comments: ${statsResult.rows[0].moderator_comments}`);
    console.log(`  Existing moderator responses: ${existingResult.rows[0].existing_responses}`);
    
    // Find posts with moderator comments that need tracking
    const postsWithModeratorsResult = await pool.query(`
      SELECT DISTINCT p.id, p.title, p.created_utc
      FROM posts p
      JOIN comments c ON p.id = c.post_id
      WHERE c.distinguished = 'moderator'
      AND NOT EXISTS (
        SELECT 1 FROM moderator_responses mr 
        WHERE mr.post_id = p.id
      )
      ORDER BY p.created_utc DESC
    `);
    
    console.log(`\n🔍 Found ${postsWithModeratorsResult.rows.length} posts with moderator comments that need tracking`);
    
    if (postsWithModeratorsResult.rows.length === 0) {
      console.log('✅ All posts with moderator comments are already tracked');
      return;
    }
    
    console.log(`📝 Processing ${postsWithModeratorsResult.rows.length} posts...`);
    
    let processedCount = 0;
    let addedCount = 0;
    let errorCount = 0;
    
    for (const post of postsWithModeratorsResult.rows) {
      try {
        console.log(`📊 Progress: ${processedCount}/${postsWithModeratorsResult.rows.length} posts processed`);
        
        const newResponses = await moderatorTracking.processModeratorResponses(post.id);
        addedCount += newResponses;
        processedCount++;
        
      } catch (error) {
        console.error(`❌ Error processing post ${post.id}:`, error.message);
        errorCount++;
        processedCount++;
      }
    }
    
    console.log(`📊 Processing completed: ${processedCount}/${postsWithModeratorsResult.rows.length} posts processed`);
    
    // Update moderator statistics
    console.log('📊 Updating moderator statistics...');
    await moderatorTracking.updateModeratorStats();
    
    // Final verification
    const finalResult = await pool.query(`
      SELECT 
        COUNT(*) as total_responses,
        COUNT(DISTINCT moderator_username) as unique_moderators,
        COUNT(DISTINCT post_id) as posts_with_responses
      FROM moderator_responses
    `);
    
    console.log('\n🎉 Final Update Summary:');
    console.log('=' .repeat(60));
    console.log(`Posts processed: ${processedCount}`);
    console.log(`Moderator responses added: ${addedCount}`);
    console.log(`Errors encountered: ${errorCount}`);
    console.log(`Total moderator responses: ${finalResult.rows[0].total_responses}`);
    console.log(`Unique moderators: ${finalResult.rows[0].unique_moderators}`);
    console.log(`Posts with responses: ${finalResult.rows[0].posts_with_responses}`);
    
    console.log('\n✅ Moderator tracking update completed successfully');
    
  } catch (error) {
    console.error('❌ Error updating moderator tracking:', error);
    throw error;
  } finally {
    await pool.end();
  }
}
