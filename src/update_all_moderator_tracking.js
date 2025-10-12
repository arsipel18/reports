import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
});

/**
 * Update ALL moderator tracking tables with newly marked moderator comments
 */
async function updateAllModeratorTracking() {
  try {
    console.log('🔄 Updating ALL moderator tracking tables...');
    console.log('=' .repeat(60));
    
    // First, let's see what we have
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_comments,
        COUNT(CASE WHEN distinguished = 'moderator' THEN 1 END) as moderator_comments
      FROM comments
    `);
    
    const stats = statsResult.rows[0];
    console.log(`📊 Current data:`);
    console.log(`  Total comments: ${stats.total_comments}`);
    console.log(`  Moderator comments: ${stats.moderator_comments}`);
    
    // Check existing moderator responses
    const existingResponsesResult = await pool.query(`
      SELECT COUNT(*) as count FROM moderator_responses
    `);
    console.log(`  Existing moderator responses: ${existingResponsesResult.rows[0].count}`);
    
    // Get ALL posts that have moderator comments but no moderator responses tracked
    const postsWithModeratorsResult = await pool.query(`
      SELECT DISTINCT p.id, p.title, p.created_utc
      FROM posts p
      JOIN comments c ON p.id = c.post_id
      WHERE c.distinguished = 'moderator'
      AND p.id NOT IN (
        SELECT DISTINCT post_id FROM moderator_responses
      )
      ORDER BY p.created_utc DESC
    `);
    
    console.log(`\n🔍 Found ${postsWithModeratorsResult.rows.length} posts with moderator comments that need tracking`);
    
    if (postsWithModeratorsResult.rows.length === 0) {
      console.log('✅ All posts with moderator comments are already tracked');
      return;
    }
    
    // Process each post
    let processedCount = 0;
    let totalResponses = 0;
    let errorCount = 0;
    
    console.log(`\n📝 Processing ${postsWithModeratorsResult.rows.length} posts...`);
    
    for (let i = 0; i < postsWithModeratorsResult.rows.length; i++) {
      const post = postsWithModeratorsResult.rows[i];
      
      if (i % 10 === 0) {
        console.log(`\n📊 Progress: ${i}/${postsWithModeratorsResult.rows.length} posts processed`);
      }
      
      try {
        // Get all comments for this post
        const commentsResult = await pool.query(`
          SELECT c.*, p.created_utc as post_created_utc
          FROM comments c
          JOIN posts p ON c.post_id = p.id
          WHERE c.post_id = $1
          ORDER BY c.created_utc ASC
        `, [post.id]);

        const comments = commentsResult.rows;
        const postCreatedUtc = post.created_utc;
        const moderatorResponses = [];

        // Find moderator comments
        for (const comment of comments) {
          if (comment.distinguished === 'moderator') {
            const responseTimeSeconds = comment.created_utc - postCreatedUtc;
            
            // Check if this is the first moderator response for this post
            const isFirstResponse = !moderatorResponses.some(response => 
              response.post_id === post.id
            );

            moderatorResponses.push({
              post_id: post.id,
              comment_id: comment.id,
              moderator_username: comment.author,
              response_time_seconds: responseTimeSeconds,
              post_created_utc: postCreatedUtc,
              comment_created_utc: comment.created_utc,
              is_first_response: isFirstResponse
            });
          }
        }

        // Save moderator responses
        for (const response of moderatorResponses) {
          try {
            await pool.query(`
              INSERT INTO moderator_responses (
                post_id, comment_id, moderator_username, response_time_seconds,
                post_created_utc, comment_created_utc, is_first_response
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (post_id, comment_id) DO NOTHING
            `, [
              response.post_id,
              response.comment_id,
              response.moderator_username,
              response.response_time_seconds,
              response.post_created_utc,
              response.comment_created_utc,
              response.is_first_response
            ]);
            
            totalResponses++;
          } catch (error) {
            console.error(`❌ Error saving response for ${response.comment_id}:`, error.message);
            errorCount++;
          }
        }

        if (moderatorResponses.length > 0) {
          processedCount++;
        }
        
      } catch (error) {
        console.error(`❌ Error processing post ${post.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n📊 Processing completed: ${processedCount}/${postsWithModeratorsResult.rows.length} posts processed`);
    
    // Update moderator stats
    console.log('\n📊 Updating moderator statistics...');
    await pool.query(`
      INSERT INTO moderator_stats (
        moderator_username,
        total_responses,
        avg_response_time_seconds,
        fastest_response_seconds,
        slowest_response_seconds,
        first_responses
      )
      SELECT 
        moderator_username,
        COUNT(*) as total_responses,
        AVG(response_time_seconds)::INTEGER as avg_response_time_seconds,
        MIN(response_time_seconds) as fastest_response_seconds,
        MAX(response_time_seconds) as slowest_response_seconds,
        COUNT(CASE WHEN is_first_response = true THEN 1 END) as first_responses
      FROM moderator_responses
      GROUP BY moderator_username
      ON CONFLICT (moderator_username) DO UPDATE SET
        total_responses = EXCLUDED.total_responses,
        avg_response_time_seconds = EXCLUDED.avg_response_time_seconds,
        fastest_response_seconds = EXCLUDED.fastest_response_seconds,
        slowest_response_seconds = EXCLUDED.slowest_response_seconds,
        first_responses = EXCLUDED.first_responses,
        last_updated = NOW()
    `);
    
    // Show final stats
    const finalStatsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_responses,
        COUNT(DISTINCT moderator_username) as unique_moderators,
        COUNT(DISTINCT post_id) as posts_with_responses
      FROM moderator_responses
    `);
    
    const finalStats = finalStatsResult.rows[0];
    
    console.log('\n🎉 Final Update Summary:');
    console.log('=' .repeat(60));
    console.log(`Posts processed: ${processedCount}`);
    console.log(`Moderator responses added: ${totalResponses}`);
    console.log(`Errors encountered: ${errorCount}`);
    console.log(`Total moderator responses: ${finalStats.total_responses}`);
    console.log(`Unique moderators: ${finalStats.unique_moderators}`);
    console.log(`Posts with responses: ${finalStats.posts_with_responses}`);
    
    // Verify we got all moderator comments
    const verificationResult = await pool.query(`
      SELECT 
        COUNT(*) as moderator_comments_in_tracking,
        (SELECT COUNT(*) FROM comments WHERE distinguished = 'moderator') as total_moderator_comments
      FROM moderator_responses
    `);
    
    const verification = verificationResult.rows[0];
    console.log(`\n✅ Verification:`);
    console.log(`  Moderator comments in tracking: ${verification.moderator_comments_in_tracking}`);
    console.log(`  Total moderator comments: ${verification.total_moderator_comments}`);
    console.log(`  Coverage: ${Math.round((verification.moderator_comments_in_tracking / verification.total_moderator_comments) * 100)}%`);
    
    // Show moderator stats
    const moderatorStatsResult = await pool.query(`
      SELECT 
        moderator_username,
        total_responses,
        avg_response_time_seconds,
        first_responses
      FROM moderator_stats
      ORDER BY total_responses DESC
      LIMIT 15
    `);
    
    console.log('\n👮 Top Moderators:');
    moderatorStatsResult.rows.forEach((mod, index) => {
      const avgMinutes = Math.round(mod.avg_response_time_seconds / 60);
      console.log(`${index + 1}. ${mod.moderator_username}: ${mod.total_responses} responses, ${avgMinutes}min avg, ${mod.first_responses} first responses`);
    });
    
  } catch (error) {
    console.error('❌ Error updating moderator tracking:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('update_all_moderator_tracking.js')) {
  updateAllModeratorTracking()
    .then(() => {
      console.log('✅ Complete moderator tracking update completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Complete moderator tracking update failed:', error);
      process.exit(1);
    });
}

export { updateAllModeratorTracking };
