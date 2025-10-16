import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';

dotenv.config();

class SlackService {
  constructor(channelId = null, reportName = null) {
    this.client = new WebClient(process.env.SLACK_BOT_TOKEN);
    this.channelId = channelId || process.env.SLACK_CHANNEL_ID;
    this.reportName = reportName;
    
    if (!process.env.SLACK_BOT_TOKEN) {
      throw new Error('SLACK_BOT_TOKEN is required');
    }
    if (!this.channelId) {
      throw new Error('SLACK_CHANNEL_ID is required');
    }
    
    console.log(`📱 Slack service initialized for channel: ${this.channelId}${reportName ? ` (${reportName})` : ''}`);
  }

  /**
   * Send KPI report to Slack using Block Kit
   * @param {Object} report - KPI report data
   * @returns {Object} - Slack API response
   */
  async sendReport(report) {
    try {
      console.log(`📤 Sending ${report.metadata.window} report to Slack...`);
      
      const blocks = this.buildReportBlocks(report);
      
      const result = await this.client.chat.postMessage({
        channel: this.channelId,
        blocks: blocks,
        text: `FACEIT ${this.capitalizeFirst(report.metadata.window)} KPI Report`, // Fallback text
        unfurl_links: false,
        unfurl_media: false
      });
      
      console.log('✅ Report sent to Slack successfully');
      return result;
      
    } catch (error) {
      console.error('❌ Failed to send report to Slack:', error);
      throw error;
    }
  }

