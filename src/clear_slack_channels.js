import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';

dotenv.config();

/**
 * Clear Slack Channel Configuration Script
 * 
 * This script clears all Slack channel configuration data from the database
 * to prepare for migrating the app to a new Slack workspace.
 * 
 * Usage: node src/clear_slack_channels.js
 */

class SlackChannelCleaner {
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
   * Show current channel configuration before clearing
   */
  async showCurrentConfiguration() {
    console.log('\n📋 CURRENT CHANNEL CONFIGURATION:');
    console.log('='.repeat(60));

    try {
      // Show channel configs
      const channelConfigs = await query(`
        SELECT channel_id, channel_name, workspace_id, is_active, created_at
        FROM channel_configs
        ORDER BY created_at DESC
      `);

      if (channelConfigs.rows.length === 0) {
        console.log('❌ No channel configurations found');
        return;
      }

      console.log(`\n🏢 Found ${channelConfigs.rows.length} channel configuration(s):`);
      channelConfigs.rows.forEach((config, index) => {
        console.log(`  ${index + 1}. Channel: #${config.channel_name}`);
        console.log(`     ID: ${config.channel_id}`);
        console.log(`     Workspace: ${config.workspace_id}`);
        console.log(`     Status: ${config.is_active ? '✅ Active' : '❌ Inactive'}`);
        console.log(`     Created: ${new Date(config.created_at).toLocaleString()}`);
        console.log('');
      });

      // Show report preferences
      const reportPrefs = await query(`
        SELECT crp.channel_id, cc.channel_name, crp.report_type, crp.report_name, crp.enabled, crp.categories
        FROM channel_report_preferences crp
        JOIN channel_configs cc ON crp.channel_id = cc.channel_id
        ORDER BY cc.channel_name, crp.report_type
      `);

      if (reportPrefs.rows.length > 0) {
        console.log(`📊 Found ${reportPrefs.rows.length} report preference(s):`);
        reportPrefs.rows.forEach((pref, index) => {
          const categories = pref.categories && pref.categories.length > 0 
            ? pref.categories.join(', ') 
            : 'All categories';
          console.log(`  ${index + 1}. #${pref.channel_name} - ${pref.report_type} (${pref.report_name}): ${pref.enabled ? '✅' : '❌'} - ${categories}`);
        });
      }

      // Show notification settings
      const notifications = await query(`
        SELECT cn.channel_id, cc.channel_name, cn.notification_type, cn.enabled
        FROM channel_notifications cn
        JOIN channel_configs cc ON cn.channel_id = cc.channel_id
        ORDER BY cc.channel_name, cn.notification_type
      `);

      if (notifications.rows.length > 0) {
        console.log(`\n🔔 Found ${notifications.rows.length} notification setting(s):`);
        notifications.rows.forEach((notif, index) => {
          console.log(`  ${index + 1}. #${notif.channel_name} - ${notif.notification_type}: ${notif.enabled ? '✅' : '❌'}`);
        });
      }

      // Show admins
      const admins = await query(`
        SELECT ca.channel_id, cc.channel_name, ca.user_name, ca.permission_level
        FROM channel_admins ca
        JOIN channel_configs cc ON ca.channel_id = cc.channel_id
        ORDER BY cc.channel_name, ca.user_name
      `);

      if (admins.rows.length > 0) {
        console.log(`\n👥 Found ${admins.rows.length} admin user(s):`);
        admins.rows.forEach((admin, index) => {
          console.log(`  ${index + 1}. #${admin.channel_name} - ${admin.user_name} (${admin.permission_level})`);
        });
      }

      // Show activity log count
      const activityCount = await query(`
        SELECT COUNT(*) as count
        FROM channel_activity_log
      `);

      console.log(`\n📝 Activity log entries: ${activityCount.rows[0].count}`);

    } catch (error) {
      console.error('❌ Error showing current configuration:', error);
      throw error;
    }
  }

