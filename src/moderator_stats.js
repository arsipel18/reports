import dotenv from 'dotenv';
import ModeratorTrackingService from './moderator_tracking.js';

dotenv.config();

/**
 * Display moderator response statistics
 */
async function displayModeratorStats() {
  const moderatorService = new ModeratorTrackingService();
  
  try {
    console.log('📊 Moderator Response Statistics\n');
    
    // Get overall metrics
    const overallMetrics = await moderatorService.getOverallModeratorMetrics();
    
    console.log('📈 Overall Metrics:');
    console.log(`   Total responses: ${overallMetrics.total_responses}`);
    console.log(`   Average response time: ${moderatorService.formatDuration(overallMetrics.avg_response_time_seconds)}`);
    console.log(`   Fastest response: ${moderatorService.formatDuration(overallMetrics.fastest_response_seconds)}`);
    console.log(`   Slowest response: ${moderatorService.formatDuration(overallMetrics.slowest_response_seconds)}`);
    console.log(`   Unique moderators: ${overallMetrics.unique_moderators}`);
    console.log(`   Posts with responses: ${overallMetrics.posts_with_responses}`);
    console.log(`   First responses: ${overallMetrics.first_responses}`);
    
    // Get individual moderator stats
    const individualStats = await moderatorService.getModeratorStats();
    
    if (individualStats.length > 0) {
      console.log('\n👮 Individual Moderator Stats:');
      individualStats.forEach((mod, index) => {
        console.log(`   ${index + 1}. ${mod.moderator_username}:`);
        console.log(`      Total responses: ${mod.total_responses}`);
        console.log(`      Average response time: ${moderatorService.formatDuration(mod.avg_response_time_seconds)}`);
        console.log(`      Fastest response: ${moderatorService.formatDuration(mod.fastest_response_seconds)}`);
        console.log(`      Slowest response: ${moderatorService.formatDuration(mod.slowest_response_seconds)}`);
        console.log(`      First responses: ${mod.first_responses}`);
        console.log(`      Last updated: ${new Date(mod.last_updated).toLocaleString()}`);
        console.log('');
      });
    } else {
      console.log('\n❌ No moderator statistics found. Run the processing script first.');
    }
    
    // Response time distribution
    if (overallMetrics.total_responses > 0) {
      console.log('⏱️ Response Time Analysis:');
      
      const avgHours = overallMetrics.avg_response_time_seconds / 3600;
      const avgDays = avgHours / 24;
      
      if (avgDays >= 1) {
        console.log(`   Average response time: ${avgDays.toFixed(1)} days`);
      } else if (avgHours >= 1) {
        console.log(`   Average response time: ${avgHours.toFixed(1)} hours`);
      } else {
        const avgMinutes = overallMetrics.avg_response_time_seconds / 60;
        console.log(`   Average response time: ${avgMinutes.toFixed(1)} minutes`);
      }
      
      // Performance assessment
      if (overallMetrics.avg_response_time_seconds < 3600) { // Less than 1 hour
        console.log('   🟢 Excellent response time!');
      } else if (overallMetrics.avg_response_time_seconds < 86400) { // Less than 1 day
        console.log('   🟡 Good response time');
      } else if (overallMetrics.avg_response_time_seconds < 259200) { // Less than 3 days
        console.log('   🟠 Moderate response time');
      } else {
        console.log('   🔴 Slow response time - may need attention');
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to display moderator stats:', error);
    throw error;
  } finally {
    await moderatorService.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('moderator_stats.js')) {
  displayModeratorStats()
    .then(() => {
      console.log('✅ Moderator stats display completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Moderator stats display failed:', error);
      process.exit(1);
    });
}

export { displayModeratorStats };
