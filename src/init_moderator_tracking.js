import dotenv from 'dotenv';
import ModeratorTrackingService from './moderator_tracking.js';

dotenv.config();

/**
 * Initialize moderator tracking tables
 */
async function initializeModeratorTracking() {
  const moderatorService = new ModeratorTrackingService();
  
  try {
    console.log('🚀 Initializing moderator tracking tables...');
    
    await moderatorService.initializeTables();
    
    console.log('✅ Moderator tracking tables initialized successfully!');
    console.log('📊 Tables created:');
    console.log('  • moderator_responses - Individual moderator responses');
    console.log('  • moderator_stats - Aggregated moderator statistics');
    console.log('🔍 Indexes created for optimal performance');
    
  } catch (error) {
    console.error('❌ Failed to initialize moderator tracking:', error);
    throw error;
  } finally {
    await moderatorService.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('init_moderator_tracking.js')) {
  initializeModeratorTracking()
    .then(() => {
      console.log('✅ Moderator tracking initialization completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Moderator tracking initialization failed:', error);
      process.exit(1);
    });
}

export { initializeModeratorTracking };
