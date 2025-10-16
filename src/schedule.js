import cron from 'node-cron';
import dotenv from 'dotenv';
import { OneTimeAnalysis } from './ai_analyzer.js';
import { RealisticRedditFetcher } from './reddit_fetcher.js';
import KPIService from './kpi.js';
import SlackService from './slack.js';
import ChannelConfigService from './channel_config_service.js';
import { ReportCreator } from './report_creator.js';
import { postReportAsPNG, postReportWithRetry } from './send-to-slack.js';
import { closeDb } from './db.js';

dotenv.config();

class ScheduleService {
  constructor() {
    this.kpi = new KPIService();
    this.channelConfig = new ChannelConfigService();
    this.reportCreator = new ReportCreator();
    this.isRunning = false;
    this.tasks = new Map();
    this.runningTasks = new Set(); // Track individual running tasks
    this.taskQueues = new Map(); // Queue for tasks that need to wait for resources
    this.sharedResources = new Map(); // Track shared resource usage
    this.heartbeatInterval = null;
    this.errorCount = 0;
    this.maxErrors = 10; // Maximum errors before restart attempt
    
    // Initialize resource tracking
    this.sharedResources.set('database', new Set());
    this.sharedResources.set('slack_api', new Set());
    this.sharedResources.set('reddit_api', new Set());
    
    // Set timezone to UTC as requested
    process.env.TZ = 'UTC';
    
    console.log(`⏰ Schedule service initialized with timezone: UTC`);
  }

