import dotenv from 'dotenv';
import { ReportCreator } from './report_creator.js';
import { closeDb } from './db.js';
import { postReportAsPNG, postReportWithRetry } from './send-to-slack.js';

dotenv.config();

/**
 * Slack Commands Handler for Reddit FACEIT App
 * Handles report generation commands with category filtering
 */
class SlackCommands {
  constructor() {
    this.reportCreator = new ReportCreator();
    this.validPeriods = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
    this.validCategories = [
      'account_recovery',
      'verification', 
      '2fa',
      'matchmaking_issues',
      'game_registration_issues',
      'afk_leaver_bans',
      'griefing',
      'verbal_abuse',
      'smurfs',
      'cheaters',
      'anti_cheat',
      'subscriptions',
      'faceit_shop',
      'technical_client',
      'platform_website',
      'steam_issues_game_update',
      'tournaments_leagues',
      'esea',
      'mission',
      'moderation_community',
      'feature_request',
      'track_stats',
      'ow2',
      'dota2',
      'legal_issues_gdpr',
      'other'
    ];
  }

  /**
   * Handle report command from Slack
   * @param {string} command - The command text
   * @param {string} userId - User who sent the command
   * @param {string} channelId - Channel where command was sent
   * @param {Object} channelPrefs - Channel-specific preferences
   */
  async handleReportCommand(command, userId, channelId, channelPrefs = null) {
    try {
      console.log(`📱 Handling report command: "${command}" from user ${userId}`);
      
      // Parse the command
      const parsed = this.parseReportCommand(command);
      
      if (parsed.error) {
        return this.sendHelpMessage(parsed.error);
      }

      // Generate the report with category filtering
      const report = await this.generateFilteredReport(parsed.period, parsed.categories, channelPrefs, parsed.dateParam);
      
      // Post PNG data visualization first, then detailed text reports
      await this.postReportWithVisualization(report, parsed.period, parsed.categories, channelId);
      
      const dateInfo = parsed.dateParam ? ` (${parsed.dateParam})` : '';
      console.log(`✅ PNG report generated successfully for ${parsed.period}${dateInfo}${parsed.categories.length > 0 ? ` with categories: ${parsed.categories.join(', ')}` : ''}`);
      
    } catch (error) {
      console.error('❌ Report command failed:', error);
      // Error message removed - only reports will be sent
      return { text: 'Report generation failed. Check console for details.' };
    } finally {
      await closeDb();
    }
  }

  /**
   * Parse report command
   * @param {string} command - Command text
   * @returns {Object} Parsed command or error
   */
  parseReportCommand(command) {
    const parts = command.toLowerCase().trim().split(/\s+/);
    
    if (parts.length < 1) {
      return { error: 'Usage: `/report <period> [date] [categories]`\nExample: `/report daily cheating verification`' };
    }

    const period = parts[0];
    let dateParam = null;
    let categories = [];

    // Check if second parameter is a date parameter
    if (parts.length > 1) {
      const secondParam = parts[1];
      
      // Check if it's a date parameter (year, quarter, or month format)
      if (this.isDateParameter(secondParam)) {
        dateParam = secondParam;
        categories = parts.slice(2);
      } else {
        categories = parts.slice(1);
      }
    }

    // Validate period
    if (!this.validPeriods.includes(period)) {
      return { 
        error: `Invalid period: ${period}\nValid periods: ${this.validPeriods.join(', ')}` 
      };
    }

    // Validate date parameter for specific periods
    if (dateParam && !['yearly', 'quarterly', 'monthly'].includes(period)) {
      return { 
        error: `Date parameters are only supported for yearly, quarterly, and monthly reports` 
      };
    }

    // Validate date format
    if (dateParam && !this.validateDateParameter(period, dateParam)) {
      return { 
        error: this.getDateParameterError(period) 
      };
    }

    // Validate categories
    const invalidCategories = categories.filter(cat => !this.validCategories.includes(cat));
    if (invalidCategories.length > 0) {
      return { 
        error: `Invalid categories: ${invalidCategories.join(', ')}\nValid categories: ${this.validCategories.join(', ')}` 
      };
    }

    return { period, dateParam, categories };
  }

  /**
   * Check if a parameter is a date parameter
   */
  isDateParameter(param) {
    // Check for year format (e.g., "2024")
    if (/^\d{4}$/.test(param)) return true;
    
    // Check for quarter format (e.g., "1-2025", "2-2024")
    if (/^[1-4]-\d{4}$/.test(param)) return true;
    
    // Check for month format (e.g., "05-2025", "12-2024")
    if (/^(0[1-9]|1[0-2])-\d{4}$/.test(param)) return true;
    
    return false;
  }

