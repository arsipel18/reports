import cron from 'node-cron';
import dotenv from 'dotenv';
import { OneTimeAnalysis } from './ai_analyzer.js';
import { RealisticRedditFetcher } from './reddit_fetcher.js';
import KPIService from './kpi.js';
import SlackService from './slack.js';
import ChannelConfigService from './channel_config_service.js';
import { ReportCreator } from './report_creator.js';
import { closeDb } from './db.js';

dotenv.config();

/**
 * Test Schedule Service
 * 
 * This version runs all scheduled tasks within 30 minutes for quick testing:
 * - Reddit Fetch: Every 3 minutes (10 times in 30 minutes)
 * - Daily Reports: At 2 minutes after start
 * - Weekly Reports: At 5 minutes after start  
 * - Monthly Reports: At 10 minutes after start
 * - Quarterly Reports: At 15 minutes after start
 * 
 * Usage: node src/test_scheduler.js
 */
class TestScheduleService {
  constructor() {
    this.kpi = new KPIService();
    this.channelConfig = new ChannelConfigService();
    this.reportCreator = new ReportCreator();
    this.isRunning = false;
    this.tasks = new Map();
    this.runningTasks = new Set(); // Track individual running tasks
    this.heartbeatInterval = null;
    this.errorCount = 0;
    this.maxErrors = 10;
    this.testStartTime = new Date();
    this.testDuration = 30 * 60 * 1000; // 30 minutes in milliseconds
    this.executedTasks = new Map();
    
    // Set timezone to UTC
    process.env.TZ = 'UTC';
    
    console.log('🧪 TEST SCHEDULER INITIALIZED');
    console.log('='.repeat(60));
    console.log(`⏰ Test Duration: 30 minutes`);
    console.log(`🚀 Start Time: ${this.testStartTime.toISOString()}`);
    console.log(`🏁 End Time: ${new Date(this.testStartTime.getTime() + this.testDuration).toISOString()}`);
    console.log('');
    console.log('📅 TEST SCHEDULE:');
    console.log('  - Reddit Fetch: Every 3 minutes (starts at minute 0)');
    console.log('  - Daily Reports: At 2 minutes after start');
    console.log('  - Weekly Reports: At 5 minutes after start');
    console.log('  - Monthly Reports: At 10 minutes after start');
    console.log('  - Quarterly Reports: At 15 minutes after start');
    console.log('  - Yearly Reports: At 20 minutes after start');
    console.log('  - Test Auto-Stop: After 30 minutes');
    console.log('='.repeat(60));
    console.log('');
  }

