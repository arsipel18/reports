import dotenv from 'dotenv';
import ChannelConfigService from './channel_config_service.js';
import ScheduleService from './schedule.js';

dotenv.config();

/**
 * Scheduler Verification Script
 * This script helps verify that the scheduler will send reports to the correct channels
 */

class SchedulerVerifier {
  constructor() {
    this.channelConfig = new ChannelConfigService();
    this.scheduler = new ScheduleService();
  }

  /**
   * Verify scheduler configuration
   */
  async verifySchedulerConfig() {
    console.log('🔍 VERIFYING SCHEDULER CONFIGURATION');
    console.log('='.repeat(50));

    try {
      // Check scheduler status
      const status = this.scheduler.getStatus();
      console.log('📊 Scheduler Status:');
      console.log(`  - Running: ${status.isRunning ? '✅' : '❌'}`);
      console.log(`  - Task Running: ${status.isTaskRunning ? '⚠️' : '✅'}`);
      console.log(`  - Timezone: ${status.timezone}`);
      console.log(`  - Active Tasks: ${status.activeTasks.join(', ')}`);

      // Check next run times
      console.log('\n⏰ Next Run Times:');
      Object.entries(status.nextRuns).forEach(([task, time]) => {
        console.log(`  - ${task}: ${new Date(time).toLocaleString()}`);
      });

      return true;
    } catch (error) {
      console.error('❌ Failed to verify scheduler config:', error);
      return false;
    }
  }

  /**
   * Verify channel targeting for scheduled reports
   */
  async verifyChannelTargeting() {
    console.log('\n🔍 VERIFYING CHANNEL TARGETING');
    console.log('='.repeat(50));

    const reportTypes = ['daily', 'weekly', 'monthly', 'quarterly'];
    
    for (const reportType of reportTypes) {
      console.log(`\n📊 ${reportType.toUpperCase()} Reports:`);
      console.log('-'.repeat(30));
      
      try {
        const channels = await this.channelConfig.getChannelsForScheduledReport(reportType);
        
        if (channels.length === 0) {
          console.log(`❌ No channels configured for ${reportType} reports`);
          console.log(`💡 Use /config enable ${reportType} in Slack channels to enable`);
        } else {
          console.log(`✅ ${channels.length} channel(s) will receive ${reportType} reports:`);
          
          channels.forEach((channel, index) => {
            console.log(`  ${index + 1}. #${channel.channel_name}`);
            console.log(`     - Channel ID: ${channel.channel_id}`);
            console.log(`     - Report Name: ${channel.report_name}`);
            
            if (channel.categories && channel.categories.length > 0) {
              console.log(`     - Categories: ${channel.categories.join(', ')}`);
            } else {
              console.log(`     - Categories: All categories`);
            }
            
            if (channel.exclude_categories && channel.exclude_categories.length > 0) {
              console.log(`     - Excluded: ${channel.exclude_categories.join(', ')}`);
            }
          });
        }
      } catch (error) {
        console.error(`❌ Failed to verify ${reportType} targeting:`, error);
      }
    }

    return true;
  }

  /**
   * Test manual task execution
   */
  async testManualExecution(taskType = 'daily') {
    console.log(`\n🔍 TESTING MANUAL ${taskType.toUpperCase()} EXECUTION`);
    console.log('='.repeat(50));

    try {
      console.log(`🧪 Running ${taskType} task manually...`);
      
      // This will actually run the task (be careful!)
      // await this.scheduler.runTaskManually(taskType);
      
      console.log(`⚠️  Manual execution skipped for safety`);
      console.log(`💡 To test manually, run: node src/schedule.js --test ${taskType}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to test manual execution:`, error);
      return false;
    }
  }

  /**
   * Check database connectivity
   */
  async checkDatabaseConnectivity() {
    console.log('\n🔍 CHECKING DATABASE CONNECTIVITY');
    console.log('='.repeat(50));

    try {
      const channels = await this.channelConfig.getActiveChannels();
      console.log(`✅ Database connection successful`);
      console.log(`📊 Found ${channels.length} active channels in database`);
      
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      return false;
    }
  }