  /**
   * Clear all Slack channel configuration data
   */
  async clearAllChannelData() {
    console.log('\n🗑️  CLEARING ALL CHANNEL CONFIGURATION DATA...');
    console.log('='.repeat(60));

    try {
      // Start transaction
      await query('BEGIN');

      // Clear in order (respecting foreign key constraints)
      console.log('1. Clearing channel activity log...');
      const activityResult = await query('DELETE FROM channel_activity_log');
      console.log(`   ✅ Deleted ${activityResult.rowCount} activity log entries`);

      console.log('2. Clearing channel admins...');
      const adminsResult = await query('DELETE FROM channel_admins');
      console.log(`   ✅ Deleted ${adminsResult.rowCount} admin users`);

      console.log('3. Clearing channel notifications...');
      const notificationsResult = await query('DELETE FROM channel_notifications');
      console.log(`   ✅ Deleted ${notificationsResult.rowCount} notification settings`);

      console.log('4. Clearing channel report preferences...');
      const reportPrefsResult = await query('DELETE FROM channel_report_preferences');
      console.log(`   ✅ Deleted ${reportPrefsResult.rowCount} report preferences`);

      console.log('5. Clearing channel configurations...');
      const channelConfigsResult = await query('DELETE FROM channel_configs');
      console.log(`   ✅ Deleted ${channelConfigsResult.rowCount} channel configurations`);

      // Commit transaction
      await query('COMMIT');

      console.log('\n✅ All channel configuration data cleared successfully!');
      console.log('🎯 Database is now ready for new Slack workspace configuration.');

    } catch (error) {
      // Rollback on error
      await query('ROLLBACK');
      console.error('❌ Error clearing channel data:', error);
      throw error;
    }
  }

  /**
   * Verify that all data has been cleared
   */
  async verifyClearing() {
    console.log('\n🔍 VERIFYING DATA CLEARING...');
    console.log('='.repeat(40));

    try {
      const tables = [
        'channel_configs',
        'channel_report_preferences', 
        'channel_notifications',
        'channel_admins',
        'channel_activity_log'
      ];

      for (const table of tables) {
        const result = await query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = result.rows[0].count;
        console.log(`${count === 0 ? '✅' : '❌'} ${table}: ${count} records`);
      }

      console.log('\n🎉 Verification complete!');
      
    } catch (error) {
      console.error('❌ Error verifying clearing:', error);
      throw error;
    }
  }

  /**
   * Show next steps for setting up new workspace
   */
  showNextSteps() {
    console.log('\n🚀 NEXT STEPS FOR NEW SLACK WORKSPACE:');
    console.log('='.repeat(50));
    console.log('1. Add the bot to your new Slack workspace');
    console.log('2. Invite the bot to the channels where you want reports');
    console.log('3. In each channel, run: /setup');
    console.log('4. Configure report preferences with: /config');
    console.log('5. Test with: /report daily');
    console.log('');
    console.log('📚 Available commands in new workspace:');
    console.log('  • /setup - Configure channel for reports');
    console.log('  • /config - View/modify channel settings');
    console.log('  • /report <period> [categories] - Generate reports');
    console.log('  • /help - Show all available commands');
    console.log('');
    console.log('🎯 Your bot is now ready for the new Slack workspace!');
  }

  /**
   * Main execution method
   */
  async run() {
    console.log('🧹 SLACK CHANNEL CONFIGURATION CLEANER');
    console.log('='.repeat(60));
    console.log('This script will clear ALL Slack channel configuration data');
    console.log('from the database to prepare for migrating to a new workspace.');
    console.log('');

    try {
      await this.connect();

      // Show current configuration
      await this.showCurrentConfiguration();

      // Ask for confirmation
      console.log('\n⚠️  WARNING: This will permanently delete all channel configuration data!');
      console.log('This includes:');
      console.log('  • Channel configurations');
      console.log('  • Report preferences');
      console.log('  • Notification settings');
      console.log('  • Admin users');
      console.log('  • Activity logs');
      console.log('');
      console.log('Press Ctrl+C to cancel, or wait 10 seconds to continue...');

      // Wait 10 seconds for user to cancel
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Clear all data
      await this.clearAllChannelData();

      // Verify clearing
      await this.verifyClearing();

      // Show next steps
      this.showNextSteps();

    } catch (error) {
      console.error('❌ Script failed:', error);
      process.exit(1);
    } finally {
      await this.disconnect();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Script cancelled by user');
  console.log('✅ No changes were made to the database');
  process.exit(0);
});

// Main execution
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('clear_slack_channels.js')) {
  const cleaner = new SlackChannelCleaner();
  
  cleaner.run()
    .then(() => {
      console.log('\n✅ Slack channel clearing completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Slack channel clearing failed:', error);
      process.exit(1);
    });
}

export { SlackChannelCleaner };