  /**
   * Validate date parameter format
   */
  validateDateParameter(period, dateParam) {
    switch (period) {
      case 'yearly':
        return /^\d{4}$/.test(dateParam);
      case 'quarterly':
        return /^[1-4]-\d{4}$/.test(dateParam);
      case 'monthly':
        return /^(0[1-9]|1[0-2])-\d{4}$/.test(dateParam);
      default:
        return false;
    }
  }

  /**
   * Get error message for invalid date parameter
   */
  getDateParameterError(period) {
    switch (period) {
      case 'yearly':
        return 'Invalid year format. Use: YYYY (e.g., 2024)';
      case 'quarterly':
        return 'Invalid quarter format. Use: Q-YYYY (e.g., 1-2025, 2-2024)';
      case 'monthly':
        return 'Invalid month format. Use: MM-YYYY (e.g., 05-2025, 12-2024)';
      default:
        return 'Invalid date parameter';
    }
  }

  /**
   * Generate report with category filtering
   * @param {string} period - Time period
   * @param {Array} categories - Categories to filter by
   * @param {Object} channelPrefs - Channel-specific preferences
   * @param {string} dateParam - Optional date parameter for custom periods
   * @returns {Object} Filtered report
   */
  async generateFilteredReport(period, categories, channelPrefs = null, dateParam = null) {
    let startDate = null;
    let endDate = null;

    // Calculate custom date range if dateParam is provided
    if (dateParam) {
      const dateRange = this.calculateCustomDateRange(period, dateParam);
      startDate = dateRange.start;
      endDate = dateRange.end;
    } else {
      // For manual commands without dateParam, use current period (not previous)
      const currentDateRange = this.calculateCurrentDateRange(period);
      startDate = new Date(currentDateRange.start * 1000);
      endDate = new Date(currentDateRange.end * 1000);
    }

    // Get the report with category filtering applied at the database level
    const report = await this.reportCreator.generateReport(period, startDate, endDate, 'console', false, categories);
    
    return report;
  }

