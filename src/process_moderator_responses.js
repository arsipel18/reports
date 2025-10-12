import dotenv from 'dotenv';
import ModeratorTrackingService from './moderator_tracking.js';
import { query } from './db.js';

dotenv.config();

/**
 * Process existing comments for moderator responses
 */
async function processExistingModeratorResponses() {
  const moderatorService = new ModeratorTrackingService();
  
  try {
    console.log('🔍 Processing existing comments for moderator responses...');
    
    // Get all posts that have comments
    const postsResult = await query(`
      SELECT DISTINCT p.id, p.created_utc
      FROM posts p
      JOIN comments c ON p.id = c.post_id
      ORDER BY p.created_utc DESC
    `);
    
    console.log(`📊 Found ${postsResult.rows.length} posts with comments to process`);
    
    let totalResponses = 0;
    let processedPosts = 0;
    
    for (const post of postsResult.rows) {
      try {
        const responseCount = await moderatorService.processModeratorResponses(post.id);
        totalResponses += responseCount;
        processedPosts++;
        
        if (processedPosts % 10 === 0) {
          console.log(`📈 Processed ${processedPosts}/${postsResult.rows.length} posts, found ${totalResponses} moderator responses`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing post ${post.id}:`, error.message);
      }
    }
    
    console.log(`✅ Processed ${processedPosts} posts, found ${totalResponses} moderator responses`);
    
    // Update moderator statistics
    if (totalResponses > 0) {
      console.log('📊 Updating moderator statistics...');
      await moderatorService.updateModeratorStats();
      
      // Display statistics
      const stats = await moderatorService.getModeratorStats();
      const overallMetrics = await moderatorService.getOverallModeratorMetrics();
      
      console.log('\n📈 Moderator Response Statistics:');
      console.log(`📊 Overall Metrics:`);
      console.log(`   Total responses: ${overallMetrics.total_responses}`);
      console.log(`   Average response time: ${moderatorService.formatDuration(overallMetrics.avg_response_time_seconds)}`);
      console.log(`   Fastest response: ${moderatorService.formatDuration(overallMetrics.fastest_response_seconds)}`);
      console.log(`   Slowest response: ${moderatorService.formatDuration(overallMetrics.slowest_response_seconds)}`);
      console.log(`   Unique moderators: ${overallMetrics.unique_moderators}`);
      console.log(`   Posts with responses: ${overallMetrics.posts_with_responses}`);
      
      console.log(`\n👮 Individual Moderator Stats:`);
      stats.forEach(mod => {
        console.log(`   ${mod.moderator_username}:`);
        console.log(`     Responses: ${mod.total_responses}`);
        console.log(`     Avg time: ${moderatorService.formatDuration(mod.avg_response_time_seconds)}`);
        console.log(`     First responses: ${mod.first_responses}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to process moderator responses:', error);
    throw error;
  } finally {
    await moderatorService.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('process_moderator_responses.js')) {
  processExistingModeratorResponses()
    .then(() => {
      console.log('✅ Moderator response processing completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Moderator response processing failed:', error);
      process.exit(1);
    });
}

export { processExistingModeratorResponses };