  /**
   * Start all scheduled tasks
   */
  async start() {
    console.log('🚀 Starting scheduled tasks...');
    
    try {
      // Test database connectivity first
      await this.testConnections();
      
      // 3-hour Reddit fetch task: Every 3 hours at 01:00, 04:00, 07:00, 10:00, 13:00, 16:00, 19:00, 22:00 UTC
      const threeHourFetchTask = cron.schedule('0 1,4,7,10,13,16,19,22 * * *', async () => {
        await this.safeTaskExecution('threehour_fetch', () => this.runThreeHourFetchTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('threehour_fetch', threeHourFetchTask);

      // Daily analysis task: 23:00 every day UTC
      const dailyTask = cron.schedule('0 23 * * *', async () => {
        await this.safeTaskExecution('daily', () => this.runDailyTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('daily', dailyTask);

      // Weekly task: 23:30 every Sunday UTC
      const weeklyTask = cron.schedule('30 23 * * 0', async () => {
        await this.safeTaskExecution('weekly', () => this.runWeeklyTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('weekly', weeklyTask);

      // Monthly task: 23:30 on the 1st of every month UTC
      const monthlyTask = cron.schedule('30 23 1 * *', async () => {
        await this.safeTaskExecution('monthly', () => this.runMonthlyTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('monthly', monthlyTask);

      // Quarterly task: 23:30 on January 1st, April 1st, July 1st, October 1st UTC
      const quarterlyTask = cron.schedule('30 23 1 1,4,7,10 *', async () => {
        await this.safeTaskExecution('quarterly', () => this.runQuarterlyTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('quarterly', quarterlyTask);

      // Yearly task: 23:45 on January 1st UTC
      const yearlyTask = cron.schedule('45 23 1 1 *', async () => {
        await this.safeTaskExecution('yearly', () => this.runYearlyTask());
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('yearly', yearlyTask);

      // Start all tasks
      this.tasks.forEach((task, name) => {
        try {
          task.start();
          console.log(`✅ ${name} task scheduled`);
        } catch (error) {
          console.error(`❌ Failed to start ${name} task:`, error);
        }
      });

      this.isRunning = true;
      console.log('🎯 All scheduled tasks are now active');
      
      // Start heartbeat monitoring
      this.startHeartbeat();
      
      // Send startup notification to all configured channels
      try {
        await this.sendStartupNotifications();
      } catch (error) {
        console.error('❌ Failed to send startup notifications:', error.message);
      }
      
    } catch (error) {
      console.error('❌ Failed to start scheduled tasks:', error);
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
        const status = this.isRunning ? 'Running' : 'Stopped';
        const runningTasksList = this.runningTasks.size > 0 ? Array.from(this.runningTasks).join(', ') : 'None';
        console.log(`💓 Scheduler heartbeat - Status: ${status} | Running Tasks: [${runningTasksList}] | Errors: ${this.errorCount}/${this.maxErrors}`);
        
        // Reset error count if it's been running fine
        if (this.errorCount > 0 && this.isRunning) {
          this.errorCount = Math.max(0, this.errorCount - 1);
        }
      } catch (error) {
        console.error('❌ Heartbeat error:', error);
        this.errorCount++;
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Send startup notifications to all channels
   */
  async sendStartupNotifications() {
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      // Startup notification removed - only reports will be sent
    } catch (error) {
      console.error('❌ Failed to send startup notifications:', error.message);
    }
  }

  /**
   * Safe task execution wrapper with task-specific locking
   */
  async safeTaskExecution(taskName, taskFunction) {
    // Check if this specific task is already running
    if (this.runningTasks.has(taskName)) {
      console.log(`⚠️ ${taskName} task skipped - this specific task is already running`);
      return;
    }

    console.log(`🔧 Starting ${taskName} task... (${this.runningTasks.size} other tasks running)`);
    this.runningTasks.add(taskName);
    
    try {
      await taskFunction();
      console.log(`✅ ${taskName} task completed successfully (${this.runningTasks.size - 1} tasks still running)`);
      this.errorCount = Math.max(0, this.errorCount - 1); // Reduce error count on success
    } catch (error) {
      console.error(`❌ ${taskName} task failed:`, error);
      this.errorCount++;
      
      // Try to send error notification to channels
      try {
        await this.sendErrorNotification(taskName, error);
      } catch (notificationError) {
        console.error('❌ Failed to send error notification:', notificationError);
      }
      
      // If too many errors, try to restart
      if (this.errorCount >= this.maxErrors) {
        console.error(`❌ Too many errors (${this.errorCount}), attempting restart...`);
        await this.attemptRestart();
      }
    } finally {
      this.runningTasks.delete(taskName);
    }
  }

  /**
   * Send error notification to channels
   */
  async sendErrorNotification(taskName, error) {
    try {
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      for (const channel of channels) {
        // Error notification removed - only reports will be sent
      }
    } catch (error) {
      console.error('❌ Failed to send error notifications:', error);
    }
  }

  /**
   * Attempt to restart the scheduler
   */
  async attemptRestart() {
    try {
      console.log('🔄 Attempting scheduler restart...');
      
      // Stop all tasks
      this.stop();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Reset error count
      this.errorCount = 0;
      
      // Restart
      await this.start();
      
      console.log('✅ Scheduler restarted successfully');
    } catch (error) {
      console.error('❌ Failed to restart scheduler:', error);
      // Don't throw here to prevent complete shutdown
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    console.log('🛑 Stopping scheduled tasks...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.tasks.forEach((task, name) => {
      try {
        task.stop();
        console.log(`⏹️ ${name} task stopped`);
      } catch (error) {
        console.error(`❌ Error stopping ${name} task:`, error);
      }
    });
    
    this.isRunning = false;
    console.log('📴 All scheduled tasks stopped');
  }

  /**
   * Run 3-hour Reddit fetch and update task with immediate AI analysis
   */
  async runThreeHourFetchTask() {
    console.log('🕒 Starting 3-hour Reddit fetch, update, and analysis task...');
    
    try {
      // Step 1: Fetch new posts and update existing posts from Reddit
      console.log('📡 Fetching new posts and updating existing posts from Reddit...');
      const fetcher = new RealisticRedditFetcher();
      
      // Fetch new posts
      await fetcher.fetchRecentData(true); // Keep pool alive for scheduler
      console.log('✅ New posts fetch completed successfully');
      
      // Step 2: Update existing posts (votes, comments, moderator activity)
      console.log('🔄 Updating existing posts with latest data...');
      await fetcher.updateExistingPosts(true); // Keep pool alive
      console.log('✅ Existing posts update completed successfully');
      
      // Step 3: Immediately analyze all unanalyzed content
      console.log('🤖 Starting AI analysis of all unanalyzed content...');
      const analysis = new OneTimeAnalysis();
      await analysis.run();
      console.log('✅ AI analysis completed successfully');
      
      console.log('✅ 3-hour fetch, update, and analysis task completed successfully');
    } catch (error) {
      console.error('❌ 3-hour fetch, update, and analysis task failed:', error);
      throw error;
    }
  }

  /**
   * Run daily task (with Slack notifications to all configured channels)
   */
  async runDailyTask() {
    console.log('🌅 Starting daily KPI report task...');
    
    try {
      // Get all channels that should receive daily reports
      const channels = await this.channelConfig.getChannelsForScheduledReport('daily');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for daily reports');
        return;
      }

      console.log(`📊 Sending daily reports to ${channels.length} channels`);
      
      // Send to each configured channel with channel-specific report
      for (const channel of channels) {
        try {
          console.log(`📤 Sending daily report to channel: ${channel.channel_name} (${channel.report_name})`);
          
          // Create channel-specific Slack service
          const channelSlack = new SlackService(channel.channel_id, channel.report_name);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('daily', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'daily');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'daily',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories
          });
          
          console.log(`✅ Daily report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send daily report to ${channel.channel_name}:`, channelError);
          
          // Log the error
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_failed', {
            report_type: 'daily',
            error: channelError.message
          });
        }
      }
      
      console.log('✅ Daily KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Daily task failed:', error);
      throw error;
    }
  }

  /**
   * Run weekly task (KPI report to all enabled channels)
   */
  async runWeeklyTask() {
    console.log('📅 Starting weekly KPI report task...');
    
    try {
      // Get all channels that should receive weekly reports
      const channels = await this.channelConfig.getChannelsForScheduledReport('weekly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for weekly reports');
        return;
      }

      console.log(`📊 Sending weekly reports to ${channels.length} channels`);
      
      // Send to each configured channel with channel-specific report
      for (const channel of channels) {
        try {
          console.log(`📤 Sending weekly report to channel: ${channel.channel_name} (${channel.report_name})`);
          
          // Create channel-specific Slack service
          const channelSlack = new SlackService(channel.channel_id, channel.report_name);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('weekly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'weekly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'weekly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories
          });
          
          console.log(`✅ Weekly report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send weekly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('✅ Weekly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Weekly task failed:', error);
      throw error;
    }
  }

  /**
   * Run monthly task (KPI report to all enabled channels)
   */
  async runMonthlyTask() {
    console.log('📊 Starting monthly KPI report task...');
    
    try {
      // Get all channels that should receive monthly reports
      const channels = await this.channelConfig.getChannelsForScheduledReport('monthly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for monthly reports');
        return;
      }

      console.log(`📊 Sending monthly reports to ${channels.length} channels`);
      
      // Send to each configured channel with channel-specific report
      for (const channel of channels) {
        try {
          console.log(`📤 Sending monthly report to channel: ${channel.channel_name} (${channel.report_name})`);
          
          // Create channel-specific Slack service
          const channelSlack = new SlackService(channel.channel_id, channel.report_name);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('monthly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'monthly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'monthly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories
          });
          
          console.log(`✅ Monthly report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send monthly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('✅ Monthly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Monthly task failed:', error);
      throw error;
    }
  }

  /**
   * Run quarterly task (KPI report to all enabled channels)
   */
  async runQuarterlyTask() {
    console.log('📈 Starting quarterly KPI report task...');
    
    try {
      // Get all channels that should receive quarterly reports
      const channels = await this.channelConfig.getChannelsForScheduledReport('quarterly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for quarterly reports');
        return;
      }

      console.log(`📊 Sending quarterly reports to ${channels.length} channels`);
      
      // Send to each configured channel with channel-specific report
      for (const channel of channels) {
        try {
          console.log(`📤 Sending quarterly report to channel: ${channel.channel_name} (${channel.report_name})`);
          
          // Create channel-specific Slack service
          const channelSlack = new SlackService(channel.channel_id, channel.report_name);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('quarterly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'quarterly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'quarterly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories
          });
          
          console.log(`✅ Quarterly report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send quarterly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('✅ Quarterly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Quarterly task failed:', error);
      throw error;
    }
  }

  /**
   * Run yearly task (KPI report to all enabled channels)
   */
  async runYearlyTask() {
    console.log('🏆 Starting yearly KPI report task...');
    
    try {
      // Get all channels that should receive yearly reports
      const channels = await this.channelConfig.getChannelsForScheduledReport('yearly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for yearly reports');
        return;
      }

      console.log(`📊 Sending yearly reports to ${channels.length} channels`);
      
      // Send to each configured channel with channel-specific report
      for (const channel of channels) {
        try {
          console.log(`📤 Sending yearly report to channel: ${channel.channel_name} (${channel.report_name})`);
          
          // Create channel-specific Slack service
          const channelSlack = new SlackService(channel.channel_id, channel.report_name);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('yearly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'yearly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'yearly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories
          });
          
          console.log(`✅ Yearly report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send yearly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('✅ Yearly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Yearly task failed:', error);
      throw error;
    }
  }

  /**
   * Send ReportCreator format report to Slack with PNG attachment
   */
  async sendReportCreatorToSlack(channelSlack, report, reportType) {
    try {
      console.log(`🎨 Generating scheduled ${reportType} report with PNG attachment...`);
      
      // Extract categories from report filters
      const categories = report.filters && report.filters.categories ? report.filters.categories : [];
      
      // Send text report with PNG attachment
      await this.sendReportCreatorToSlackWithPNG(channelSlack, report, reportType, categories);
      console.log(`✅ Scheduled ${reportType} report sent with PNG attachment`);
      
    } catch (error) {
      console.error(`❌ Failed to post scheduled ${reportType} report with PNG:`, error);
      
      // If everything fails, try just the text-based report as final fallback
      console.log(`🔄 Final fallback: sending text-based report only for ${reportType}...`);
      await this.sendReportCreatorToSlackText(channelSlack, report, reportType);
      
      throw error;
    }
  }

  /**
   * Send ReportCreator format report to Slack with PNG attachment
   */
  async sendReportCreatorToSlackWithPNG(channelSlack, report, reportType, categories) {
    const periodEmoji = {
      daily: '📅',
      weekly: '📊', 
      monthly: '📈',
      quarterly: '🎯',
      yearly: '🏆'
    };

    const emoji = periodEmoji[reportType] || '📊';
    
    // Create title with report name if it's a configured report
    let title = `${reportType.toUpperCase()} ANALYSIS REPORT`;
    
    // Add report name to title if this is a configured report
    if (channelSlack.reportName) {
      title = `${channelSlack.reportName} - ${title}`;
    }
    
    // Create main summary message with new format
    const mainMessage = {
      text: `${emoji} *${title}*`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} ${title}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📅 Period:* ${new Date(report.timeRange.start).toLocaleDateString()} - ${new Date(report.timeRange.end).toLocaleDateString()} • *📊 Total Posts:* ${report.summary.total_posts}`
          }
        }
      ]
    };

    // Add general sentiment summary
    if (report.sentiments && report.sentiments.length > 0) {
      const sentimentEmojis = {
        'pos': '😊',
        'neg': '😟', 
        'neu': '😐'
      };
      
      mainMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*General Sentiment:* ${report.sentiments.map(sentiment => `${sentimentEmojis[sentiment.sentiment] || '📊'} ${sentiment.sentiment.toUpperCase()}: ${sentiment.count} (${sentiment.percentage}%)`).join(' • ')}`
        }
      });
    }

        // Add all categories breakdown
        if (report.categories && report.categories.length > 0) {
          mainMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*All Categories Breakdown:*'
            }
          });
          
          // Group categories into pairs for 2-column layout
          for (let i = 0; i < report.categories.length; i += 2) {
            const category1 = report.categories[i];
            const category2 = report.categories[i + 1];
            
            const fields = [
              {
                type: 'mrkdwn',
                text: `\`${category1.category.replace('_', ' ').toUpperCase()}\`: ${category1.count} (${category1.percentage}%)`
              }
            ];
            
            if (category2) {
              fields.push({
                type: 'mrkdwn',
                text: `\`${category2.category.replace('_', ' ').toUpperCase()}\`: ${category2.count} (${category2.percentage}%)`
              });
            }
            
            mainMessage.blocks.push({
              type: 'section',
              fields: fields
            });
          }
        }

    // Add category filter info if filtered
    if (report.filters && report.filters.categories && report.filters.categories.length > 0) {
      mainMessage.blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `🔍 *Filtered Categories:* ${report.filters.categories.map(c => c.replace('_', ' ')).join(', ')}`
          }
        ]
      });
    }

    // Try to generate and attach PNG using the new approach
    try {
      console.log(`🎨 Generating PNG attachment for scheduled ${reportType}...`);
      const { renderReportPNG } = await import('./report-image.js');
      const { adaptReportDataForPNG } = await import('./data-adapter.js');
      
      // Adapt report data for PNG renderer
      const adaptedData = adaptReportDataForPNG(report);
      const pngBuffer = await renderReportPNG(adaptedData);
      
      // Use the new approach: upload PNG first, then post main message
      const { WebClient } = await import('@slack/web-api');
      const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
      
      const timestamp = new Date().toISOString().slice(0, 10);
      const categorySuffix = categories.length > 0 ? `-${categories.join('-')}` : '';
      const filename = `${reportType}-report-${timestamp}${categorySuffix}.png`;
      
      // Now post the main text message first
      const mainResponse = await channelSlack.postMessage(mainMessage);
      
      // Upload PNG to thread using files.uploadV2 (recommended by Slack)
      const uploadResult = await slack.files.uploadV2({
        channel_id: channelSlack.channelId,
        filename: filename,
        file: Buffer.from(pngBuffer), // Ensure it's a proper Buffer
        title: `${title} - Data Visualization`,
        thread_ts: mainResponse.ts
      });
      
      console.log(`📊 Upload result:`, JSON.stringify(uploadResult, null, 2));
      console.log(`✅ PNG uploaded to thread successfully for scheduled ${reportType}! File ID: ${uploadResult.file?.id || uploadResult.id || 'N/A'}`);
      
      // Post detailed analysis as thread replies
      await this.postDetailedAnalysisAsThread(channelSlack, mainResponse.ts, report);
      
    } catch (pngError) {
      console.log(`⚠️  PNG attachment failed for scheduled ${reportType}, sending text-only report: ${pngError.message}`);
      
      // Fallback to regular text report without PNG
      const mainResponse = await channelSlack.postMessage(mainMessage);
      
      // Post detailed analysis as thread replies
      await this.postDetailedAnalysisAsThread(channelSlack, mainResponse.ts, report);
    }
  }

  /**
   * Fallback method: Send ReportCreator format report to Slack with text formatting
   */
  async sendReportCreatorToSlackText(channelSlack, report, reportType) {
    try {
      const periodEmoji = {
        daily: '📅',
        weekly: '📊', 
        monthly: '📈',
        quarterly: '🎯',
        yearly: '🏆'
      };

      const emoji = periodEmoji[reportType] || '📊';
      
      // Create title with report name if it's a configured report
      let title = `${reportType.toUpperCase()} ANALYSIS REPORT`;
      
      // Add report name to title if this is a configured report
      if (channelSlack.reportName) {
        title = `${channelSlack.reportName} - ${title}`;
      }
      
    // Create main summary message with new format
    const mainMessage = {
      text: `${emoji} *${title}*`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} ${title}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📅 Period:* ${new Date(report.timeRange.start).toLocaleDateString()} - ${new Date(report.timeRange.end).toLocaleDateString()} • *📊 Total Posts:* ${report.summary.total_posts}`
          }
        }
      ]
    };

    // Add general sentiment summary
    if (report.sentiments && report.sentiments.length > 0) {
      const sentimentEmojis = {
        'pos': '😊',
        'neg': '😟', 
        'neu': '😐'
      };
      
      mainMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*General Sentiment:* ${report.sentiments.map(sentiment => `${sentimentEmojis[sentiment.sentiment] || '📊'} ${sentiment.sentiment.toUpperCase()}: ${sentiment.count} (${sentiment.percentage}%)`).join(' • ')}`
        }
      });
    }

        // Add all categories breakdown
        if (report.categories && report.categories.length > 0) {
          mainMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*All Categories Breakdown:*'
            }
          });
          
