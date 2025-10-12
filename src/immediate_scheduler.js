import cron from 'node-cron';
import dotenv from 'dotenv';
import { closeDb } from './db.js';

dotenv.config();

class ImmediateScheduleService {
  constructor() {
    // DON'T initialize any services in constructor - they'll be loaded when needed
    this.kpi = null;
    this.channelConfig = null;
    this.reportCreator = null;
    this.isRunning = false;
    this.tasks = new Map();
    
    // Set timezone to UTC as requested
    process.env.TZ = 'UTC';
    
    console.log(`⏰ Immediate Schedule service initialized with timezone: UTC`);
    console.log('🎯 IMMEDIATE MODE - All tasks will run with very short intervals for testing!');
    console.log('📦 Services will be loaded dynamically when cron jobs trigger');
  }

  /**
   * Load services dynamically only when needed
   */
  async loadServices() {
    if (!this.channelConfig) {
      const { default: ChannelConfigService } = await import('./channel_config_service.js');
      this.channelConfig = new ChannelConfigService();
    }
    if (!this.reportCreator) {
      const { ReportCreator } = await import('./report_creator.js');
      this.reportCreator = new ReportCreator();
    }
    if (!this.kpi) {
      const { default: KPIService } = await import('./kpi.js');
      this.kpi = new KPIService();
    }
  }