  /**
   * Start all test scheduled tasks
   */
  async start() {
    console.log('🚀 Starting TEST scheduled tasks...');
    
    try {
      // Test database connectivity first
      await this.testConnections();
      
      // Initialize task execution tracking
      this.executedTasks.set('threehour_fetch', 0);
      this.executedTasks.set('daily', 0);
      this.executedTasks.set('weekly', 0);
      this.executedTasks.set('monthly', 0);
      this.executedTasks.set('quarterly', 0);
      this.executedTasks.set('yearly', 0);
      
      // AUTO-STOP TIMER: Stop after 30 minutes
      setTimeout(async () => {
        console.log('');
        console.log('⏰ 30-minute test period completed!');
        console.log('🏁 Auto-stopping test scheduler...');
        await this.stop();
        await this.printTestSummary();
        process.exit(0);
      }, this.testDuration);

      // REDDIT FETCH TASK: Every 3 minutes (starting immediately)
      const fetchTask = cron.schedule('*/10 * * * *', async () => {
        await this.safeTaskExecution('threehour_fetch', () => this.runThreeHourFetchTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('threehour_fetch', fetchTask);

      // DAILY REPORTS: 2 minutes after start
      const dailyDelay = 1 * 60 * 1000; // 2 minutes
      setTimeout(async () => {
        await this.safeTaskExecution('daily', () => this.runDailyTask());
      }, dailyDelay);

      // WEEKLY REPORTS: 5 minutes after start
      const weeklyDelay = 2 * 60 * 1000; // 5 minutes
      setTimeout(async () => {
        await this.safeTaskExecution('weekly', () => this.runWeeklyTask());
      }, weeklyDelay);

      // MONTHLY REPORTS: 10 minutes after start
      const monthlyDelay = 3 * 60 * 1000; // 10 minutes
      setTimeout(async () => {
        await this.safeTaskExecution('monthly', () => this.runMonthlyTask());
      }, monthlyDelay);

      // QUARTERLY REPORTS: 15 minutes after start
      const quarterlyDelay = 4 * 60 * 1000; // 15 minutes
      setTimeout(async () => {
        await this.safeTaskExecution('quarterly', () => this.runQuarterlyTask());
      }, quarterlyDelay);

      // YEARLY REPORTS: 20 minutes after start
      const yearlyDelay = 5 * 60 * 1000; // 20 minutes
      setTimeout(async () => {
        await this.safeTaskExecution('yearly', () => this.runYearlyTask());
      }, yearlyDelay);

      // Start cron tasks (only the fetch task uses cron)
      this.tasks.forEach((task, name) => {
        try {
          if (typeof task.start === 'function') {
            task.start();
            console.log(`✅ ${name} task scheduled`);
          }
        } catch (error) {
          console.error(`❌ Failed to start ${name} task:`, error);
        }
      });

      this.isRunning = true;
      console.log('🎯 TEST scheduler is now active');
      console.log('📊 All tasks will complete within 30 minutes');
      console.log('');
      
      // Start heartbeat monitoring
      this.startHeartbeat();
      
      // Send test startup notification
      try {
        await this.sendTestStartupNotification();
      } catch (error) {
        console.error('❌ Failed to send test startup notification:', error.message);
      }
      
      // First fetch will run according to cron schedule (every 3 minutes)
      console.log('🚀 Test scheduler ready - first fetch in 3 minutes or at next cron interval');
      console.log('⏰ Next tasks: Daily(2min), Weekly(5min), Monthly(10min), Quarterly(15min)');
      
    } catch (error) {
      console.error('❌ Failed to start test scheduled tasks:', error);
      throw error;
    }
  }

  /**
   * Test database and service connections
   */
  async testConnections() {
    try {
      console.log('🔍 Testing service connections...');
      
      // Test channel config service
      const channels = await this.channelConfig.getActiveChannels();
      console.log(`✅ Database connection successful - found ${channels.length} active channels`);
      
      // Test Reddit API connection without running full fetch
      try {
        const testReddit = new RealisticRedditFetcher();
        await testReddit.testConnection();
        console.log('✅ Reddit API connection successful');
        // Don't call fetchRecentData here - just test the connection
      } catch (error) {
        console.log('⚠️ Reddit API connection test failed (will retry during fetch):', error.message);
      }
      
      return true;
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      throw error;
    }
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      try {
        const elapsed = Math.round((Date.now() - this.testStartTime.getTime()) / 1000 / 60); // minutes
        const remaining = Math.max(0, 30 - elapsed);
        const status = this.isRunning ? 'Running' : 'Stopped';
        const runningTasksList = this.runningTasks.size > 0 ? Array.from(this.runningTasks).join(', ') : 'None';
        
        console.log(`💓 TEST Heartbeat - Status: ${status} | Running: [${runningTasksList}] | Time: ${elapsed}/${30}min | Remaining: ${remaining}min`);
        
        // Show task execution counts
        const counts = Array.from(this.executedTasks.entries())
          .map(([task, count]) => `${task}:${count}`)
          .join(' ');
        console.log(`📊 Task Executions: ${counts}`);
        
        // Reset error count if it's been running fine
        if (this.errorCount > 0 && this.isRunning) {
          this.errorCount = Math.max(0, this.errorCount - 1);
        }
      } catch (error) {
        console.error('❌ Heartbeat error:', error);
        this.errorCount++;
      }
    }, 2 * 60 * 1000); // Every 2 minutes
  }

  /**
   * Send test startup notification
   */
  async sendTestStartupNotification() {
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      for (const channel of channels) {
        try {
          // Test startup notification removed - only reports will be sent
        } catch (error) {
          console.error(`❌ Failed to send test startup notification to ${channel.channel_name}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Failed to send test startup notifications:', error.message);
    }
  }

  /**
   * Safe task execution wrapper with test tracking and concurrent support
   */
  async safeTaskExecution(taskName, taskFunction) {
    // Check if this specific task is already running
    if (this.runningTasks.has(taskName)) {
      console.log(`⚠️ ${taskName} task skipped - this specific task is already running`);
      return;
    }

    const elapsed = Math.round((Date.now() - this.testStartTime.getTime()) / 1000 / 60); // minutes
    console.log(`🔧 Starting ${taskName} task... (${elapsed} min elapsed, ${this.runningTasks.size} other tasks running)`);
    this.runningTasks.add(taskName);
    
    try {
      await taskFunction();
      
      // Track execution
      const currentCount = this.executedTasks.get(taskName) || 0;
      this.executedTasks.set(taskName, currentCount + 1);
      
      console.log(`✅ ${taskName} task completed successfully (execution #${currentCount + 1}, ${this.runningTasks.size - 1} tasks still running)`);
      this.errorCount = Math.max(0, this.errorCount - 1); // Reduce error count on success
    } catch (error) {
      console.error(`❌ ${taskName} task failed:`, error);
      this.errorCount++;
      
      // Try to send error notification to channels
      try {
        await this.sendTestErrorNotification(taskName, error);
      } catch (notificationError) {
        console.error('❌ Failed to send error notification:', notificationError);
      }
    } finally {
      this.runningTasks.delete(taskName);
    }
  }

  /**
   * Send test error notification
   */
  async sendTestErrorNotification(taskName, error) {
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      for (const channel of channels) {
        // Test error notification removed - only reports will be sent
      }
    } catch (error) {
      console.error('❌ Failed to send test error notifications:', error);
    }
  }

  /**
   * Stop all scheduled tasks
   */
  async stop() {
    console.log('🛑 Stopping TEST scheduled tasks...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.tasks.forEach((task, name) => {
      try {
        if (typeof task.stop === 'function') {
          task.stop();
          console.log(`⏹️ ${name} task stopped`);
        }
      } catch (error) {
        console.error(`❌ Error stopping ${name} task:`, error);
      }
    });
    
    this.isRunning = false;
    console.log('📴 All TEST scheduled tasks stopped');
    
    // Send stop notification
    try {
      await this.sendTestStopNotification();
    } catch (error) {
      console.error('❌ Failed to send test stop notification:', error);
    }
  }

  /**
   * Send test stop notification
   */
  async sendTestStopNotification() {
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      for (const channel of channels) {
        // Test stop notification removed - only reports will be sent
      }
    } catch (error) {
      console.error('Error during test stop notifications:', error.message);
    }
  }

  /**
   * Print test summary
   */
  async printTestSummary() {
    const actualDuration = Math.round((Date.now() - this.testStartTime.getTime()) / 1000 / 60);
    
    console.log('');
    console.log('🎉 TEST COMPLETED!');
    console.log('='.repeat(60));
    console.log(`⏱️  Actual Duration: ${actualDuration} minutes`);
    console.log(`🚀 Start Time: ${this.testStartTime.toISOString()}`);
    console.log(`🏁 End Time: ${new Date().toISOString()}`);
    console.log('');
    console.log('📊 TASK EXECUTION SUMMARY:');
    this.executedTasks.forEach((count, task) => {
      const status = count > 0 ? '✅' : '❌';
      console.log(`  ${status} ${task}: ${count} executions`);
    });
    
    const totalExecutions = Array.from(this.executedTasks.values()).reduce((sum, count) => sum + count, 0);
    console.log('');
    console.log(`📈 Total Task Executions: ${totalExecutions}`);
    console.log(`❌ Total Errors: ${this.errorCount}`);
    console.log('');
    
    // Success/failure assessment
    const dailyExecuted = this.executedTasks.get('daily') > 0;
    const weeklyExecuted = this.executedTasks.get('weekly') > 0;
    const monthlyExecuted = this.executedTasks.get('monthly') > 0;
    const quarterlyExecuted = this.executedTasks.get('quarterly') > 0;
    const fetchExecutions = this.executedTasks.get('threehour_fetch');
    
    if (dailyExecuted && weeklyExecuted && monthlyExecuted && quarterlyExecuted && fetchExecutions >= 5) {
      console.log('🎯 TEST RESULT: SUCCESS! All scheduled tasks executed correctly.');
      console.log('✅ Your scheduler is ready for production deployment.');
      console.log('🚀 Run: node src/schedule.js (for production)');
    } else {
      console.log('⚠️  TEST RESULT: PARTIAL SUCCESS - Some tasks may not have executed.');
      console.log('🔍 Check the logs above for any errors or issues.');
    }
    
    console.log('='.repeat(60));
  }

  // All the task methods are identical to the main scheduler, just with test labels

  /**
   * Run 3-hour Reddit fetch task with immediate AI analysis
   */
  async runThreeHourFetchTask() {
    console.log('🕒 Starting 3-hour Reddit fetch and analysis task... [TEST MODE]');
    
    try {
      // Step 1: Fetch new posts from Reddit using realistic fetcher (keep pool alive)
      console.log('📡 Fetching new posts from Reddit... [TEST MODE]');
      const fetcher = new RealisticRedditFetcher();
      await fetcher.fetchRecentData(true); // Keep pool alive for test scheduler
      console.log('✅ Reddit fetch completed successfully [TEST MODE]');
      
      // Step 2: Immediately analyze all unanalyzed content
      console.log('🤖 Starting AI analysis of all unanalyzed content... [TEST MODE]');
      const analysis = new OneTimeAnalysis();
      await analysis.run();
      console.log('✅ AI analysis completed successfully [TEST MODE]');
      
      console.log('✅ 3-hour fetch and analysis task completed successfully [TEST MODE]');
    } catch (error) {
      console.error('❌ 3-hour fetch and analysis task failed [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Run daily task with test indicators
   */
  async runDailyTask() {
    console.log('🌅 Starting daily KPI report task... [TEST MODE]');
    
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for daily reports [TEST MODE]');
        return;
      }

      console.log(`📊 Sending daily reports to ${channels.length} channels [TEST MODE]`);
      
      for (const channel of channels) {
        try {
          console.log(`📤 Sending daily report to channel: ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
          const channelSlack = new SlackService(channel.channel_id);
          
          const report = await this.reportCreator.generateReport('daily', null, null, 'console', false, channel.categories);
          await this.sendReportCreatorToSlack(channelSlack, report, 'daily', true);
          
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'test_scheduled_report_sent', {
            report_type: 'daily',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            test_mode: true
          });
          
          console.log(`✅ Daily report sent to ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send daily report to ${channel.channel_name} [TEST MODE]:`, channelError);
        }
      }
      
      console.log('✅ Daily KPI task completed successfully [TEST MODE]');
      
    } catch (error) {
      console.error('❌ Daily task failed [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Run weekly task with test indicators
   */
  async runWeeklyTask() {
    console.log('📅 Starting weekly KPI report task... [TEST MODE]');
    
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('weekly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for weekly reports [TEST MODE]');
        return;
      }

      console.log(`📊 Sending weekly reports to ${channels.length} channels [TEST MODE]`);
      
      for (const channel of channels) {
        try {
          console.log(`📤 Sending weekly report to channel: ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
          const channelSlack = new SlackService(channel.channel_id);
          
          const report = await this.reportCreator.generateReport('weekly', null, null, 'console', false, channel.categories);
          await this.sendReportCreatorToSlack(channelSlack, report, 'weekly', true);
          
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'test_scheduled_report_sent', {
            report_type: 'weekly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            test_mode: true
          });
          
          console.log(`✅ Weekly report sent to ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send weekly report to ${channel.channel_name} [TEST MODE]:`, channelError);
        }
      }
      
      console.log('✅ Weekly KPI task completed successfully [TEST MODE]');
      
    } catch (error) {
      console.error('❌ Weekly task failed [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Run monthly task with test indicators
   */
  async runMonthlyTask() {
    console.log('📊 Starting monthly KPI report task... [TEST MODE]');
    
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('monthly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for monthly reports [TEST MODE]');
        return;
      }

      console.log(`📊 Sending monthly reports to ${channels.length} channels [TEST MODE]`);
      
      for (const channel of channels) {
        try {
          console.log(`📤 Sending monthly report to channel: ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
          const channelSlack = new SlackService(channel.channel_id);
          
          const report = await this.reportCreator.generateReport('monthly', null, null, 'console', false, channel.categories);
          await this.sendReportCreatorToSlack(channelSlack, report, 'monthly', true);
          
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'test_scheduled_report_sent', {
            report_type: 'monthly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            test_mode: true
          });
          
          console.log(`✅ Monthly report sent to ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send monthly report to ${channel.channel_name} [TEST MODE]:`, channelError);
        }
      }
      
      console.log('✅ Monthly KPI task completed successfully [TEST MODE]');
      
    } catch (error) {
      console.error('❌ Monthly task failed [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Run quarterly task with test indicators
   */
  async runQuarterlyTask() {
    console.log('🎯 Starting quarterly KPI report task... [TEST MODE]');
    
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('quarterly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for quarterly reports [TEST MODE]');
        return;
      }

      console.log(`🎯 Sending quarterly reports to ${channels.length} channels [TEST MODE]`);
      
      for (const channel of channels) {
        try {
          console.log(`🎯 Sending quarterly report to channel: ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
          const channelSlack = new SlackService(channel.channel_id);
          
          const report = await this.reportCreator.generateReport('quarterly', null, null, 'console', false, channel.categories);
          await this.sendReportCreatorToSlack(channelSlack, report, 'quarterly', true);
          
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'test_scheduled_report_sent', {
            report_type: 'quarterly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            test_mode: true
          });
          
          console.log(`✅ QUARTERLY REPORT sent to ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send quarterly report to ${channel.channel_name} [TEST MODE]:`, channelError);
        }
      }
      
      console.log('🎯 Quarterly KPI task completed successfully [TEST MODE]');
      
    } catch (error) {
      console.error('❌ Quarterly task failed [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Run yearly task with test indicators
   */
  async runYearlyTask() {
    console.log('🏆 Starting yearly KPI report task... [TEST MODE]');
    
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('yearly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for yearly reports [TEST MODE]');
        return;
      }

      console.log(`🏆 Sending yearly reports to ${channels.length} channels [TEST MODE]`);
      
      for (const channel of channels) {
        try {
          console.log(`🏆 Sending yearly report to channel: ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
          const channelSlack = new SlackService(channel.channel_id);
          
          const report = await this.reportCreator.generateReport('yearly', null, null, 'console', false, channel.categories);
          await this.sendReportCreatorToSlack(channelSlack, report, 'yearly', true);
          
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'test_scheduled_report_sent', {
            report_type: 'yearly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            test_mode: true
          });
          
          console.log(`✅ YEARLY REPORT sent to ${channel.channel_name} (${channel.report_name}) [TEST MODE]`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send yearly report to ${channel.channel_name} [TEST MODE]:`, channelError);
        }
      }
      
      console.log('🏆 Yearly KPI task completed successfully [TEST MODE]');
      
    } catch (error) {
      console.error('❌ Yearly task failed [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Send ReportCreator format report to Slack with test indicators
   */
  async sendReportCreatorToSlack(channelSlack, report, reportType, isTestMode = false) {
    try {
      const periodEmoji = {
        daily: '📅',
        weekly: '📊', 
        monthly: '📈',
        quarterly: '🎯',
        yearly: '🏆'
      };

      const emoji = periodEmoji[reportType] || '📊';
      
      // Create title without categories
      let title = `${reportType.toUpperCase()} ANALYSIS REPORT`;
      
      // Add test mode indicator
      if (isTestMode) {
        title += ' - TEST MODE';
      }
      
      // Create Slack message
      const slackMessage = {
        text: `${emoji} *${title}*`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} ${title}`
            }
          }
        ]
      };

      // Add test mode notice for all reports
      if (isTestMode) {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚡ *TEST MODE ACTIVE*\nThis is your ${reportType} report working perfectly in test mode!\nThe production scheduler will send this same report on schedule.`
          }
        });
      }

      slackMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Total Posts:* ${report.summary.total_posts}`
        }
      });

      slackMessage.blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Period:* ${new Date(report.timeRange.start).toLocaleDateString()} - ${new Date(report.timeRange.end).toLocaleDateString()}`
          },
          {
            type: 'mrkdwn',
            text: `*Help Requests:* ${report.summary.help_posts}`
          }
        ]
      });

      // Add category filter info if filtered (right after header)
      if (report.filters && report.filters.categories && report.filters.categories.length > 0) {
        slackMessage.blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🔍 *Filtered Categories:* ${report.filters.categories.map(c => c.replace('_', ' ')).join(', ')}`
            }
          ]
        });
      }

      // Add sentiment
      if (report.sentiments && report.sentiments.length > 0) {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*😊 Sentiment:* ${report.sentiments.map(sentiment => `${sentiment.sentiment.toUpperCase()}: ${sentiment.count} (${sentiment.percentage}%)`).join(' • ')}`
          }
        });
      }

      // Add top categories
      if (report.categories && report.categories.length > 0) {
        slackMessage.blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*🏷️ Categories:* ${report.categories.slice(0, 6).map(category => `${category.category.replace('_', ' ').toUpperCase()}: ${category.count} (${category.percentage}%)`).join(' • ')}`
            }
          ]
        });
      }

      // Add top post (reduced to 1)
      if (report.topPosts && report.topPosts.length > 0) {
        const post = report.topPosts[0];
        const engagement = post.score + (post.num_comments * 2);
        const date = new Date(post.created_utc * 1000).toLocaleDateString();
        
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🔥 TOP ENGAGED POST:*\n"${post.title.substring(0, 60)}${post.title.length > 60 ? '...' : ''}"`
          }
        });

        slackMessage.blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Score: ${post.score} | Comments: ${post.num_comments} | Engagement: ${engagement}`
            },
            {
              type: 'mrkdwn',
              text: `${post.category} | ${post.sentiment} | ${date} | ${post.author}`
            }
          ]
        });
      } else {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🔥 Top Engaged Post:* No posts found'
          }
        });
      }

      // Add comment analysis
      if (report.commentAnalysis) {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*💬 Comment Analysis:*'
          }
        });
        
        const posPercent = Math.round((report.commentAnalysis.positiveComments / report.commentAnalysis.totalComments) * 100);
        const negPercent = Math.round((report.commentAnalysis.negativeComments / report.commentAnalysis.totalComments) * 100);
        const helpPercent = Math.round((report.commentAnalysis.helpComments / report.commentAnalysis.totalComments) * 100);
        
        slackMessage.blocks.push({
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Total:* ${report.commentAnalysis.totalComments}`
            },
            {
              type: 'mrkdwn',
              text: `*Authors:* ${report.commentAnalysis.uniqueAuthors}`
            },
            {
              type: 'mrkdwn',
              text: `*📊 Sentiment:*\n😊 ${posPercent}% Positive\n😟 ${negPercent}% Negative\n📝 ${helpPercent}% Help Requests`
            }
          ]
        });

        // Add Comment Engagement and Post Engagement side-by-side
        slackMessage.blocks.push({
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*📈 Comment Engagement:*\nAvg Score: ${Math.round(report.commentAnalysis.avgCommentScore)}\nDiscussion: ${report.commentAnalysis.discussionComments}`
            },
            {
              type: 'mrkdwn',
              text: `*📈 Post Engagement:*\nAvg Score: ${Math.round(report.summary.avg_score)}\nAvg Comments: ${Math.round(report.summary.avg_comments)}`
            }
          ]
        });
      }

      // Add single most engaged comment example
      if (report.commentExamples && (report.commentExamples.positive.length > 0 || report.commentExamples.negative.length > 0 || report.commentExamples.neutral?.length > 0)) {
        // Find the most engaged comment across all sentiments
        const allComments = [
          ...report.commentExamples.positive,
          ...report.commentExamples.negative,
          ...(report.commentExamples.neutral || [])
        ];
        
        if (allComments.length > 0) {
          // Sort by score and take the highest
          const mostEngagedComment = allComments.sort((a, b) => b.score - a.score)[0];
          
          slackMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*💬 Most Engaged Comment:*'
            }
          });
          
          slackMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> "${mostEngagedComment.body}"`
            }
          });

          const intentText = mostEngagedComment.intent ? ` | Intent: ${mostEngagedComment.intent}` : '';
          
          slackMessage.blocks.push({
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `- u/${mostEngagedComment.author} (Score: ${mostEngagedComment.score})${intentText}`
              }
            ]
          });
        }
      }

      // Add moderator response analysis
      if (report.moderatorAnalysis && report.moderatorAnalysis.totalPosts > 0) {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*👮 Moderator Response Analysis:*'
          }
        });
        
        const moderatorAnalysis = report.moderatorAnalysis;
        const responseTimeText = moderatorAnalysis.avgFirstResponseTimeMinutes > 0 
          ? `${moderatorAnalysis.avgFirstResponseTimeMinutes} minutes` 
          : 'No responses';
        
        slackMessage.blocks.push({
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Posts with Response:*\n${moderatorAnalysis.postsWithModeratorResponse}/${moderatorAnalysis.totalPosts} (${moderatorAnalysis.moderatorResponsePercentage}%)`
            },
            {
              type: 'mrkdwn',
              text: `*Avg Response Time:*\n${responseTimeText}`
            },
            {
              type: 'mrkdwn',
              text: `*Total Responses:*\n${moderatorAnalysis.totalModeratorResponses}`
            },
            {
              type: 'mrkdwn',
              text: `*Active Moderators:*\n${moderatorAnalysis.uniqueModerators}`
            }
          ]
        });
      }

      // Post to Slack
      await channelSlack.postMessage(slackMessage);
      
    } catch (error) {
      console.error('❌ Failed to send ReportCreator report to Slack [TEST MODE]:', error);
      throw error;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    const elapsed = Math.round((Date.now() - this.testStartTime.getTime()) / 1000 / 60);
    const remaining = Math.max(0, 30 - elapsed);
    
    return {
      isRunning: this.isRunning,
      runningTasks: Array.from(this.runningTasks),
      runningTaskCount: this.runningTasks.size,
      timezone: process.env.TZ,
      activeTasks: Array.from(this.tasks.keys()),
      errorCount: this.errorCount,
      maxErrors: this.maxErrors,
      testMode: true,
      elapsedMinutes: elapsed,
      remainingMinutes: remaining,
      executedTasks: Object.fromEntries(this.executedTasks)
    };
  }
}

// Handle graceful shutdown
const gracefulShutdown = async (scheduler) => {
  console.log('🛑 Received shutdown signal, stopping test scheduler...');
  
  if (scheduler) {
    await scheduler.stop();
    await scheduler.printTestSummary();
  }
  
  try {
    await closeDb();
  } catch (error) {
    console.error('Error closing database:', error.message);
  }
  
  console.log('👋 Test scheduler shutdown completed');
  process.exit(0);
};

// Prevent process from exiting unexpectedly
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception [TEST MODE]:', error);
  // Don't exit in test mode - just log
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection [TEST MODE] at:', promise, 'reason:', reason);
  // Don't exit in test mode - just log
});

// Main execution - ensure this only runs when called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
const isTestSchedulerFile = process.argv[1] && process.argv[1].endsWith('test_scheduler.js');

if (isMainModule || isTestSchedulerFile) {
  console.log('🧪 STARTING TEST SCHEDULER...');
  
  const scheduler = new TestScheduleService();
  
  // Handle shutdown signals
  process.on('SIGINT', () => gracefulShutdown(scheduler));
  process.on('SIGTERM', () => gracefulShutdown(scheduler));
  
  // Prevent process exit during test
  process.on('beforeExit', (code) => {
    if (scheduler.isRunning && code === 0) {
      console.log('🔄 Preventing unexpected exit during test...');
      setTimeout(() => {
        console.log('💓 Test scheduler still running...');
      }, 1000);
    }
  });
  
  // Start the test scheduler
  (async () => {
    try {
      await scheduler.start();
      console.log('🧪 Test scheduler is running. It will auto-stop after 30 minutes.');
      console.log('⏹️  Press Ctrl+C to stop early if needed.');
      console.log('');
      
      // Keep process alive with a simple interval
      const keepAlive = setInterval(() => {
        if (!scheduler.isRunning) {
          clearInterval(keepAlive);
        }
      }, 10000); // Every 10 seconds
      
    } catch (error) {
      console.error('❌ Failed to start test scheduler:', error);
      process.exit(1);
    }
  })();
}

export default TestScheduleService;
