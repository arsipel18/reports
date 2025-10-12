import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Multi-Channel Configuration Service
 * Manages channel-specific settings and preferences
 */
class ChannelConfigService {
  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
    });
  }

  /**
   * Initialize channel configuration tables
   */
  async initializeTables() {
    try {
      console.log('🔧 Initializing channel configuration tables...');
      
      // Read and execute the SQL schema
      const fs = await import('fs');
      const path = await import('path');
      const sqlPath = path.join(process.cwd(), 'src', 'channel_config.sql');
      const sql = fs.readFileSync(sqlPath, 'utf8');
      
      await this.pool.query(sql);
      console.log('✅ Channel configuration tables initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize channel tables:', error);
      throw error;
    }
  }

  /**
   * Register a new channel
   */
  async registerChannel(channelId, channelName, workspaceId, userId) {
    try {
      console.log(`📱 Registering channel: ${channelName} (${channelId})`);
      
      // Insert channel config
      await this.pool.query(`
        INSERT INTO channel_configs (channel_id, channel_name, workspace_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (channel_id) DO UPDATE SET
          channel_name = EXCLUDED.channel_name,
          workspace_id = EXCLUDED.workspace_id,
          updated_at = CURRENT_TIMESTAMP
      `, [channelId, channelName, workspaceId]);

      // Insert default report preferences
      const reportTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'manual'];
      for (const reportType of reportTypes) {
        await this.pool.query(`
          INSERT INTO channel_report_preferences (channel_id, report_type, report_name, enabled, categories)
          VALUES ($1, $2, 'default', true, ARRAY[]::TEXT[])
          ON CONFLICT (channel_id, report_type, report_name) DO NOTHING
        `, [channelId, reportType]);
      }

      // Insert default notification settings
      const notificationTypes = ['scheduled_reports', 'manual_reports', 'errors', 'status_updates'];
      for (const notificationType of notificationTypes) {
        await this.pool.query(`
          INSERT INTO channel_notifications (channel_id, notification_type, enabled)
          VALUES ($1, $2, true)
          ON CONFLICT (channel_id, notification_type) DO NOTHING
        `, [channelId, notificationType]);
      }

      // Add the user as admin
      await this.addChannelAdmin(channelId, userId, 'admin');

      // Log the activity
      await this.logChannelActivity(channelId, userId, 'bot_added', {
        channel_name: channelName,
        workspace_id: workspaceId
      });

      console.log(`✅ Channel ${channelName} registered successfully`);
      return true;

    } catch (error) {
      console.error('❌ Failed to register channel:', error);
      throw error;
    }
  }

  /**
   * Get channel configuration
   */
  async getChannelConfig(channelId) {
    try {
      const result = await this.pool.query(`
        SELECT cc.*, 
               array_agg(crp.report_type) as enabled_reports,
               array_agg(cn.notification_type) as enabled_notifications
        FROM channel_configs cc
        LEFT JOIN channel_report_preferences crp ON cc.channel_id = crp.channel_id AND crp.enabled = true
        LEFT JOIN channel_notifications cn ON cc.channel_id = cn.channel_id AND cn.enabled = true
        WHERE cc.channel_id = $1 AND cc.is_active = true
        GROUP BY cc.id, cc.channel_id, cc.channel_name, cc.workspace_id, cc.is_active, cc.created_at, cc.updated_at
      `, [channelId]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Failed to get channel config:', error);
      throw error;
    }
  }

  /**
   * Get channel report preferences
   */
  async getChannelReportPreferences(channelId, reportType = null) {
    try {
      let query = `
        SELECT * FROM channel_report_preferences 
        WHERE channel_id = $1 AND enabled = true
      `;
      let params = [channelId];

      if (reportType) {
        query += ` AND report_type = $2`;
        params.push(reportType);
      }

      const result = await this.pool.query(query, params);
      return reportType ? result.rows[0] : result.rows;
    } catch (error) {
      console.error('❌ Failed to get report preferences:', error);
      throw error;
    }
  }

  /**
   * Update channel report preferences
   */
  async updateReportPreferences(channelId, reportType, preferences, reportName = 'default') {
    try {
      const {
        enabled = true,
        categories = [],
        exclude_categories = [],
        min_score = 0,
        min_comments = 0
      } = preferences;

      await this.pool.query(`
        INSERT INTO channel_report_preferences 
        (channel_id, report_type, report_name, enabled, categories, exclude_categories, min_score, min_comments)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (channel_id, report_type, report_name) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          categories = EXCLUDED.categories,
          exclude_categories = EXCLUDED.exclude_categories,
          min_score = EXCLUDED.min_score,
          min_comments = EXCLUDED.min_comments,
          updated_at = CURRENT_TIMESTAMP
      `, [channelId, reportType, reportName, enabled, categories, exclude_categories, min_score, min_comments]);

      console.log(`✅ Updated ${reportType} (${reportName}) preferences for channel ${channelId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to update report preferences:', error);
      throw error;
    }
  }

  /**
   * Add a new report configuration
   */
  async addReportConfiguration(channelId, reportType, reportName, preferences) {
    try {
      const {
        enabled = true,
        categories = [],
        exclude_categories = [],
        min_score = 0,
        min_comments = 0
      } = preferences;

      await this.pool.query(`
        INSERT INTO channel_report_preferences 
        (channel_id, report_type, report_name, enabled, categories, exclude_categories, min_score, min_comments)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (channel_id, report_type, report_name) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          categories = EXCLUDED.categories,
          exclude_categories = EXCLUDED.exclude_categories,
          min_score = EXCLUDED.min_score,
          min_comments = EXCLUDED.min_comments,
          updated_at = CURRENT_TIMESTAMP
      `, [channelId, reportType, reportName, enabled, categories, exclude_categories, min_score, min_comments]);

      console.log(`✅ Added ${reportType} (${reportName}) configuration for channel ${channelId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to add report configuration:', error);
      throw error;
    }
  }

  /**
   * Remove a report configuration
   */
  async removeReportConfiguration(channelId, reportType, reportName) {
    try {
      if (reportName === 'default') {
        throw new Error('Cannot remove default report configuration');
      }

      const result = await this.pool.query(`
        DELETE FROM channel_report_preferences 
        WHERE channel_id = $1 AND report_type = $2 AND report_name = $3
      `, [channelId, reportType, reportName]);

      if (result.rowCount === 0) {
        throw new Error(`Report configuration '${reportName}' not found for ${reportType}`);
      }

      console.log(`✅ Removed ${reportType} (${reportName}) configuration for channel ${channelId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to remove report configuration:', error);
      throw error;
    }
  }

  /**
   * Get all active channels
   */
  async getActiveChannels() {
    try {
      const result = await this.pool.query(`
        SELECT * FROM channel_configs WHERE is_active = true ORDER BY created_at DESC
      `);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get active channels:', error);
      throw error;
    }
  }

  /**
   * Get channels that should receive scheduled reports
   */
  async getChannelsForScheduledReport(reportType) {
    try {
      const result = await this.pool.query(`
        SELECT cc.*, crp.report_name, crp.categories, crp.exclude_categories, crp.min_score, crp.min_comments
        FROM channel_configs cc
        JOIN channel_report_preferences crp ON cc.channel_id = crp.channel_id
        JOIN channel_notifications cn ON cc.channel_id = cn.channel_id
        WHERE cc.is_active = true 
          AND crp.report_type = $1 
          AND crp.enabled = true
          AND cn.notification_type = 'scheduled_reports'
          AND cn.enabled = true
        ORDER BY cc.channel_id, crp.report_name
      `, [reportType]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get channels for scheduled report:', error);
      throw error;
    }
  }

  /**
   * Add channel admin
   */
  async addChannelAdmin(channelId, userId, userName, permissionLevel = 'admin') {
    try {
      await this.pool.query(`
        INSERT INTO channel_admins (channel_id, user_id, user_name, permission_level)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (channel_id, user_id) DO UPDATE SET
          permission_level = EXCLUDED.permission_level,
          user_name = EXCLUDED.user_name
      `, [channelId, userId, userName, permissionLevel]);

      console.log(`✅ Added admin ${userName} to channel ${channelId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to add channel admin:', error);
      throw error;
    }
  }

  /**
   * Check if user is channel admin
   */
  async isChannelAdmin(channelId, userId) {
    try {
      const result = await this.pool.query(`
        SELECT permission_level FROM channel_admins 
        WHERE channel_id = $1 AND user_id = $2
      `, [channelId, userId]);

      return result.rows[0]?.permission_level || null;
    } catch (error) {
      console.error('❌ Failed to check admin status:', error);
      return null;
    }
  }

  /**
   * Log channel activity
   */
  async logChannelActivity(channelId, userId, action, details = null) {
    try {
      await this.pool.query(`
        INSERT INTO channel_activity_log (channel_id, user_id, action, details)
        VALUES ($1, $2, $3, $4)
      `, [channelId, userId, action, details ? JSON.stringify(details) : null]);
    } catch (error) {
      console.error('❌ Failed to log channel activity:', error);
    }
  }

  /**
   * Deactivate channel
   */
  async deactivateChannel(channelId, userId) {
    try {
      await this.pool.query(`
        UPDATE channel_configs SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE channel_id = $1
      `, [channelId]);

      await this.logChannelActivity(channelId, userId, 'bot_removed');
      console.log(`✅ Channel ${channelId} deactivated`);
      return true;
    } catch (error) {
      console.error('❌ Failed to deactivate channel:', error);
      throw error;
    }
  }

  /**
   * Get channel statistics
   */
  async getChannelStats(channelId) {
    try {
      const result = await this.pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM channel_report_preferences WHERE channel_id = $1 AND enabled = true) as enabled_reports,
          (SELECT COUNT(*) FROM channel_notifications WHERE channel_id = $1 AND enabled = true) as enabled_notifications,
          (SELECT COUNT(*) FROM channel_admins WHERE channel_id = $1) as admin_count,
          (SELECT COUNT(*) FROM channel_activity_log WHERE channel_id = $1 AND created_at > NOW() - INTERVAL '7 days') as weekly_activity
      `, [channelId]);

      return result.rows[0];
    } catch (error) {
      console.error('❌ Failed to get channel stats:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

export default ChannelConfigService;