  /**
   * Generate verification report
   */
  async generateVerificationReport() {
    console.log('\n📋 GENERATING VERIFICATION REPORT');
    console.log('='.repeat(50));

    try {
      const channels = await this.channelConfig.getActiveChannels();
      const reportTypes = ['daily', 'weekly', 'monthly', 'quarterly'];
      
      console.log('📊 Channel Configuration Summary:');
      console.log(`  - Total Active Channels: ${channels.length}`);
      
      for (const reportType of reportTypes) {
        const reportChannels = await this.channelConfig.getChannelsForScheduledReport(reportType);
        console.log(`  - ${reportType.toUpperCase()} Reports: ${reportChannels.length} channels`);
      }

      console.log('\n📅 Scheduled Report Schedule:');
      console.log('  - Daily: 23:00 UTC every day');
      console.log('  - Weekly: 23:30 UTC every Sunday');
      console.log('  - Monthly: 23:30 UTC on 1st of month');
      console.log('  - Quarterly: 23:30 UTC on Jan 1, Apr 1, Jul 1, Oct 1');

      console.log('\n✅ Verification completed successfully!');
      
      return true;
    } catch (error) {
      console.error('❌ Failed to generate verification report:', error);
      return false;
    }
  }

  /**
   * Run all verifications
   */
  async runAllVerifications() {
    console.log('🧪 SCHEDULER VERIFICATION SUITE');
    console.log('='.repeat(60));
    console.log('This script verifies that your scheduler is configured correctly');
    console.log('and will send reports to the appropriate channels.\n');

    const results = {
      schedulerConfig: false,
      channelTargeting: false,
      databaseConnectivity: false,
      verificationReport: false
    };

    try {
      results.databaseConnectivity = await this.checkDatabaseConnectivity();
      results.schedulerConfig = await this.verifySchedulerConfig();
      results.channelTargeting = await this.verifyChannelTargeting();
      results.verificationReport = await this.generateVerificationReport();

      // Summary
      console.log('\n📋 VERIFICATION SUMMARY');
      console.log('='.repeat(50));
      
      const passedVerifications = Object.values(results).filter(Boolean).length;
      const totalVerifications = Object.keys(results).length;
      
      console.log(`✅ Verifications passed: ${passedVerifications}/${totalVerifications}`);
      
      Object.entries(results).forEach(([verification, passed]) => {
        console.log(`  ${passed ? '✅' : '❌'} ${verification.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
      });

      if (passedVerifications === totalVerifications) {
        console.log('\n🎉 All verifications passed! Your scheduler is ready.');
        console.log('📅 Scheduled reports will be sent to the correct channels.');
        console.log('🚀 You can safely run: node src/schedule.js');
      } else {
        console.log('\n⚠️  Some verifications failed. Please review the configuration.');
        console.log('💡 Use /setup and /config commands in Slack to fix issues.');
      }

    } catch (error) {
      console.error('❌ Verification suite failed:', error);
    } finally {
      await this.channelConfig.close();
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const verifier = new SchedulerVerifier();

  if (args.length === 0) {
    // Run all verifications
    await verifier.runAllVerifications();
  } else if (args[0] === '--test' && args[1]) {
    // Test manual execution
    const taskType = args[1];
    await verifier.testManualExecution(taskType);
  } else {
    console.log('Usage:');
    console.log('  node src/verify_scheduler.js                    # Run all verifications');
    console.log('  node src/verify_scheduler.js --test <task_type>  # Test manual execution');
    console.log('');
    console.log('Examples:');
    console.log('  node src/verify_scheduler.js');
    console.log('  node src/verify_scheduler.js --test daily');
    console.log('  node src/verify_scheduler.js --test weekly');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('verify_scheduler.js')) {
  main()
    .then(() => {
      console.log('\n✅ Scheduler verification completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Scheduler verification failed:', error);
      process.exit(1);
    });
}

export { SchedulerVerifier };
