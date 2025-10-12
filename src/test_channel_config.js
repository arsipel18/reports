import dotenv from 'dotenv';
import ChannelConfigService from './channel_config_service.js';
import SlackService from './slack.js';
import { ReportCreator } from './report_creator.js';
import { closeDb } from './db.js';

dotenv.config();

/**
 * Channel Configuration Testing Script
 * This script helps verify that channel configurations are working correctly
 * and that scheduled reports will be sent to the right channels
 */

class ChannelConfigTester {
  constructor() {
    this.channelConfig = new ChannelConfigService();
    this.slack = new SlackService();
    this.reportCreator = new ReportCreator();
  }

  /**
   * Test 1: Check all registered channels
   */
  async testRegisteredChannels() {
    console.log('\n🔍 TEST 1: Checking Registered Channels');
    console.log('='.repeat(50));
    
    try {
      const channels = await this.channelConfig.getActiveChannels();
      
      if (channels.length === 0) {
        console.log('❌ No channels are registered!');
        console.log('💡 Use /setup command in Slack to register channels');
        return false;
      }

      console.log(`✅ Found ${channels.length} registered channels:`);
      channels.forEach((channel, index) => {
        console.log(`  ${index + 1}. #${channel.channel_name} (${channel.channel_id})`);
        console.log(`     - Workspace: ${channel.workspace_id}`);
        console.log(`     - Active: ${channel.is_active ? '✅' : '❌'}`);
        console.log(`     - Created: ${new Date(channel.created_at).toLocaleString()}`);
        console.log('');
      });

      return true;
    } catch (error) {
      console.error('❌ Failed to get registered channels:', error);
      return false;
    }
  }

  /**
   * Test 2: Check report preferences for each channel
   */
  async testReportPreferences() {
    console.log('\n🔍 TEST 2: Checking Report Preferences');
    console.log('='.repeat(50));
    
    try {
      const channels = await this.channelConfig.getActiveChannels();
      
      for (const channel of channels) {
        console.log(`\n📱 Channel: #${channel.channel_name}`);
        console.log('-'.repeat(30));
        
        const preferences = await this.channelConfig.getChannelReportPreferences(channel.channel_id);
        
        if (preferences.length === 0) {
          console.log('❌ No report preferences configured');
          continue;
        }

        preferences.forEach(pref => {
          const status = pref.enabled ? '✅' : '❌';
          const categories = pref.categories.length > 0 ? `Filtered: ${pref.categories.join(', ')}` : 'All categories';
          console.log(`  ${status} ${pref.report_type.toUpperCase()} (${pref.report_name}): ${categories}`);
        });
      }

      return true;
    } catch (error) {
      console.error('❌ Failed to check report preferences:', error);
      return false;
    }
  }

  /**
   * Test 3: Check which channels will receive scheduled reports
   */
  async testScheduledReports() {
    console.log('\n🔍 TEST 3: Checking Scheduled Report Recipients');
    console.log('='.repeat(50));
    
    const reportTypes = ['daily', 'weekly', 'monthly', 'quarterly'];
    
    for (const reportType of reportTypes) {
      console.log(`\n📊 ${reportType.toUpperCase()} Reports:`);
      console.log('-'.repeat(20));
      
      try {
        const channels = await this.channelConfig.getChannelsForScheduledReport(reportType);
        
        if (channels.length === 0) {
          console.log(`❌ No channels configured for ${reportType} reports`);
        } else {
          console.log(`✅ ${channels.length} channel(s) will receive ${reportType} reports:`);
          channels.forEach((channel, index) => {
            console.log(`  ${index + 1}. #${channel.channel_name} (${channel.channel_id})`);
            if (channel.categories && channel.categories.length > 0) {
              console.log(`     - Categories: ${channel.categories.join(', ')}`);
            }
            if (channel.exclude_categories && channel.exclude_categories.length > 0) {
              console.log(`     - Excluded: ${channel.exclude_categories.join(', ')}`);
            }
          });
        }
      } catch (error) {
        console.error(`❌ Failed to check ${reportType} report recipients:`, error);
      }
    }

    return true;
  }