          // Group categories into pairs for 2-column layout
          for (let i = 0; i < report.categories.length; i += 2) {
            const category1 = report.categories[i];
            const category2 = report.categories[i + 1];
            
            const fields = [
              {
                type: 'mrkdwn',
                text: `\`${category1.category.replace('_', ' ').toUpperCase()}\`: ${category1.count} (${category1.percentage}%)`
              }
            ];
            
            if (category2) {
              fields.push({
                type: 'mrkdwn',
                text: `\`${category2.category.replace('_', ' ').toUpperCase()}\`: ${category2.count} (${category2.percentage}%)`
              });
            }
            
            mainMessage.blocks.push({
              type: 'section',
              fields: fields
            });
          }
        }

    // Add category filter info if filtered
    if (report.filters && report.filters.categories && report.filters.categories.length > 0) {
      mainMessage.blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `🔍 *Filtered Categories:* ${report.filters.categories.map(c => c.replace('_', ' ')).join(', ')}`
          }
        ]
      });
    }

      // Post main message to Slack
      const mainResponse = await channelSlack.postMessage(mainMessage);
      
      // Post detailed analysis as thread replies
      await this.postDetailedAnalysisAsThread(channelSlack, mainResponse.ts, report);
      
    } catch (error) {
      console.error('❌ Failed to send ReportCreator text report to Slack:', error);
      throw error;
    }
  }

  /**
   * Post detailed analysis as thread replies with simplified format
   */
  async postDetailedAnalysisAsThread(channelSlack, threadTs, report) {
    try {
      // Thread 1: Top 2 Engaged Posts (simplified)
      if (report.top2EngagedPosts && report.top2EngagedPosts.length > 0) {
        const topPostsMessage = {
          text: "🔥 *Top 2 Engaged Posts*",
          thread_ts: threadTs,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*🔥 Top 2 Engaged Posts*'
              }
            }
          ]
        };

        for (let i = 0; i < Math.min(report.top2EngagedPosts.length, 2); i++) {
          const post = report.top2EngagedPosts[i];
          const engagement = post.score + (post.num_comments * 2);
          const date = new Date(post.created_utc * 1000).toLocaleDateString();
          
          // Simple post info
          topPostsMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${i + 1}. ${post.title.substring(0, 100)}${post.title.length > 100 ? '...' : ''}*\n📊 Score: ${post.score} • 💬 Comments: ${post.num_comments} • 🔥 Engagement: ${engagement}\n🏷️ ${post.category} • 😊 ${post.sentiment} • 📅 ${date} • 👤 ${post.author}`
            },
            accessory: {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View'
              },
              url: `https://reddit.com${post.permalink}`,
              action_id: `view_post_${i}`
            }
          });

                // Top 2 comments
                if (post.topComments && post.topComments.length > 0) {
                  const commentsToShow = post.topComments.slice(0, 2);
                  commentsToShow.forEach((comment, commentIndex) => {
                    topPostsMessage.blocks.push({
                      type: 'context',
                      elements: [
                        {
                          type: 'mrkdwn',
                          text: `*Top Comment ${commentIndex + 1}:* "${comment.body}" - u/${comment.author} (${comment.score})`
                        }
                      ]
                    });
                  });
                }

          // Moderator reply status
          if (post.moderatorReplies && post.moderatorReplies.length > 0) {
            topPostsMessage.blocks.push({
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `✅ Moderator replied (${post.moderatorReplies.length} reply)`
                }
              ]
            });
          } else {
            topPostsMessage.blocks.push({
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `❌ No moderator reply`
                }
              ]
            });
          }

          if (i < report.top2EngagedPosts.length - 1) {
            topPostsMessage.blocks.push({ type: 'divider' });
          }
        }

        await channelSlack.postMessage(topPostsMessage);
      }

      // Thread 2: Top Engaged Comment (simplified)
      if (report.commentExamples && (report.commentExamples.positive.length > 0 || report.commentExamples.negative.length > 0 || report.commentExamples.neutral?.length > 0)) {
        const allComments = [
          ...report.commentExamples.positive,
          ...report.commentExamples.negative,
          ...(report.commentExamples.neutral || [])
        ];
        
        if (allComments.length > 0) {
          const mostEngagedComment = allComments.sort((a, b) => b.score - a.score)[0];
          
          const commentMessage = {
            text: "💬 *Top Engaged Comment*",
            thread_ts: threadTs,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '*💬 Top Engaged Comment*'
                }
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `> "${mostEngagedComment.body}"`
                }
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `- u/${mostEngagedComment.author} • Score: ${mostEngagedComment.score} • Sentiment: ${mostEngagedComment.sentiment}`
                  }
                ]
              }
            ]
          };
          await channelSlack.postMessage(commentMessage);
        }
      }

      // Thread 3: Moderator Stats (simplified)
      if (report.top5ModeratorCommenters && report.top5ModeratorCommenters.length > 0) {
        const moderatorMessage = {
          text: "👮 *Moderator Stats*",
          thread_ts: threadTs,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*👮 Top 5 Moderator Commenters*'
              }
            }
          ]
        };

              report.top5ModeratorCommenters.forEach((moderator, index) => {
                // Add moderator name as normal section
                moderatorMessage.blocks.push({
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*${index + 1}. u/${moderator.moderator_username}*`
                  }
                });
                
                // Add stats as context block
                moderatorMessage.blocks.push({
                  type: 'context',
                  elements: [
                    {
                      type: 'mrkdwn',
                      text: `Posts: ${moderator.posts_handled} • Comments: ${moderator.total_comments} • Avg Score: ${Math.round(moderator.avg_comment_score)} • Avg Time: ${moderator.avg_response_time_minutes ? `${moderator.avg_response_time_minutes}m` : 'N/A'} • Sentiment: 😊${moderator.positive_sentiment_percentage}% 😟${moderator.negative_sentiment_percentage}% 😐${moderator.neutral_sentiment_percentage}%`
                    }
                  ]
                });
              });

        // Overall stats - show even if no moderator responses
        if (report.moderatorAnalysis) {
          const moderatorAnalysis = report.moderatorAnalysis;
          const responseTimeText = moderatorAnalysis.avgFirstResponseTimeMinutes > 0 
            ? `${moderatorAnalysis.avgFirstResponseTimeMinutes} minutes` 
            : 'No responses';
          
          moderatorMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*📊 Overall Stats:*\nResponse Rate: ${moderatorAnalysis.moderatorResponsePercentage}% • Avg Response Time: ${responseTimeText}\nActive Moderators: ${moderatorAnalysis.uniqueModerators} • Total Responses: ${moderatorAnalysis.totalModeratorResponses}`
            }
          });
        }

        await channelSlack.postMessage(moderatorMessage);
      }

    } catch (error) {
      console.error('❌ Failed to post detailed analysis threads:', error);
    }
  }

  /**
   * Run a specific task manually (for testing)
   */
  async runTaskManually(taskType) {
    console.log(`🔧 Running ${taskType} task manually...`);
    
    switch (taskType.toLowerCase()) {
      case 'threehour_fetch':
      case 'threehour':
        await this.safeTaskExecution('threehour_fetch', () => this.runThreeHourFetchTask());
        break;
      case 'daily':
        await this.safeTaskExecution('daily', () => this.runDailyTask());
        break;
      case 'weekly':
        await this.safeTaskExecution('weekly', () => this.runWeeklyTask());
        break;
      case 'monthly':
        await this.safeTaskExecution('monthly', () => this.runMonthlyTask());
        break;
      case 'quarterly':
        await this.safeTaskExecution('quarterly', () => this.runQuarterlyTask());
        break;
      case 'yearly':
        await this.safeTaskExecution('yearly', () => this.runYearlyTask());
        break;
      default:
        throw new Error(`Unknown task type: ${taskType}. Available: threehour_fetch, daily, weekly, monthly, quarterly, yearly`);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      runningTasks: Array.from(this.runningTasks),
      runningTaskCount: this.runningTasks.size,
      timezone: process.env.TZ,
      activeTasks: Array.from(this.tasks.keys()),
      nextRuns: this.getNextRunTimes(),
      errorCount: this.errorCount,
      maxErrors: this.maxErrors
    };
  }

  /**
   * Get next run times for all tasks
   */
  getNextRunTimes() {
    const nextRuns = {};
    
    // Calculate next run times (simplified - in a real implementation you'd use a proper cron parser)
    const now = new Date();
    
    // Three-hour fetch: next occurrence
    const next3Hour = new Date(now);
    const hours3 = [1, 4, 7, 10, 13, 16, 19, 22];
    let nextHour3 = hours3.find(h => h > now.getHours()) || hours3[0];
    if (nextHour3 <= now.getHours()) {
      next3Hour.setDate(next3Hour.getDate() + 1);
    }
    next3Hour.setHours(nextHour3, 0, 0, 0);
    nextRuns.threehour_fetch = next3Hour.toISOString();
    
    // Daily: next 23:00
    const nextDaily = new Date(now);
    nextDaily.setHours(23, 0, 0, 0);
    if (nextDaily <= now) {
      nextDaily.setDate(nextDaily.getDate() + 1);
    }
    nextRuns.daily = nextDaily.toISOString();
    
    // Weekly: next Sunday 23:30
    const nextWeekly = new Date(now);
    nextWeekly.setHours(23, 30, 0, 0);
    const daysUntilSunday = (7 - nextWeekly.getDay()) % 7 || 7;
    nextWeekly.setDate(nextWeekly.getDate() + daysUntilSunday);
    nextRuns.weekly = nextWeekly.toISOString();
    
    // Monthly: next 1st at 23:30
    const nextMonthly = new Date(now);
    nextMonthly.setDate(1);
    nextMonthly.setHours(23, 30, 0, 0);
    if (nextMonthly <= now) {
      nextMonthly.setMonth(nextMonthly.getMonth() + 1);
    }
    nextRuns.monthly = nextMonthly.toISOString();
    
    // Quarterly: next quarter start at 23:30
    const nextQuarterly = new Date(now);
    const quarterStarts = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct
    let nextQuarter = quarterStarts.find(q => q > now.getMonth());
    if (!nextQuarter) {
      nextQuarter = 0;
      nextQuarterly.setFullYear(nextQuarterly.getFullYear() + 1);
    }
    nextQuarterly.setMonth(nextQuarter, 1);
    nextQuarterly.setHours(23, 30, 0, 0);
    nextRuns.quarterly = nextQuarterly.toISOString();
    
    return nextRuns;
  }

  /**
   * Health check for all services
   */
  async healthCheck() {
    try {
      // Test database connectivity
      const channels = await this.channelConfig.getActiveChannels();
      
      return {
        status: 'healthy',
        scheduler: {
          isRunning: this.isRunning,
          isTaskRunning: this.isTaskRunning,
          activeTasks: this.tasks.size,
          errorCount: this.errorCount
        },
        database: {
          connected: true,
          activeChannels: channels.length
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        scheduler: {
          isRunning: this.isRunning,
          isTaskRunning: this.isTaskRunning,
          activeTasks: this.tasks.size,
          errorCount: this.errorCount
        }
      };
    }
  }
}