  /**
   * Build Slack Block Kit blocks for the report
   */
  buildReportBlocks(report) {
    const blocks = [];
    const windowTitle = this.capitalizeFirst(report.metadata.window);
    
    // Header
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 FACEIT ${windowTitle} KPI Report`
      }
    });

    // Time period context
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📅 Period: ${this.formatDate(report.metadata.period.start)} - ${this.formatDate(report.metadata.period.end)}`
        }
      ]
    });

    // Volume metrics
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*📝 Posts:* ${report.volume.posts}`
        },
        {
          type: 'mrkdwn',
          text: `*💬 Comments:* ${report.volume.comments}`
        },
        {
          type: 'mrkdwn',
          text: `*👥 Unique Authors:* ${report.volume.uniqueAuthors}`
        },
        {
          type: 'mrkdwn',
          text: `*🎯 Engagement:* ${report.volume.posts + report.volume.comments} interactions`
        }
      ]
    });

    // Intent distribution
    if (report.intent.posts.length > 0) {
      const helpPosts = report.intent.posts.find(i => i.intent === 'help')?.count || 0;
      const totalPosts = report.intent.posts.reduce((sum, i) => sum + i.count, 0);
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🆘 Help Requests:* ${helpPosts}/${totalPosts} posts (${Math.round((helpPosts/totalPosts)*100)}%) were help requests`
        }
      });
    }

    // Sentiment analysis
    if (report.sentiment.posts.length > 0) {
      const sentimentText = this.buildSentimentText(report.sentiment.posts, 'Posts');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: sentimentText
        }
      });
    }

    if (report.sentiment.comments.length > 0) {
      const sentimentText = this.buildSentimentText(report.sentiment.comments, 'Comments');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: sentimentText
        }
      });
    }

    // Top departments
    if (report.departments.length > 0) {
      const topDepartments = report.departments.slice(0, 5);
      const deptText = topDepartments
        .map(dept => `• ${this.formatDepartment(dept.department)}: ${dept.count} (${dept.percentage}%)`)
        .join('\n');
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🏢 Top Issues by Department:*\n${deptText}`
        }
      });
    }

    // Divider
    blocks.push({ type: 'divider' });

    // Top post
    if (report.topPost) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🔥 Most Engaging Post:*\n*${this.truncateText(report.topPost.title, 100)}*\nBy u/${report.topPost.author} • Score: ${report.topPost.score} • Comments: ${report.topPost.numComments}`
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View on Reddit'
          },
          url: report.topPost.url,
          action_id: 'view_post'
        }
      });
    }

    // Enhanced comment analysis section
    if (report.commentAnalysis && report.commentAnalysis.totalComments > 0) {
      blocks.push({ type: 'divider' });
      
      const commentAnalysis = report.commentAnalysis;
      const posPercent = Math.round((commentAnalysis.positiveComments / commentAnalysis.totalComments) * 100);
      const negPercent = Math.round((commentAnalysis.negativeComments / commentAnalysis.totalComments) * 100);
      const helpPercent = Math.round((commentAnalysis.helpComments / commentAnalysis.totalComments) * 100);
      
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*💬 Comment Analysis:*\nTotal: ${commentAnalysis.totalComments}\nAuthors: ${commentAnalysis.uniqueCommentAuthors}`
          },
          {
            type: 'mrkdwn',
            text: `*📊 Sentiment:*\n😊 ${posPercent}% Positive\n😟 ${negPercent}% Negative\n📝 ${helpPercent}% Help Requests`
          },
          {
            type: 'mrkdwn',
            text: `*📈 Engagement:*\nAvg Score: ${Math.round(commentAnalysis.avgCommentScore)}\nDiscussion: ${commentAnalysis.discussionComments}`
          }
        ]
      });
    }

    // Single most engaged comment example
    if (report.examples.positive.length > 0 || report.examples.negative.length > 0 || report.examples.neutral?.length > 0) {
      blocks.push({ type: 'divider' });
      
      // Find the most engaged comment across all sentiments
      const allComments = [
        ...report.examples.positive,
        ...report.examples.negative,
        ...(report.examples.neutral || [])
      ];
      
      if (allComments.length > 0) {
        // Sort by score and take the highest
        const mostEngagedComment = allComments.sort((a, b) => b.score - a.score)[0];
        
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*💬 Most Engaged Comment:*'
          }
        });
        
        const intentText = mostEngagedComment.intent ? ` | Intent: ${mostEngagedComment.intent}` : '';
        
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `> "${this.truncateText(mostEngagedComment.body, 150)}"\n_- u/${mostEngagedComment.author} (Score: ${mostEngagedComment.score})${intentText}_`
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View'
            },
            url: mostEngagedComment.url,
            action_id: 'view_comment'
          }
        });
      }
    }

    // Key trends
    if (report.trends.length > 0) {
      blocks.push({ type: 'divider' });
      
      const trendsText = report.trends.slice(0, 3)
        .map(trend => `• ${trend.issue} (${trend.count} mentions)`)
        .join('\n');
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📈 Most Mentioned Issues:*\n${trendsText}`
        }
      });
    }

    // Footer with metadata
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🤖 Generated by FACEIT AI Analysis • Report ID: ${report.metadata.generatedAt.substring(0, 19)}`
        }
      ]
    });

    return blocks;
  }

  /**
   * Build sentiment text for posts or comments
   */
  buildSentimentText(sentimentData, type) {
    const total = sentimentData.reduce((sum, s) => sum + s.count, 0);
    if (total === 0) return `*😐 ${type} Sentiment:* No data available`;

    const pos = sentimentData.find(s => s.sentiment === 'pos')?.count || 0;
    const neg = sentimentData.find(s => s.sentiment === 'neg')?.count || 0;
    const neu = sentimentData.find(s => s.sentiment === 'neu')?.count || 0;

    const posPercent = Math.round((pos / total) * 100);
    const negPercent = Math.round((neg / total) * 100);
    const neuPercent = Math.round((neu / total) * 100);

    return `*😊 ${type} Sentiment:* ${posPercent}% Positive • ${negPercent}% Negative • ${neuPercent}% Neutral`;
  }

  /**
   * Send a simple status message
   */
  async sendStatusMessage(message, emoji = '📊') {
    console.log(`📤 Status message disabled - only reports will be sent: ${emoji} ${message}`);
    // Status messages removed - only reports will be sent
  }

  /**
   * Post a custom message with blocks to Slack
   */
  async postMessage(messageData) {
    try {
      const message = {
        channel: messageData.channel || this.channelId,
        text: messageData.text || 'Report',
        unfurl_links: false,
        unfurl_media: false
      };

      // Add blocks if provided
      if (messageData.blocks) {
        message.blocks = messageData.blocks;
      }

      // Add thread_ts if provided (for thread replies)
      if (messageData.thread_ts) {
        message.thread_ts = messageData.thread_ts;
      }

      const result = await this.client.chat.postMessage(message);
      return result;
    } catch (error) {
      console.error('❌ Failed to post message to Slack:', error);
      throw error;
    }
  }

  /**
   * Update an existing message (if message timestamp is provided)
   */
  async updateMessage(messageTs, blocks, text) {
    try {
      await this.client.chat.update({
        channel: this.channelId,
        ts: messageTs,
        blocks: blocks,
        text: text
      });
    } catch (error) {
      console.error('❌ Failed to update message:', error);
    }
  }

  /**
   * Send analysis progress update - disabled to only send reports
   */
  async sendProgressUpdate(status, details = '') {
    console.log(`📤 Progress update disabled - only reports will be sent: ${status}: ${details}`);
    // Progress updates removed - only reports will be sent
  }

  /**
   * Health check for Slack API
   */
  async healthCheck() {
    try {
      const result = await this.client.auth.test();
      return {
        status: 'healthy',
        botId: result.bot_id,
        userId: result.user_id,
        team: result.team,
        url: result.url
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Utility methods
  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  formatDepartment(dept) {
    return dept.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }
}

export default SlackService;