  /**
   * Calculate current date range for manual commands (not previous period)
   */
  calculateCurrentDateRange(period) {
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    
    let startTimestamp;
    let endTimestamp;
    
    switch (period) {
      case 'daily':
        startTimestamp = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate())).getTime() / 1000);
        endTimestamp = nowTimestamp;
        break;
      case 'weekly':
        const daysSinceMonday = (now.getDay() + 6) % 7;
        const monday = new Date(now.getTime() - (daysSinceMonday * 24 * 60 * 60 * 1000));
        startTimestamp = Math.floor((new Date(monday.getFullYear(), monday.getMonth(), monday.getDate())).getTime() / 1000);
        endTimestamp = nowTimestamp;
        break;
      case 'monthly':
        // Current month
        const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        endTimestamp = nowTimestamp;
        startTimestamp = Math.floor(currentMonth.getTime() / 1000);
        break;
      case 'quarterly':
        // Current quarter
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const currentQuarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
        startTimestamp = Math.floor(currentQuarterStart.getTime() / 1000);
        endTimestamp = nowTimestamp;
        break;
      case 'yearly':
        // Current year
        const currentYearStart = new Date(now.getFullYear(), 0, 1);
        startTimestamp = Math.floor(currentYearStart.getTime() / 1000);
        endTimestamp = nowTimestamp;
        break;
      default:
        throw new Error(`Unknown period: ${period}`);
    }
    
    return { start: startTimestamp, end: endTimestamp };
  }

  /**
   * Calculate custom date range based on period and date parameter
   */
  calculateCustomDateRange(period, dateParam) {
    switch (period) {
      case 'yearly':
        const yearlyYear = parseInt(dateParam);
        return {
          start: new Date(yearlyYear, 0, 1), // January 1st
          end: new Date(yearlyYear, 11, 31, 23, 59, 59) // December 31st
        };
        
      case 'quarterly':
        const [quarter, quarterlyYear] = dateParam.split('-').map(Number);
        const quarterStartMonth = (quarter - 1) * 3; // 0, 3, 6, 9
        const quarterEndMonth = quarterStartMonth + 2; // 2, 5, 8, 11
        return {
          start: new Date(quarterlyYear, quarterStartMonth, 1),
          end: new Date(quarterlyYear, quarterEndMonth + 1, 0, 23, 59, 59) // Last day of quarter
        };
        
      case 'monthly':
        const [month, monthlyYear] = dateParam.split('-').map(Number);
        return {
          start: new Date(monthlyYear, month - 1, 1), // month is 1-based, Date is 0-based
          end: new Date(monthlyYear, month, 0, 23, 59, 59) // Last day of month
        };
        
      default:
        return { start: null, end: null };
    }
  }


  /**
   * Post report with PNG data visualization attached to the main text message
   * @param {Object} report - Report data from ReportCreator
   * @param {string} period - Report period
   * @param {Array} categories - Filtered categories
   * @param {string} channelId - Slack channel ID
   */
  async postReportWithVisualization(report, period, categories, channelId) {
    try {
      console.log(`🎨 Generating comprehensive report for ${period} period...`);
      
      // Send detailed text-based report with PNG attached
      console.log(`📝 Sending text report with PNG attachment...`);
      await this.postFilteredReportToSlackWithPNG(report, period, categories, channelId);
      console.log(`✅ Comprehensive report sent with PNG attachment`);
      
    } catch (error) {
      console.error('❌ Failed to post comprehensive report:', error);
      
      // If everything fails, try just the text-based report as final fallback
      console.log('🔄 Final fallback: sending text-based report only...');
      await this.postFilteredReportToSlack(report, period, categories, channelId);
      
      throw error;
    }
  }

  /**
   * Post report as PNG image to Slack (standalone method)
   * @param {Object} report - Report data from ReportCreator
   * @param {string} period - Report period
   * @param {Array} categories - Filtered categories
   * @param {string} channelId - Slack channel ID
   */
  async postReportAsPNG(report, period, categories, channelId) {
    try {
      console.log(`🎨 Generating PNG report for ${period} period...`);
      
      // Use the new PNG posting functionality
      const result = await postReportWithRetry(report, channelId, {
        period: period,
        categories: categories,
        maxRetries: 2
      });
      
      console.log(`✅ PNG report posted successfully to channel ${channelId}`);
      return result;
      
    } catch (error) {
      console.error('❌ Failed to post PNG report:', error);
      throw error;
    }
  }

  /**
   * Post filtered report to Slack with PNG attachment
   * @param {Object} report - Report data from ReportCreator
   * @param {string} period - Report period
   * @param {Array} categories - Filtered categories
   * @param {string} channelId - Slack channel ID
   */
  async postFilteredReportToSlackWithPNG(report, period, categories, channelId) {
    const periodEmoji = {
      daily: '📅',
      weekly: '📊', 
      monthly: '📈',
      quarterly: '🎯',
      yearly: '🏆'
    };

    const emoji = periodEmoji[period] || '📊';
    
    // Create title without categories
    let title = `${period.toUpperCase()} ANALYSIS REPORT`;
    
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
      console.log(`🎨 Generating PNG attachment...`);
      const { renderReportPNG } = await import('./report-image.js');
      const { adaptReportDataForPNG } = await import('./data-adapter.js');
      
      // Adapt report data for PNG renderer
      const adaptedData = adaptReportDataForPNG(report);
      console.log(`📊 Adapted data keys:`, Object.keys(adaptedData));
      const pngBuffer = await renderReportPNG(adaptedData);
      console.log(`📊 PNG buffer size:`, pngBuffer ? pngBuffer.length : 'null');
      
      // Use the new approach: upload PNG first, then post main message with attachment
      const { WebClient } = await import('@slack/web-api');
      const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
      
      const timestamp = new Date().toISOString().slice(0, 10);
      const categorySuffix = categories.length > 0 ? `-${categories.join('-')}` : '';
      const filename = `${period}-report-${timestamp}${categorySuffix}.png`;
      
      // Now post the main text message first
      const SlackService = (await import('./slack.js')).default;
      const channelSlack = new SlackService(channelId);
      const mainResponse = await channelSlack.postMessage(mainMessage);
      
      // Upload PNG to thread using files.uploadV2 (recommended by Slack)
      const uploadResult = await slack.files.uploadV2({
        channel_id: channelId,
        filename: filename,
        file: Buffer.from(pngBuffer), // Ensure it's a proper Buffer
        title: `${title} - Data Visualization`,
        thread_ts: mainResponse.ts
      });
      
      console.log(`📊 Upload result:`, JSON.stringify(uploadResult, null, 2));
      console.log(`✅ PNG uploaded to thread successfully! File ID: ${uploadResult.file?.id || uploadResult.id || 'N/A'}`);
      
      // Post detailed analysis as thread replies
      await this.postDetailedAnalysisAsThread(channelSlack, mainResponse.ts, report);
      
    } catch (pngError) {
      console.log(`⚠️  PNG attachment failed, sending text-only report: ${pngError.message}`);
      
      // Fallback to regular text report without PNG
      const SlackService = (await import('./slack.js')).default;
      const channelSlack = new SlackService(channelId);
      const mainResponse = await channelSlack.postMessage(mainMessage);
      
      // Post detailed analysis as thread replies
      await this.postDetailedAnalysisAsThread(channelSlack, mainResponse.ts, report);
    }
  }

  /**
   * Post filtered report to Slack with improved formatting
   */
  async postFilteredReportToSlack(report, period, categories, channelId) {
    const periodEmoji = {
      daily: '📅',
      weekly: '📊', 
      monthly: '📈',
      quarterly: '🎯',
      yearly: '🏆'
    };

    const emoji = periodEmoji[period] || '📊';
    
    // Create title without categories
    let title = `${period.toUpperCase()} ANALYSIS REPORT`;
    
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
    if (categories.length > 0) {
      mainMessage.blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `🔍 *Filtered Categories:* ${categories.map(c => c.replace('_', ' ')).join(', ')}`
          }
        ]
      });
    }

    // Post main message to Slack
    const SlackService = (await import('./slack.js')).default;
    const channelSlack = new SlackService(channelId);
    
    const mainResponse = await channelSlack.postMessage(mainMessage);
    
    // Post detailed analysis as thread replies
    await this.postDetailedAnalysisAsThread(channelSlack, mainResponse.ts, report);
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

        // Overall stats
        if (report.moderatorAnalysis && report.moderatorAnalysis.totalPosts > 0) {
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
   * Send help message
   */
  sendHelpMessage(error = null) {
    const blocks = [];
    
    // Add error message if provided
    if (error) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ ${error}`
        }
      });
    }
    
    // Main title
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📊 *Report Commands*'
      }
    });
    
    // Usage
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Usage: `/report <period> [date] [categories]`'
      }
    });
    
    // Periods
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Periods: ${this.validPeriods.join(', ')}`
      }
    });
    
    // Date Parameters as context block
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '*Date Parameters (for yearly, quarterly, monthly):*\n' +
                '• Yearly: YYYY (e.g., 2024)\n' +
                '• Quarterly: Q-YYYY (e.g., 1-2025, 2-2024)\n' +
                '• Monthly: MM-YYYY (e.g., 05-2025, 12-2024)'
        }
      ]
    });
    
    // Examples
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Examples:*\n' +
              '• `/report daily` - All posts from today\n' +
              '• `/report weekly cheating` - Cheating posts this week\n' +
              '• `/report monthly verification 2fa` - Verification & 2FA posts this month\n' +
              '• `/report quarterly technical_client` - Technical issues this quarter\n' +
              '• `/report yearly 2024` - All posts from 2024\n' +
              '• `/report quarterly 1-2025` - First quarter of 2025\n' +
              '• `/report monthly 05-2025` - May 2025\n' +
              '• `/report yearly 2024 cheating` - Cheating posts from 2024'
      }
    });
    
    // Available Categories as context block
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '*Available Categories:*\n' +
                '🔐 account_recovery, verification, 2fa\n' +
                '🎮 matchmaking_issues, game_registration_issues, afk_leaver_bans\n' +
                '🚫 griefing, verbal_abuse, smurfs, cheaters, anti_cheat\n' +
                '🛠️ technical_client, platform_website, steam_issues_game_update\n' +
                '💰 subscriptions, faceit_shop\n' +
                '🏆 tournaments_leagues, esea, mission, moderation_community\n' +
                '💡 feature_request, track_stats, ow2, dota2, legal_issues_gdpr, other'
        }
      ]
    });

    console.log(`📋 Help message blocks:`, JSON.stringify(blocks, null, 2));
    return { blocks };
  }

  /**
   * Send error message - removed to only send reports
   */
  sendErrorMessage(error) {
    console.log(`❌ Error occurred: ${error}`);
    return { text: 'Report generation failed. Check console for details.' };
  }
}

export { SlackCommands };
