import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';
import { SlackCommands } from './slack_commands.js';
import ChannelConfigService from './channel_config_service.js';

dotenv.config();

/**
 * Slack Bot for Reddit FACEIT App
 * Handles slash commands and interactive messages
 */
class SlackBot {
  constructor() {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: true,
      appToken: process.env.SLACK_APP_TOKEN,
      processBeforeResponse: false, // CRITICAL: prevent dispatch_failed
      logLevel: process.env.SLACK_LOG_LEVEL || 'info',
      // WebSocket connection improvements
      clientPingTimeout: parseInt(process.env.SLACK_PING_TIMEOUT) || 10000, // Increase ping timeout to 10 seconds
      autoReconnectEnabled: true, // Enable automatic reconnection
      clientOptions: {
        // Additional WebSocket options for better stability
        pingInterval: parseInt(process.env.SLACK_PING_INTERVAL) || 30000, // Send ping every 30 seconds
        pingTimeout: parseInt(process.env.SLACK_PING_TIMEOUT) || 10000, // Wait 10 seconds for pong response
        reconnectInterval: parseInt(process.env.SLACK_RECONNECT_INTERVAL) || 5000, // Reconnect after 5 seconds on failure
        maxReconnectAttempts: parseInt(process.env.SLACK_MAX_RECONNECT_ATTEMPTS) || 10 // Maximum reconnection attempts
      }
    });

    this.commands = new SlackCommands();
    this.channelConfig = new ChannelConfigService();
    
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for the Slack bot
   */
  setupEventHandlers() {
    // DIAGNOSTIC: Ping command for testing ACK speed
    this.app.command('/ping', async ({ ack, respond, logger }) => {
      const t0 = Date.now();
      try {
        await ack();
        const ackTime = Date.now() - t0;
        logger.info(`ACK in ${ackTime}ms`);
      } catch (e) {
        logger.error('ACK failed', e);
      }
    });

    // Handle /report slash command
    this.app.command('/report', async ({ command, ack, respond, logger }) => {
      const t0 = Date.now();
      try {
        // 1) IMMEDIATELY ACK
        await ack();
        const ackTime = Date.now() - t0;
        logger.info(`/report ACK in ${ackTime}ms`);
        
        // 2) Quick feedback (ephemeral)
        await respond({ text: "📊 Generating report...", response_type: "ephemeral" });

        // 3) Move heavy work to background
        setImmediate(async () => {
          try {
            console.log(`📱 Received /report command: "${command.text}" from ${command.user_name} in ${command.channel_name}`);
          
          // Check if channel is configured
          const channelConfig = await this.channelConfig.getChannelConfig(command.channel_id);
          
          if (!channelConfig) {
            await respond({
              text: `❌ Channel not configured. Use \`/setup\` to configure this channel first.`,
              response_type: 'ephemeral'
            });
            return;
          }

          // Get channel-specific report preferences
          const reportPrefs = await this.channelConfig.getChannelReportPreferences(command.channel_id, 'manual');
          
          // Log the activity
          await this.channelConfig.logChannelActivity(command.channel_id, command.user_id, 'manual_report_requested', {
            command_text: command.text,
            user_name: command.user_name
          });
          
          const result = await this.commands.handleReportCommand(
            command.text, 
            command.user_id, 
            command.channel_id,
            reportPrefs
          );
          
          if (result) {
            const response = {
              response_type: 'in_channel'
            };
            
            if (result.text) {
              response.text = result.text;
            }
            
            if (result.blocks) {
              response.blocks = result.blocks;
            }
            
            await respond(response);
          }
          // Report generated successfully - no additional message needed
            
          } catch (error) {
            console.error('❌ Error handling /report command:', error);
            await respond({
              text: `❌ Error generating report: ${error.message}`,
              response_type: 'ephemeral'
            });
          }
        });
      } catch (e) {
        logger.error('/report ACK failed', e);
      }
    });

    // Handle /help command
    this.app.command('/help', async ({ command, ack, respond }) => {
      // 1) IMMEDIATELY ACK
      await ack();
      
      // 2) Quick feedback (ephemeral)
      await respond({ text: "📚 Loading help information...", response_type: "ephemeral" });

      // 3) Move work to background
      setImmediate(async () => {
        const helpText = `🤖 Reddit FACEIT App Help\n\n` +
          `Available Commands:\n` +
          `• \`/report <period> [categories]\` - Generate analysis reports\n` +
          `• \`/setup\` - Configure this channel\n` +
          `• \`/config\` - View/modify channel configuration\n` +
          `• \`/help\` - Show this help message\n\n` +
          `Report Examples:\n` +
          `• \`/report daily\` - Today's posts\n` +
          `• \`/report weekly cheating\` - Cheating posts this week\n` +
          `• \`/report monthly verification 2fa\` - Verification issues this month\n\n` +
          `Configuration Examples:\n` +
          `• \`/config enable daily\` - Enable daily reports\n` +
          `• \`/config add-daily cheating cheaters smurfs\` - Add daily cheating report\n` +
          `• \`/config remove-daily cheating\` - Remove daily cheating report\n` +
          `• \`/config help\` - Detailed configuration help\n\n` +
          `Periods: daily, weekly, monthly, quarterly, yearly\n\n` +
          `Categories: account_recovery, verification, 2fa, matchmaking_issues, game_registration_issues, afk_leaver_bans, griefing, verbal_abuse, smurfs, cheaters, anti_cheat, subscriptions, faceit_shop, technical_client, platform_website, steam_issues_game_update, tournaments_leagues, esea, mission, moderation_community, feature_request, track_stats, ow2, dota2, legal_issues_gdpr, other`;

        await respond({
          text: helpText,
          response_type: 'ephemeral'
        });
      });
    });

    // Handle /setup command
    this.app.command('/setup', async ({ command, ack, respond }) => {
      // 1) IMMEDIATELY ACK
      await ack();
      
      // 2) Quick feedback (ephemeral)
      await respond({ text: "🛠️ Setting up channel...", response_type: "ephemeral" });

      // 3) Move heavy work to background
      setImmediate(async () => {
        try {
          console.log(`📱 Received /setup command from ${command.user_name} in ${command.channel_name}`);
          
          // Register the channel
          await this.channelConfig.registerChannel(
            command.channel_id,
            command.channel_name,
            command.team_id,
            command.user_id
          );

          const setupText = `🎉 Channel Setup Complete!\n\n` +
            `Channel: #${command.channel_name}\n` +
            `Admin: <@${command.user_id}>\n\n` +
            `What's configured:\n` +
            `• ✅ All report types enabled (daily, weekly, monthly, quarterly)\n` +
            `• ✅ Scheduled reports will be sent here\n` +
            `• ✅ Manual reports work with \`/report\` command\n` +
            `• ✅ Error notifications enabled\n\n` +
            `Next steps:\n` +
            `• Use \`/config\` to view current settings\n` +
            `• Use \`/report daily\` to test report generation\n` +
            `• Use \`/config add-daily cheating\` to add multiple daily reports`;

          await respond({
            text: setupText,
            response_type: 'in_channel'
          });

        } catch (error) {
          console.error('❌ Error handling /setup command:', error);
          await respond({
            text: `❌ Setup failed: ${error.message}`,
            response_type: 'ephemeral'
          });
        }
      });
    });

    // Handle /config command
    this.app.command('/config', async ({ command, ack, respond }) => {
      // 1) IMMEDIATELY ACK
      await ack();
      
      // 2) Quick feedback (ephemeral)
      await respond({ text: "⚙️ Loading configuration...", response_type: "ephemeral" });

      // 3) Move heavy work to background
      setImmediate(async () => {
        try {
          console.log(`📱 Received /config command from ${command.user_name}`);
          
          const channelConfig = await this.channelConfig.getChannelConfig(command.channel_id);
        
        if (!channelConfig) {
          await respond({
            text: `❌ Channel not configured. Use \`/setup\` to configure this channel first.`,
            response_type: 'ephemeral'
          });
          return;
        }

        // Check if user is admin
        const userPermission = await this.channelConfig.isChannelAdmin(command.channel_id, command.user_id);
        if (!userPermission) {
          await respond({
            text: `❌ Only channel admins can view/modify configuration.`,
            response_type: 'ephemeral'
          });
          return;
        }

        const args = command.text.trim().split(/\s+/);
        const subcommand = args[0]?.toLowerCase();

        if (!subcommand || subcommand === 'view') {
          // Show current configuration
          const reportPrefs = await this.channelConfig.getChannelReportPreferences(command.channel_id);
          const stats = await this.channelConfig.getChannelStats(command.channel_id);

          let configText = `⚙️ Channel Configuration\n\n` +
            `Channel: #${channelConfig.channel_name}\n` +
            `Status: ${channelConfig.is_active ? '✅ Active' : '❌ Inactive'}\n` +
            `Enabled Reports: ${stats.enabled_reports}\n` +
            `Enabled Notifications: ${stats.enabled_notifications}\n` +
            `Admins: ${stats.admin_count}\n` +
            `Weekly Activity: ${stats.weekly_activity} actions\n\n`;

          configText += `Report Settings:\n`;
          reportPrefs.forEach(pref => {
            const categories = pref.categories.length > 0 ? `Filtered: ${pref.categories.join(', ')}` : 'All categories (no filter)';
            const reportName = pref.report_name === 'default' ? '' : ` (${pref.report_name})`;
            configText += `• ${pref.report_type.toUpperCase()}${reportName}: ${pref.enabled ? '✅' : '❌'} (${categories})\n`;
          });

          configText += `\nConfiguration Commands:\n` +
            `• \`/config help\` - Show all configuration options\n` +
            `• \`/config add-daily cheating\` - Add daily cheating report\n` +
            `• \`/config remove-daily cheating\` - Remove daily cheating report\n` +
            `• \`/config enable daily\` - Enable default daily reports\n` +
            `• \`/config disable weekly\` - Disable default weekly reports`;

          await respond({
            text: configText,
            response_type: 'ephemeral'
          });

        } else if (subcommand === 'help') {
          // Show help for configuration commands
          const helpText = `🔧 Configuration Commands Help\n\n` +
            `Report Management:\n` +
            `• \`/config enable <report_type>\` - Enable default report type\n` +
            `• \`/config disable <report_type>\` - Disable default report type\n` +
            `• \`/config add-<report_type> <name> <category1> <category2>\` - Add new report\n` +
            `• \`/config remove-<report_type> <name>\` - Remove custom report\n` +
            `• \`/config categories <report_type> <category1> <category2>\` - Set default categories\n` +
            `• \`/config categories <report_type> clear\` - Remove default filters\n\n` +
            `Report Types: daily, weekly, monthly, quarterly, manual\n\n` +
            `Available Categories:\n` +
            `account_recovery, verification, 2fa, matchmaking_issues, game_registration_issues, afk_leaver_bans, griefing, verbal_abuse, smurfs, cheaters, anti_cheat, subscriptions, faceit_shop, technical_client, platform_website, steam_issues_game_update, tournaments_leagues, esea, mission, moderation_community, feature_request, track_stats, ow2, dota2, legal_issues_gdpr, other\n\n` +
            `Examples:\n` +
            `• \`/config enable daily\`\n` +
            `• \`/config add-daily cheating cheaters smurfs anti_cheat\`\n` +
            `• \`/config add-daily technical technical_client platform_website\`\n` +
            `• \`/config remove-daily cheating\`\n` +
            `• \`/config categories daily clear\`\n` +
            `• \`/config view\` - Show current configuration`;

          await respond({
            text: helpText,
            response_type: 'ephemeral'
          });

        } else if (subcommand === 'enable' || subcommand === 'disable') {
          // Enable/disable report types
          const reportType = args[1]?.toLowerCase();
          const validTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'manual'];
          
          if (!reportType || !validTypes.includes(reportType)) {
            await respond({
              text: `❌ Invalid report type. Use: ${validTypes.join(', ')}`,
              response_type: 'ephemeral'
            });
            return;
          }

          const enabled = subcommand === 'enable';
          await this.channelConfig.updateReportPreferences(command.channel_id, reportType, { enabled });
          
          await this.channelConfig.logChannelActivity(command.channel_id, command.user_id, 'config_updated', {
            action: `${subcommand}_${reportType}`,
            user_name: command.user_name
          });

          await respond({
            text: `✅ ${reportType.toUpperCase()} reports ${enabled ? 'enabled' : 'disabled'} for this channel.`,
            response_type: 'ephemeral'
          });

        } else if (subcommand === 'categories') {
          // Set categories for a report type
          const reportType = args[1]?.toLowerCase();
          const categories = args.slice(2).map(cat => cat.toLowerCase());
          const validTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'manual'];
          const validCategories = [
            'account_recovery', 'verification', '2fa', 'matchmaking_issues', 'game_registration_issues',
            'afk_leaver_bans', 'griefing', 'verbal_abuse', 'smurfs', 'cheaters', 'anti_cheat',
            'subscriptions', 'faceit_shop', 'technical_client', 'platform_website', 'steam_issues_game_update',
            'tournaments_leagues', 'esea', 'mission', 'moderation_community', 'feature_request',
            'track_stats', 'ow2', 'dota2', 'legal_issues_gdpr', 'other'
          ];

          if (!reportType || !validTypes.includes(reportType)) {
            await respond({
              text: `❌ Invalid report type. Use: ${validTypes.join(', ')}`,
              response_type: 'ephemeral'
            });
            return;
          }

          // Special case: "clear" to remove category filtering
          if (categories.length === 1 && categories[0] === 'clear') {
            await this.channelConfig.updateReportPreferences(command.channel_id, reportType, { categories: [] });
            
            await this.channelConfig.logChannelActivity(command.channel_id, command.user_id, 'config_updated', {
              action: `clear_categories_${reportType}`,
              user_name: command.user_name
            });

            await respond({
              text: `✅ ${reportType.toUpperCase()} reports will now show ALL categories (no filtering).`,
              response_type: 'ephemeral'
            });
            return;
          }

          if (categories.length === 0) {
            await respond({
              text: `❌ Please specify categories or use 'clear' to remove filtering.\nExample: \`/config categories daily cheaters smurfs\` or \`/config categories daily clear\``,
              response_type: 'ephemeral'
            });
            return;
          }

          // Validate categories
          const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
          if (invalidCategories.length > 0) {
            await respond({
              text: `❌ Invalid categories: ${invalidCategories.join(', ')}\nValid categories: ${validCategories.join(', ')}`,
              response_type: 'ephemeral'
            });
            return;
          }

          await this.channelConfig.updateReportPreferences(command.channel_id, reportType, { categories });
          
          await this.channelConfig.logChannelActivity(command.channel_id, command.user_id, 'config_updated', {
            action: `set_categories_${reportType}`,
            categories: categories,
            user_name: command.user_name
          });

          await respond({
            text: `✅ ${reportType.toUpperCase()} reports will now filter for: ${categories.join(', ')}`,
            response_type: 'ephemeral'
          });

        } else if (subcommand.startsWith('add-')) {
          // Add new report configuration
          const reportType = subcommand.replace('add-', '');
          const validTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'manual'];
          
          if (!validTypes.includes(reportType)) {
            await respond({
              text: `❌ Invalid report type. Use: ${validTypes.join(', ')}`,
              response_type: 'ephemeral'
            });
            return;
          }

          const reportName = args[1];
          const categories = args.slice(2).map(cat => cat.toLowerCase());
          const validCategories = [
            'account_recovery', 'verification', '2fa', 'matchmaking_issues', 'game_registration_issues',
            'afk_leaver_bans', 'griefing', 'verbal_abuse', 'smurfs', 'cheaters', 'anti_cheat',
            'subscriptions', 'faceit_shop', 'technical_client', 'platform_website', 'steam_issues_game_update',
            'tournaments_leagues', 'esea', 'mission', 'moderation_community', 'feature_request',
            'track_stats', 'ow2', 'dota2', 'legal_issues_gdpr', 'other'
          ];

          if (!reportName) {
            await respond({
              text: `❌ Please specify a name for the report.\nExample: \`/config add-daily cheating cheaters smurfs\``,
              response_type: 'ephemeral'
            });
            return;
          }

          if (categories.length === 0) {
            await respond({
              text: `❌ Please specify at least one category.\nExample: \`/config add-daily cheating cheaters smurfs\``,
              response_type: 'ephemeral'
            });
            return;
          }

          // Validate categories
          const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
          if (invalidCategories.length > 0) {
            await respond({
              text: `❌ Invalid categories: ${invalidCategories.join(', ')}\nValid categories: ${validCategories.join(', ')}`,
              response_type: 'ephemeral'
            });
            return;
          }

          await this.channelConfig.addReportConfiguration(command.channel_id, reportType, reportName, { categories });
          
          await this.channelConfig.logChannelActivity(command.channel_id, command.user_id, 'config_updated', {
            action: `add_${reportType}_${reportName}`,
            categories: categories,
            user_name: command.user_name
          });

          await respond({
            text: `✅ Added ${reportType.toUpperCase()} report '${reportName}' with categories: ${categories.join(', ')}`,
            response_type: 'ephemeral'
          });

        } else if (subcommand.startsWith('remove-')) {
          // Remove report configuration
          const reportType = subcommand.replace('remove-', '');
          const validTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'manual'];
          
          if (!validTypes.includes(reportType)) {
            await respond({
              text: `❌ Invalid report type. Use: ${validTypes.join(', ')}`,
              response_type: 'ephemeral'
            });
            return;
          }

          const reportName = args[1];

          if (!reportName) {
            await respond({
              text: `❌ Please specify the name of the report to remove.\nExample: \`/config remove-daily cheating\``,
              response_type: 'ephemeral'
            });
            return;
          }

          await this.channelConfig.removeReportConfiguration(command.channel_id, reportType, reportName);
          
          await this.channelConfig.logChannelActivity(command.channel_id, command.user_id, 'config_updated', {
            action: `remove_${reportType}_${reportName}`,
            user_name: command.user_name
          });

          await respond({
            text: `✅ Removed ${reportType.toUpperCase()} report '${reportName}'`,
            response_type: 'ephemeral'
          });

        } else {
          await respond({
            text: `❌ Unknown subcommand: ${subcommand}\nUse \`/config help\` for available options.`,
            response_type: 'ephemeral'
          });
        }
        } catch (error) {
          console.error('❌ Error handling /config command:', error);
          await respond({
            text: `❌ Configuration error: ${error.message}`,
            response_type: 'ephemeral'
          });
        }
      });
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, say }) => {
      try {
        const text = event.text.toLowerCase();
        
        if (text.includes('help') || text.includes('commands')) {
          await say({
            text: `🤖 **Reddit FACEIT App Commands**\n\n` +
                  `Use \`/report <period> [categories]\` to generate reports\n` +
                  `Use \`/help\` for detailed help\n\n` +
                  `Example: \`/report daily cheating verification\``,
            thread_ts: event.ts
          });
        } else if (text.includes('status')) {
          await say({
            text: `🤖 **Reddit FACEIT App Status**\n\n` +
                  `✅ Bot is online and ready\n` +
                  `📊 Report generation: Available\n` +
                  `🔍 Category filtering: Available\n` +
                  `⏰ Automated schedules: Running`,
            thread_ts: event.ts
          });
        } else {
          await say({
            text: `🤖 Hi! I'm the Reddit FACEIT App analysis bot.\n\n` +
                  `Use \`/report <period> [categories]\` to generate reports\n` +
                  `Use \`/help\` for more information`,
            thread_ts: event.ts
          });
        }
        
      } catch (error) {
        console.error('❌ Error handling mention:', error);
        await say({
          text: `❌ Sorry, I encountered an error: ${error.message}`,
          thread_ts: event.ts
        });
      }
    });

    // Handle errors
    this.app.error((error) => {
      console.error('❌ Slack app error:', error);
    });

    // Note: WebSocket connection events will be set up in start() method
    // after the app is initialized
  }

  /**
   * Start the Slack bot
   */
  async start() {
    try {
      console.log('🚀 Starting Slack bot...');
      console.log('📡 Bot Token:', process.env.SLACK_BOT_TOKEN ? 'Set' : 'Missing');
      console.log('🔐 Signing Secret:', process.env.SLACK_SIGNING_SECRET ? 'Set' : 'Missing');
      console.log('🔌 App Token:', process.env.SLACK_APP_TOKEN ? 'Set' : 'Missing');
      console.log('⚙️ WebSocket Configuration:');
      console.log(`  • Ping Timeout: ${parseInt(process.env.SLACK_PING_TIMEOUT) || 10000}ms`);
      console.log('  • Auto Reconnect: Enabled');
      console.log(`  • Ping Interval: ${parseInt(process.env.SLACK_PING_INTERVAL) || 30000}ms`);
      console.log(`  • Reconnect Interval: ${parseInt(process.env.SLACK_RECONNECT_INTERVAL) || 5000}ms`);
      console.log(`  • Max Reconnect Attempts: ${parseInt(process.env.SLACK_MAX_RECONNECT_ATTEMPTS) || 10}`);
      
      await this.app.start();
      console.log('🤖 Reddit FACEIT App Slack bot started successfully!');
      console.log('📱 Available commands:');
      console.log('  • /report <period> [categories] - Generate analysis reports');
      console.log('  • /help - Show help information');
      console.log('  • @Reddit FACEIT App - Mention the bot for status/help');
      console.log('⏰ Bot is now listening for events...');
      
      // Set up WebSocket connection events after app is started
      this.setupSocketModeEvents();
      
      // Start connection health monitoring
      this.startConnectionMonitoring();
      
    } catch (error) {
      console.error('❌ Failed to start Slack bot:', error);
      throw error;
    }
  }

  /**
   * Setup WebSocket connection event handlers
   */
  setupSocketModeEvents() {
    try {
      // Check if socketMode is available
      if (!this.app.client || !this.app.client.socketMode) {
        console.warn('⚠️ SocketMode not available, skipping WebSocket event setup');
        return;
      }

      const socketMode = this.app.client.socketMode;

      // Handle WebSocket connection events
      socketMode.on('disconnect', () => {
        console.log('🔌 WebSocket disconnected, attempting to reconnect...');
      });

      socketMode.on('reconnect', () => {
        console.log('✅ WebSocket reconnected successfully');
      });

      socketMode.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
      });

      // Handle connection state changes
      socketMode.on('connecting', () => {
        console.log('🔄 WebSocket connecting...');
      });

      socketMode.on('connected', () => {
        console.log('✅ WebSocket connected successfully');
      });

      console.log('🔌 WebSocket event handlers configured');
    } catch (error) {
      console.error('❌ Error setting up WebSocket events:', error);
    }
  }

  /**
   * Monitor WebSocket connection health
   */
  startConnectionMonitoring() {
    // Check connection status every 5 minutes
    this.connectionMonitorInterval = setInterval(() => {
      try {
        if (!this.app.client || !this.app.client.socketMode) {
          console.log('🔍 Connection Status: SocketMode not available');
          return;
        }

        const socketMode = this.app.client.socketMode;
        const isConnected = socketMode.isConnected();
        const connectionState = socketMode.getState();
        console.log(`🔍 Connection Status: ${isConnected ? 'Connected' : 'Disconnected'} (State: ${connectionState})`);
        
        if (!isConnected) {
          console.log('⚠️ WebSocket disconnected, attempting manual reconnection...');
          socketMode.connect();
        }
      } catch (error) {
        console.error('❌ Error monitoring connection:', error);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Stop the Slack bot
   */
  async stop() {
    try {
      // Clear connection monitoring interval
      if (this.connectionMonitorInterval) {
        clearInterval(this.connectionMonitorInterval);
        console.log('🛑 Connection monitoring stopped');
      }
      
      await this.app.stop();
      console.log('🤖 Reddit FACEIT App Slack bot stopped');
    } catch (error) {
      console.error('❌ Error stopping Slack bot:', error);
    }
  }
}

// CLI Interface
async function runSlackBot() {
  console.log('🔧 Initializing Slack bot...');
  const bot = new SlackBot();
  
  try {
    console.log('🚀 Starting bot...');
    await bot.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🛑 Received SIGINT, shutting down Slack bot...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('🛑 Received SIGTERM, shutting down Slack bot...');
      await bot.stop();
      process.exit(0);
    });
    
    console.log('✅ Bot initialization completed, keeping process alive...');
    
  } catch (error) {
    console.error('❌ Failed to run Slack bot:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('slack_bot.js')) {
  runSlackBot()
    .then(() => {
      console.log('✅ Slack bot script completed successfully');
    })
    .catch((error) => {
      console.error('❌ Slack bot script failed:', error);
      process.exit(1);
    });
}

export { SlackBot };