  /**
   * Start all scheduled tasks - EXACT COPY with different cron expressions
   */
  async start() {
    console.log('🚀 Starting scheduled tasks...');
    console.log('📅 IMMEDIATE SCHEDULE:');
    console.log('  - 3-Hour Fetch: Every 2 minutes (*/2 * * * *)');
    console.log('  - Daily Report: Every 3 minutes (*/3 * * * *)'); 
    console.log('  - Weekly Report: Every 4 minutes (*/4 * * * *)');
    console.log('  - Monthly Report: Every 5 minutes (*/5 * * * *)');
    console.log('  - Quarterly Report: Every 6 minutes (*/6 * * * *) ⭐');
    console.log('');
    
    try {
      // 3-hour Reddit fetch task: Every 2 minutes to avoid immediate trigger
      const threeHourFetchTask = cron.schedule('*/2 * * * *', () => {
        this.runThreeHourFetchTask();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('threehour_fetch', threeHourFetchTask);

      // Daily update task removed - realistic fetch now handles all updates

      // Daily analysis task: Every 3 minutes instead of 23:00 every day UTC
      const dailyTask = cron.schedule('*/3 * * * *', () => {
        this.runDailyTask();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('daily', dailyTask);

      // AI analysis is now included in the 6-hour fetch task, so no separate AI analysis task needed

      // Weekly task: Every 4 minutes instead of 23:30 every Sunday UTC
      const weeklyTask = cron.schedule('*/4 * * * *', () => {
        this.runWeeklyTask();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('weekly', weeklyTask);

      // Monthly task: Every 5 minutes instead of 23:30 on the 1st of every month UTC
      const monthlyTask = cron.schedule('*/5 * * * *', () => {
        this.runMonthlyTask();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('monthly', monthlyTask);

      // 🎯 Quarterly task: Every 6 minutes instead of 23:30 on January 1st, April 1st, July 1st, October 1st UTC
      const quarterlyTask = cron.schedule('*/6 * * * *', () => {
        this.runQuarterlyTask();
      }, {
        scheduled: false,
        timezone: 'UTC'
      });
      this.tasks.set('quarterly', quarterlyTask);

      // Start all tasks - EXACT SAME CODE
      this.tasks.forEach((task, name) => {
        task.start();
        console.log(`✅ ${name} task scheduled`);
      });

      this.isRunning = true;
      console.log('🎯 All scheduled tasks are now active');
      
      // Skip startup notification to prevent immediate service loading
      console.log('📢 Startup notification deferred - services will load when first cron job triggers');
      
    } catch (error) {
      console.error('❌ Failed to start scheduled tasks:', error);
      throw error;
    }
  }

  /**
   * Stop all scheduled tasks - EXACT SAME CODE
   */
  stop() {
    console.log('🛑 Stopping scheduled tasks...');
    
    this.tasks.forEach((task, name) => {
      task.stop();
      console.log(`⏹️ ${name} task stopped`);
    });
    
    this.isRunning = false;
    console.log('📴 All scheduled tasks stopped');
  }

  /**
   * Run 3-hour Reddit fetch task with immediate AI analysis (no Slack notification) - Dynamic loading
   */
  async runThreeHourFetchTask() {
    if (this.isTaskRunning) {
      console.log('⚠️ 3-hour fetch task skipped - another task is already running');
      return;
    }

    console.log('🕒 Starting 3-hour Reddit fetch and analysis task... [IMMEDIATE MODE]');
    this.isTaskRunning = true;
    
    try {
      // Load services dynamically
      const { RealisticRedditFetcher } = await import('./reddit_fetcher.js');
      const { OneTimeAnalysis } = await import('./ai_analyzer.js');
      
      // Step 1: Fetch new posts from Reddit using realistic fetcher
      console.log('📡 Fetching new posts from Reddit...');
      const fetcher = new RealisticRedditFetcher();
      await fetcher.fetchRecentData();
      console.log('✅ Reddit fetch completed successfully');
      
      // Step 2: Immediately analyze all unanalyzed content
      console.log('🤖 Starting AI analysis of all unanalyzed content...');
      const analysis = new OneTimeAnalysis();
      await analysis.run();
      console.log('✅ AI analysis completed successfully');
      
      console.log('✅ 3-hour fetch and analysis task completed successfully');
    } catch (error) {
      console.error('❌ 3-hour fetch and analysis task failed:', error);
    } finally {
      this.isTaskRunning = false;
    }
  }

  // Daily update task removed - realistic fetch now handles all updates including comments

      // AI analysis is now included in the 3-hour fetch task

  /**
   * Run daily task (with Slack notifications to all configured channels) - EXACT SAME CODE
   */
  async runDailyTask() {
    if (this.isTaskRunning) {
      console.log('⚠️ Daily task skipped - another task is already running');
      return;
    }

    console.log('🌅 Starting daily KPI report task... [IMMEDIATE MODE]');
    this.isTaskRunning = true;
    
    try {
      // Load services dynamically
      await this.loadServices();
      
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
          
          // Create channel-specific Slack service - Dynamic loading
          const { default: SlackService } = await import('./slack.js');
          const channelSlack = new SlackService(channel.channel_id);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('daily', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'daily');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'daily',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            immediate_mode: true
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
    } finally {
      this.isTaskRunning = false;
    }
  }

  /**
   * Run weekly task (KPI report to all enabled channels) - EXACT SAME CODE
   */
  async runWeeklyTask() {
    if (this.isTaskRunning) {
      console.log('⚠️ Weekly task skipped - another task is already running');
      return;
    }

    console.log('📅 Starting weekly KPI report task... [IMMEDIATE MODE]');
    this.isTaskRunning = true;
    
    try {
      // Load services dynamically
      await this.loadServices();
      
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
          
          // Create channel-specific Slack service - Dynamic loading
          const { default: SlackService } = await import('./slack.js');
          const channelSlack = new SlackService(channel.channel_id);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('weekly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'weekly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'weekly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            immediate_mode: true
          });
          
          console.log(`✅ Weekly report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send weekly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('✅ Weekly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Weekly task failed:', error);
    } finally {
      this.isTaskRunning = false;
    }
  }

  /**
   * Run monthly task (KPI report to all enabled channels) - EXACT SAME CODE
   */
  async runMonthlyTask() {
    if (this.isTaskRunning) {
      console.log('⚠️ Monthly task skipped - another task is already running');
      return;
    }

    console.log('📊 Starting monthly KPI report task... [IMMEDIATE MODE]');
    this.isTaskRunning = true;
    
    try {
      // Load services dynamically
      await this.loadServices();
      
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
          
          // Create channel-specific Slack service - Dynamic loading
          const { default: SlackService } = await import('./slack.js');
          const channelSlack = new SlackService(channel.channel_id);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('monthly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'monthly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'monthly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            immediate_mode: true
          });
          
          console.log(`✅ Monthly report sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send monthly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('✅ Monthly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Monthly task failed:', error);
    } finally {
      this.isTaskRunning = false;
    }
  }

  /**
   * 🎯 Run quarterly task (KPI report to all enabled channels) - EXACT SAME CODE
   */
  async runQuarterlyTask() {
    if (this.isTaskRunning) {
      console.log('⚠️ Quarterly task skipped - another task is already running');
      return;
    }

    console.log('🎯 Starting quarterly KPI report task... [IMMEDIATE MODE]');
    this.isTaskRunning = true;
    
    try {
      // Load services dynamically
      await this.loadServices();
      
      // Get all channels that should receive quarterly reports
      const channels = await this.channelConfig.getChannelsForScheduledReport('quarterly');
      
      if (channels.length === 0) {
        console.log('📭 No channels configured for quarterly reports');
        return;
      }

      console.log(`🎯 Sending quarterly reports to ${channels.length} channels`);
      
      // Send to each configured channel with channel-specific report
      for (const channel of channels) {
        try {
          console.log(`🎯 Sending quarterly report to channel: ${channel.channel_name} (${channel.report_name})`);
          
          // Create channel-specific Slack service - Dynamic loading
          const { default: SlackService } = await import('./slack.js');
          const channelSlack = new SlackService(channel.channel_id);
          
          // Generate channel-specific report with categories if specified
          const report = await this.reportCreator.generateReport('quarterly', null, null, 'console', false, channel.categories);
          
          // Convert ReportCreator format to Slack format and send
          await this.sendReportCreatorToSlack(channelSlack, report, 'quarterly');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(channel.channel_id, 'system', 'scheduled_report_sent', {
            report_type: 'quarterly',
            report_name: channel.report_name,
            channel_name: channel.channel_name,
            categories: channel.categories,
            immediate_mode: true
          });
          
          console.log(`✅ QUARTERLY REPORT sent to ${channel.channel_name} (${channel.report_name})`);
          
        } catch (channelError) {
          console.error(`❌ Failed to send quarterly report to ${channel.channel_name}:`, channelError);
        }
      }
      
      console.log('🎯 Quarterly KPI task completed successfully');
      
    } catch (error) {
      console.error('❌ Quarterly task failed:', error);
    } finally {
      this.isTaskRunning = false;
    }
  }

  /**
   * Send ReportCreator format report to Slack - EXACT SAME CODE
   */
  async sendReportCreatorToSlack(channelSlack, report, reportType) {
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
      
      // Add immediate mode indicator
      title += ' - IMMEDIATE MODE';
      
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
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Period:*\n${new Date(report.timeRange.start).toLocaleDateString()} - ${new Date(report.timeRange.end).toLocaleDateString()}`
              },
              {
                type: 'mrkdwn',
                text: `*Total Posts:*\n${report.summary.total_posts}`
              },
              {
                type: 'mrkdwn',
                text: `*FACEIT Posts:*\n${report.summary.faceit_posts} (${Math.round(report.summary.faceit_posts / report.summary.total_posts * 100)}%)`
              },
              {
                type: 'mrkdwn',
                text: `*Help Requests:*\n${report.summary.help_posts}`
              }
            ]
          }
        ]
      };

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

      // Add sentiment distribution
      if (report.sentiments && report.sentiments.length > 0) {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*😊 Sentiment Distribution:*'
          }
        });
        
        slackMessage.blocks.push({
          type: 'section',
          fields: report.sentiments.map(sentiment => ({
            type: 'mrkdwn',
            text: `*${sentiment.sentiment.toUpperCase()}:* ${sentiment.count} (${sentiment.percentage}%)`
          }))
        });
      }

      // Add top categories
      if (report.categories && report.categories.length > 0) {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🏷️ Categories:*'
          }
        });
        
        slackMessage.blocks.push({
          type: 'section',
          fields: report.categories.slice(0, 6).map(category => ({
            type: 'mrkdwn',
            text: `*${category.category.replace('_', ' ').toUpperCase()}:* ${category.count} (${category.percentage}%)`
          }))
        });
      }

      // Add top post (reduced to 1) - remove duplicate header
      if (report.topPosts && report.topPosts.length > 0) {
        const post = report.topPosts[0];
        const engagement = post.score + (post.num_comments * 2);
        const date = new Date(post.created_utc * 1000).toLocaleDateString();
        
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🔥 TOP ENGAGED POST:*\n"${post.title.substring(0, 80)}${post.title.length > 80 ? '...' : ''}"\n` +
                  `📊 Score: ${post.score} | 💬 Comments: ${post.num_comments} | 🔥 Engagement: ${engagement}\n` +
                  `🏷️ ${post.category} | 😊 ${post.sentiment} | 📅 ${date} | 👤 ${post.author}`
          }
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
            },
            {
              type: 'mrkdwn',
              text: `*Engagement:*\nAvg Score: ${Math.round(report.commentAnalysis.avgCommentScore)}\nDiscussion: ${report.commentAnalysis.discussionComments}`
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
          
          const intentText = mostEngagedComment.intent ? ` | Intent: ${mostEngagedComment.intent}` : '';
          
          slackMessage.blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `> "${mostEngagedComment.body}"\n_- u/${mostEngagedComment.author} (Score: ${mostEngagedComment.score})${intentText}_`
            }
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

      // Add immediate mode notice for quarterly reports
      if (reportType === 'quarterly') {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚡ *IMMEDIATE MODE ACTIVE*\nThis is your REAL quarterly report working perfectly!\nThe production scheduler will send this same report on:\n• Jan 1 at 23:30 UTC\n• Apr 1 at 23:30 UTC\n• Jul 1 at 23:30 UTC\n• Oct 1 at 23:30 UTC`
          }
        });
      }

      // Post to Slack
      await channelSlack.postMessage(slackMessage);
      
    } catch (error) {
      console.error('❌ Failed to send ReportCreator report to Slack:', error);
      throw error;
    }
  }

  /**
   * Run a specific task manually (for testing) - EXACT SAME CODE
   */
  async runTaskManually(taskType) {
    console.log(`🔧 Running ${taskType} task manually...`);
    
    switch (taskType.toLowerCase()) {
      case 'threehour_fetch':
      case 'threehour':
        await this.runThreeHourFetchTask();
        break;
      // daily_update task removed - realistic fetch handles all updates
      // AI analysis is now included in threehour_fetch task
      case 'daily':
        await this.runDailyTask();
        break;
      case 'weekly':
        await this.runWeeklyTask();
        break;
      case 'monthly':
        await this.runMonthlyTask();
        break;
      case 'quarterly':
        await this.runQuarterlyTask();
        break;
      default:
        throw new Error(`Unknown task type: ${taskType}. Available: threehour_fetch, daily, weekly, monthly, quarterly`);
    }
  }

  /**
   * Get scheduler status - EXACT SAME CODE
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isTaskRunning: this.isTaskRunning,
      timezone: process.env.TZ,
      activeTasks: Array.from(this.tasks.keys()),
      nextRuns: this.getNextRunTimes(),
      mode: 'immediate'
    };
  }

  /**
   * Get next run times for all tasks - EXACT SAME CODE
   */
  getNextRunTimes() {
    const nextRuns = {};
    
    // Calculate next run times (simplified - in a real implementation you'd use a proper cron parser)
    const now = new Date();
    
    // Daily: next 23:59
    const nextDaily = new Date(now);
    nextDaily.setHours(23, 59, 0, 0);
    if (nextDaily <= now) {
      nextDaily.setDate(nextDaily.getDate() + 1);
    }
    nextRuns.daily = nextDaily.toISOString();
    
    // Weekly: next Sunday 23:59
    const nextWeekly = new Date(now);
    nextWeekly.setHours(23, 59, 0, 0);
    const daysUntilSunday = (7 - nextWeekly.getDay()) % 7 || 7;
    nextWeekly.setDate(nextWeekly.getDate() + daysUntilSunday);
    nextRuns.weekly = nextWeekly.toISOString();
    
    return nextRuns;
  }

  /**
   * Health check for all services - EXACT SAME CODE
   */
  async healthCheck() {
    try {
      const [slackHealth, dbHealth] = await Promise.all([
        this.slack.healthCheck(),
        // Add other health checks as needed
      ]);

      return {
        status: 'healthy',
        scheduler: {
          isRunning: this.isRunning,
          isTaskRunning: this.isTaskRunning,
          activeTasks: this.tasks.size
        },
        services: {
          slack: slackHealth,
          // Add other service health checks
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }
}

// Handle graceful shutdown - EXACT SAME CODE
const gracefulShutdown = async (scheduler) => {
  console.log('🛑 Received shutdown signal, stopping scheduler...');
  
  if (scheduler) {
    scheduler.stop();
    try {
      await scheduler.loadServices();
      const channels = await scheduler.channelConfig.getChannelsForScheduledReport('daily');
      for (const channel of channels) {
        try {
          // Stop notification removed - only reports will be sent
        } catch (error) {
          console.error('Error sending shutdown notification:', error.message);
        }
      }
    } catch (error) {
      console.error('Error during shutdown notifications:', error.message);
    }
  }
  
  await closeDb();
  console.log('👋 Graceful shutdown completed');
  process.exit(0);
};

// Main execution - EXACT SAME CODE
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('immediate_scheduler.js')) {
  const scheduler = new ImmediateScheduleService();
  
  // Handle unhandled rejections to prevent process exit
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process - just log the error
  });
  
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Don't exit the process - just log the error
  });
  
  // Handle shutdown signals
  process.on('SIGINT', () => gracefulShutdown(scheduler));
  process.on('SIGTERM', () => gracefulShutdown(scheduler));
  
  // Start the scheduler
  try {
    await scheduler.start();
    console.log('⚡ IMMEDIATE scheduler is running. Quarterly reports every 6 minutes!');
    console.log('🎯 Press Ctrl+C to stop.');
    
    // Keep the process alive with heartbeat
    const heartbeatInterval = setInterval(() => {
      try {
        console.log(`💓 Immediate scheduler heartbeat - Status: ${scheduler.isRunning ? 'Running' : 'Stopped'}`);
      } catch (error) {
        console.error('❌ Heartbeat error:', error.message);
      }
    }, 2 * 60 * 1000);
    
    // Ensure process doesn't exit
    process.on('beforeExit', (code) => {
      console.log('⚠️ Process about to exit with code:', code);
      if (code === 0 && scheduler.isRunning) {
        console.log('🔄 Preventing unexpected exit...');
        setTimeout(() => {
          console.log('💓 Scheduler still running...');
        }, 1000);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start immediate scheduler:', error);
    process.exit(1);
  }
}

export default ImmediateScheduleService;