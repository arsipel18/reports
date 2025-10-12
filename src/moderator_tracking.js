import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

/**
 * Moderator Response Tracking Service
 * Tracks moderator response times to Reddit posts
 */
class ModeratorTrackingService {
  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
    });

    this.subreddit = process.env.SUBREDDIT || 'FACEITcom';
    console.log(`🔧 Moderator tracking service initialized for r/${this.subreddit}`);
  }

  /**
   * Initialize moderator tracking tables
   */
  async initializeTables() {
    try {
      console.log('🏗️ Creating moderator tracking tables...');

      // Create moderator responses table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS moderator_responses (
          id SERIAL PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
          moderator_username TEXT NOT NULL,
          response_time_seconds INTEGER NOT NULL,
          post_created_utc BIGINT NOT NULL,
          comment_created_utc BIGINT NOT NULL,
          is_first_response BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(post_id, comment_id)
        )
      `);

      // Create moderator stats table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS moderator_stats (
          id SERIAL PRIMARY KEY,
          moderator_username TEXT NOT NULL,
          total_responses INTEGER DEFAULT 0,
          avg_response_time_seconds INTEGER DEFAULT 0,
          fastest_response_seconds INTEGER DEFAULT 0,
          slowest_response_seconds INTEGER DEFAULT 0,
          first_responses INTEGER DEFAULT 0,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(moderator_username)
        )
      `);

      // Create indexes for performance
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_moderator_responses_post_id 
        ON moderator_responses(post_id)
      `);
      
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_moderator_responses_moderator 
        ON moderator_responses(moderator_username)
      `);
      
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_moderator_responses_time 
        ON moderator_responses(response_time_seconds)
      `);

      console.log('✅ Moderator tracking tables created successfully');
      return true;

    } catch (error) {
      console.error('❌ Failed to create moderator tracking tables:', error);
      throw error;
    }
  }

  /**
   * Process comments and identify moderator responses
   */
  async processModeratorResponses(postId) {
    try {
      // Get all comments for this post
      const commentsResult = await this.pool.query(`
        SELECT c.*, p.created_utc as post_created_utc
        FROM comments c
        JOIN posts p ON c.post_id = p.id
        WHERE c.post_id = $1
        ORDER BY c.created_utc ASC
      `, [postId]);

      const comments = commentsResult.rows;
      
      if (comments.length === 0) {
        return;
      }

      const postCreatedUtc = comments[0].post_created_utc;
      const moderatorResponses = [];

      // Find moderator comments (distinguished = 'moderator')
      for (const comment of comments) {
        if (comment.distinguished === 'moderator') {
          const responseTimeSeconds = comment.created_utc - postCreatedUtc;
          
          // Check if this is the first moderator response
          const isFirstResponse = !moderatorResponses.some(response => 
            response.post_id === postId
          );

          moderatorResponses.push({
            post_id: postId,
            comment_id: comment.id,
            moderator_username: comment.author,
            response_time_seconds: responseTimeSeconds,
            post_created_utc: postCreatedUtc,
            comment_created_utc: comment.created_utc,
            is_first_response: isFirstResponse
          });
        }
      }

      // Save moderator responses
      for (const response of moderatorResponses) {
        await this.saveModeratorResponse(response);
      }

      if (moderatorResponses.length > 0) {
        console.log(`👮 Found ${moderatorResponses.length} moderator responses for post ${postId}`);
      }

      return moderatorResponses.length;

    } catch (error) {
      console.error(`❌ Error processing moderator responses for post ${postId}:`, error);
      return 0;
    }
  }

  /**
   * Save moderator response to database
   */
  async saveModeratorResponse(response) {
    try {
      const queryText = `
        INSERT INTO moderator_responses (
          post_id, comment_id, moderator_username, response_time_seconds,
          post_created_utc, comment_created_utc, is_first_response
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (post_id, comment_id) DO UPDATE SET
          response_time_seconds = EXCLUDED.response_time_seconds,
          is_first_response = EXCLUDED.is_first_response
      `;

      const values = [
        response.post_id,
        response.comment_id,
        response.moderator_username,
        response.response_time_seconds,
        response.post_created_utc,
        response.comment_created_utc,
        response.is_first_response
      ];

      await this.pool.query(queryText, values);

    } catch (error) {
      console.error('❌ Failed to save moderator response:', error);
      throw error;
    }
  }

  /**
   * Update moderator statistics
   */
  async updateModeratorStats() {
    try {
      console.log('📊 Updating moderator statistics...');

      // Get all moderator responses
      const responsesResult = await this.pool.query(`
        SELECT 
          moderator_username,
          COUNT(*) as total_responses,
          AVG(response_time_seconds) as avg_response_time,
          MIN(response_time_seconds) as fastest_response,
          MAX(response_time_seconds) as slowest_response,
          SUM(CASE WHEN is_first_response THEN 1 ELSE 0 END) as first_responses
        FROM moderator_responses
        GROUP BY moderator_username
      `);

      // Update moderator stats
      for (const stats of responsesResult.rows) {
        await this.pool.query(`
          INSERT INTO moderator_stats (
            moderator_username, total_responses, avg_response_time_seconds,
            fastest_response_seconds, slowest_response_seconds, first_responses
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (moderator_username) DO UPDATE SET
            total_responses = EXCLUDED.total_responses,
            avg_response_time_seconds = EXCLUDED.avg_response_time_seconds,
            fastest_response_seconds = EXCLUDED.fastest_response_seconds,
            slowest_response_seconds = EXCLUDED.slowest_response_seconds,
            first_responses = EXCLUDED.first_responses,
            last_updated = CURRENT_TIMESTAMP
        `, [
          stats.moderator_username,
          stats.total_responses,
          Math.round(stats.avg_response_time),
          stats.fastest_response,
          stats.slowest_response,
          stats.first_responses
        ]);
      }

      console.log(`✅ Updated stats for ${responsesResult.rows.length} moderators`);
      return responsesResult.rows.length;

    } catch (error) {
      console.error('❌ Failed to update moderator stats:', error);
      throw error;
    }
  }

  /**
   * Get moderator response statistics
   */
  async getModeratorStats() {
    try {
      const result = await this.pool.query(`
        SELECT 
          moderator_username,
          total_responses,
          avg_response_time_seconds,
          fastest_response_seconds,
          slowest_response_seconds,
          first_responses,
          last_updated
        FROM moderator_stats
        ORDER BY total_responses DESC
      `);

      return result.rows;

    } catch (error) {
      console.error('❌ Failed to get moderator stats:', error);
      throw error;
    }
  }

  /**
   * Get overall moderator response metrics
   */
  async getOverallModeratorMetrics() {
    try {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as total_responses,
          AVG(response_time_seconds) as avg_response_time,
          MIN(response_time_seconds) as fastest_response,
          MAX(response_time_seconds) as slowest_response,
          COUNT(DISTINCT moderator_username) as unique_moderators,
          COUNT(DISTINCT post_id) as posts_with_responses,
          SUM(CASE WHEN is_first_response THEN 1 ELSE 0 END) as first_responses
        FROM moderator_responses
      `);

      const metrics = result.rows[0];
      
      return {
        total_responses: parseInt(metrics.total_responses) || 0,
        avg_response_time_seconds: Math.round(metrics.avg_response_time) || 0,
        fastest_response_seconds: parseInt(metrics.fastest_response) || 0,
        slowest_response_seconds: parseInt(metrics.slowest_response) || 0,
        unique_moderators: parseInt(metrics.unique_moderators) || 0,
        posts_with_responses: parseInt(metrics.posts_with_responses) || 0,
        first_responses: parseInt(metrics.first_responses) || 0
      };

    } catch (error) {
      console.error('❌ Failed to get overall moderator metrics:', error);
      throw error;
    }
  }

  /**
   * Format time duration for display
   */
  formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    } else {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      return `${days}d ${hours}h`;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

export default ModeratorTrackingService;
