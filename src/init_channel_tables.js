import ChannelConfigService from './channel_config_service.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Initialize multi-channel database tables
 */
async function initializeChannelTables() {
  const channelConfig = new ChannelConfigService();
  
  try {
    console.log('🚀 Initializing multi-channel database tables...');
    
    await channelConfig.initializeTables();
    
    console.log('✅ Multi-channel database initialization completed successfully!');
    console.log('📊 Tables created:');
    console.log('  • channel_configs - Channel configurations');
    console.log('  • channel_report_preferences - Report preferences per channel');
    console.log('  • channel_notifications - Notification settings');
    console.log('  • channel_admins - Channel administrators');
    console.log('  • channel_activity_log - Activity tracking');
    
  } catch (error) {
    console.error('❌ Failed to initialize channel tables:', error);
    process.exit(1);
  } finally {
    await channelConfig.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('init_channel_tables.js')) {
  initializeChannelTables()
    .then(() => {
      console.log('✅ Channel tables initialization script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Channel tables initialization script failed:', error);
      process.exit(1);
    });
}

export { initializeChannelTables };