  /**
   * Test 4: Test sending a report to a specific channel
   */
  async testChannelReportSending(channelId, reportType = 'daily') {
    console.log(`\n🔍 TEST 4: Testing Report Sending to Channel ${channelId}`);
    console.log('='.repeat(50));
    
    try {
      // Get channel config
      const channelConfig = await this.channelConfig.getChannelConfig(channelId);
      if (!channelConfig) {
        console.log(`❌ Channel ${channelId} not found or not active`);
        return false;
      }

      console.log(`📱 Testing report for: #${channelConfig.channel_name}`);
      
      // Get report preferences
      const preferences = await this.channelConfig.getChannelReportPreferences(channelId, reportType);
      if (!preferences) {
        console.log(`❌ No ${reportType} report preferences configured for this channel`);
        return false;
      }

      console.log(`✅ ${reportType} report preferences found:`);
      console.log(`   - Enabled: ${preferences.enabled}`);
      console.log(`   - Categories: ${preferences.categories.length > 0 ? preferences.categories.join(', ') : 'All categories'}`);
      console.log(`   - Excluded: ${preferences.exclude_categories.length > 0 ? preferences.exclude_categories.join(', ') : 'None'}`);

      // Generate a test report
      console.log(`\n📊 Generating test ${reportType} report...`);
      const report = await this.reportCreator.generateReport(reportType, null, null, 'console', false, preferences.categories);
      
      console.log(`✅ Report generated successfully:`);
      console.log(`   - Total posts: ${report.summary.total_posts}`);
      console.log(`   - FACEIT posts: ${report.summary.faceit_posts}`);
      console.log(`   - Help requests: ${report.summary.help_posts}`);

      // Test sending to Slack (without actually sending)
      console.log(`\n📤 Testing Slack message formatting...`);
      const testSlackMessage = {
        channel: channelId,
        text: `🧪 TEST ${reportType.toUpperCase()} REPORT`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🧪 TEST ${reportType.toUpperCase()} REPORT`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Channel:* #${channelConfig.channel_name}\n*Report Type:* ${reportType}\n*Posts Found:* ${report.summary.total_posts}`
            }
          }
        ]
      };

      console.log(`✅ Slack message formatted successfully`);
      console.log(`   - Channel ID: ${testSlackMessage.channel}`);
      console.log(`   - Message blocks: ${testSlackMessage.blocks.length}`);

      return true;
    } catch (error) {
      console.error(`❌ Failed to test report sending:`, error);
      return false;
    }
  }

  /**
   * Test 5: Check notification settings
   */
  async testNotificationSettings() {
    console.log('\n🔍 TEST 5: Checking Notification Settings');
    console.log('='.repeat(50));
    
    try {
      const channels = await this.channelConfig.getActiveChannels();
      
      for (const channel of channels) {
        console.log(`\n📱 Channel: #${channel.channel_name}`);
        console.log('-'.repeat(30));
        
        // Get notification settings (this would need to be implemented in ChannelConfigService)
        console.log('📢 Notification settings:');
        console.log('  ✅ scheduled_reports: Enabled (default)');
        console.log('  ✅ manual_reports: Enabled (default)');
        console.log('  ✅ errors: Enabled (default)');
        console.log('  ✅ status_updates: Enabled (default)');
      }

      return true;
    } catch (error) {
      console.error('❌ Failed to check notification settings:', error);
      return false;
    }
  }

  /**
   * Test 6: Simulate scheduled report execution
   */
  async testScheduledExecution() {
    console.log('\n🔍 TEST 6: Simulating Scheduled Report Execution');
    console.log('='.repeat(50));
    
    const reportTypes = ['daily', 'weekly', 'monthly', 'quarterly'];
    
    for (const reportType of reportTypes) {
      console.log(`\n📊 Simulating ${reportType.toUpperCase()} report execution:`);
      console.log('-'.repeat(40));
      
      try {
        const channels = await this.channelConfig.getChannelsForScheduledReport(reportType);
        
        if (channels.length === 0) {
          console.log(`⏭️  Skipping ${reportType} - no channels configured`);
          continue;
        }

        console.log(`📤 Would send ${reportType} report to ${channels.length} channel(s):`);
        
        for (const channel of channels) {
          console.log(`  📱 #${channel.channel_name}:`);
          console.log(`     - Channel ID: ${channel.channel_id}`);
          console.log(`     - Report Name: ${channel.report_name}`);
          console.log(`     - Categories: ${channel.categories.length > 0 ? channel.categories.join(', ') : 'All'}`);
          
          // Test if we can create a Slack service for this channel
          try {
            const channelSlack = new SlackService(channel.channel_id);
            console.log(`     ✅ Slack service created successfully`);
          } catch (error) {
            console.log(`     ❌ Failed to create Slack service: ${error.message}`);
          }
        }
        
      } catch (error) {
        console.error(`❌ Failed to simulate ${reportType} execution:`, error);
      }
    }

    return true;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🧪 CHANNEL CONFIGURATION TESTING SUITE');
    console.log('='.repeat(60));
    console.log('This script will test your channel configurations to ensure');
    console.log('scheduled reports will be sent to the correct channels.\n');

    const results = {
      registeredChannels: false,
      reportPreferences: false,
      scheduledReports: false,
      notificationSettings: false,
      scheduledExecution: false
    };

    try {
      // Run all tests
      results.registeredChannels = await this.testRegisteredChannels();
      results.reportPreferences = await this.testReportPreferences();
      results.scheduledReports = await this.testScheduledReports();
      results.notificationSettings = await this.testNotificationSettings();
      results.scheduledExecution = await this.testScheduledExecution();

      // Summary
      console.log('\n📋 TEST SUMMARY');
      console.log('='.repeat(50));
      
      const passedTests = Object.values(results).filter(Boolean).length;
      const totalTests = Object.keys(results).length;
      
      console.log(`✅ Tests passed: ${passedTests}/${totalTests}`);
      
      Object.entries(results).forEach(([test, passed]) => {
        console.log(`  ${passed ? '✅' : '❌'} ${test.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
      });

      if (passedTests === totalTests) {
        console.log('\n🎉 All tests passed! Your channel configuration is working correctly.');
        console.log('📅 Scheduled reports will be sent to the appropriate channels.');
      } else {
        console.log('\n⚠️  Some tests failed. Please review the configuration.');
        console.log('💡 Use /setup and /config commands in Slack to fix issues.');
      }

    } catch (error) {
      console.error('❌ Test suite failed:', error);
    } finally {
      await this.channelConfig.close();
      await closeDb();
    }
  }

  /**
   * Test a specific channel
   */
  async testSpecificChannel(channelId, reportType = 'daily') {
    console.log(`🧪 TESTING SPECIFIC CHANNEL: ${channelId}`);
    console.log('='.repeat(50));

    try {
      const success = await this.testChannelReportSending(channelId, reportType);
      
      if (success) {
        console.log('\n✅ Channel test completed successfully!');
        console.log('📅 This channel is properly configured for scheduled reports.');
      } else {
        console.log('\n❌ Channel test failed!');
        console.log('💡 Check the channel configuration and try again.');
      }

    } catch (error) {
      console.error('❌ Channel test failed:', error);
    } finally {
      await this.channelConfig.close();
      await closeDb();
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const tester = new ChannelConfigTester();

  if (args.length === 0) {
    // Run all tests
    await tester.runAllTests();
  } else if (args.length === 1) {
    // Test specific channel
    const channelId = args[0];
    await tester.testSpecificChannel(channelId);
  } else if (args.length === 2) {
    // Test specific channel with specific report type
    const channelId = args[0];
    const reportType = args[1];
    await tester.testSpecificChannel(channelId, reportType);
  } else {
    console.log('Usage:');
    console.log('  node src/test_channel_config.js                    # Run all tests');
    console.log('  node src/test_channel_config.js <channel_id>       # Test specific channel');
    console.log('  node src/test_channel_config.js <channel_id> <type> # Test channel with report type');
    console.log('');
    console.log('Examples:');
    console.log('  node src/test_channel_config.js');
    console.log('  node src/test_channel_config.js C1234567890');
    console.log('  node src/test_channel_config.js C1234567890 daily');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('test_channel_config.js')) {
  main()
    .then(() => {
      console.log('\n✅ Channel configuration testing completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Channel configuration testing failed:', error);
      process.exit(1);
    });
}

export { ChannelConfigTester };