// Handle graceful shutdown
const gracefulShutdown = async (scheduler) => {
  console.log('🛑 Received shutdown signal, stopping scheduler...');
  
  if (scheduler) {
    scheduler.stop();
    
    try {
      const channels = await scheduler.channelConfig.getChannelsForScheduledReport('daily');
      // Stop notification removed - only reports will be sent
    } catch (error) {
      console.error('Error during shutdown notifications:', error.message);
    }
  }
  
  try {
    await closeDb();
  } catch (error) {
    console.error('Error closing database:', error.message);
  }
  
  console.log('👋 Graceful shutdown completed');
  process.exit(0);
};

// Prevent process from exiting unexpectedly
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit - just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - just log the error
});

// Main execution
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('schedule.js')) {
  const scheduler = new ScheduleService();
  
  // Handle shutdown signals
  process.on('SIGINT', () => gracefulShutdown(scheduler));
  process.on('SIGTERM', () => gracefulShutdown(scheduler));
  
  // Prevent process exit
  process.on('beforeExit', (code) => {
    if (scheduler.isRunning && code === 0) {
      console.log('🔄 Preventing unexpected exit, scheduler is still running...');
      // Keep the process alive
      setTimeout(() => {
        console.log('💓 Process kept alive');
      }, 1000);
    }
  });
  
  // Start the scheduler
  (async () => {
    try {
      await scheduler.start();
      console.log('🎯 Scheduler is running continuously. Press Ctrl+C to stop.');
      console.log('📋 Schedule:');
      console.log('  - 3-Hour Fetch: 01:00, 04:00, 07:00, 10:00, 13:00, 16:00, 19:00, 22:00 UTC');
      console.log('  - Daily Reports: 23:00 UTC daily');
      console.log('  - Weekly Reports: 23:30 UTC every Sunday');
      console.log('  - Monthly Reports: 23:30 UTC on 1st of each month');
      console.log('  - Quarterly Reports: 23:30 UTC on Jan 1, Apr 1, Jul 1, Oct 1');
      
    } catch (error) {
      console.error('❌ Failed to start scheduler:', error);
      process.exit(1);
    }
  })();
}

export default ScheduleService;
