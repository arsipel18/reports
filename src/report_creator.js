import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';
import SlackService from './slack.js';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

class ReportCreator {
  constructor() {
    this.pool = null;
    this.slack = new SlackService();
  }

  async connect() {
    this.pool = await createDbConnection();
    console.log('✅ Connected to database');
  }

  async disconnect() {
    if (this.pool) {
      await closeDb();
      console.log('📴 Database connection closed');
    }
  }

  /**
   * Generate a comprehensive report for a specific time period
   * @param {string} period - 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', or 'custom'
   * @param {Date} startDate - Start date (for custom period)
   * @param {Date} endDate - End date (for custom period)
   * @param {string} outputFormat - 'console', 'json', 'csv'
   * @param {boolean} postToSlack - Whether to post the report to Slack
   * @param {Array} categories - Optional array of categories to filter by
   */
  async generateReport(period = 'daily', startDate = null, endDate = null, outputFormat = 'console', postToSlack = false, categories = []) {
    try {
      await this.connect();

      let timeRange;
      if (period === 'custom' || (startDate && endDate)) {
        if (!startDate || !endDate) {
          throw new Error('Custom period requires both startDate and endDate');
        }
        timeRange = {
          start: Math.floor(startDate.getTime() / 1000),
          end: Math.floor(endDate.getTime() / 1000)
        };
      } else {
        timeRange = this.getTimeRange(period);
      }

      console.log(`📊 Generating ${period} report...`);
      console.log(`📅 Period: ${new Date(timeRange.start * 1000).toLocaleString()} - ${new Date(timeRange.end * 1000).toLocaleString()}`);

      // Get all analyzed posts in the time range
      let posts = await this.getAnalyzedPosts(timeRange.start, timeRange.end);
      
      // Apply category filtering if specified
      if (categories && categories.length > 0) {
        posts = posts.filter(post => categories.includes(post.category));
        console.log(`🔍 Filtered to ${categories.length} categories: ${categories.join(', ')}`);
        console.log(`📊 Posts after filtering: ${posts.length}`);
      }
      
      // Get analysis summary (recalculated if filtered)
      const summary = await this.getAnalysisSummary(timeRange.start, timeRange.end, categories);
      
      // Get category distribution (filtered)
      const categoryDistribution = await this.getCategoryDistribution(timeRange.start, timeRange.end, categories);
      
      // Get sentiment distribution (filtered)
      const sentiments = await this.getSentimentDistribution(timeRange.start, timeRange.end, categories);
      
      // Get intent distribution (filtered)
      const intents = await this.getIntentDistribution(timeRange.start, timeRange.end, categories);
      
      // Get top posts by engagement (increased to 8 for PNG display)
      const topPosts = await this.getTopPosts(timeRange.start, timeRange.end, 8, categories);
      
      // Get top 2 engaged posts with their comments and moderator replies
      const top2EngagedPosts = await this.getTop2EngagedPostsWithComments(timeRange.start, timeRange.end, categories);
      
      // Get top 5 moderator commenters
      const top5ModeratorCommenters = await this.getTop5ModeratorCommenters(timeRange.start, timeRange.end, categories);
      
      // Get recent activity (filtered)
      const recentActivity = await this.getRecentActivity(timeRange.start, timeRange.end, categories);

      // Get enhanced comment analysis
      const commentAnalysis = await this.getCommentAnalysis(timeRange.start, timeRange.end, categories);
      
      // Get enhanced comment examples
      const commentExamples = await this.getCommentExamples(timeRange.start, timeRange.end, categories);

      // Get moderator response analysis
      const moderatorAnalysis = await this.getModeratorAnalysis(timeRange.start, timeRange.end, categories);

      const report = {
        period,
        timeRange: {
          start: new Date(timeRange.start * 1000).toISOString(),
          end: new Date(timeRange.end * 1000).toISOString()
        },
        summary,
        categories: categoryDistribution,
        sentiments,
        intents,
        topPosts,
        top2EngagedPosts,
        top5ModeratorCommenters,
        recentActivity,
        posts,
        commentAnalysis,
        commentExamples,
        moderatorAnalysis,
        filters: categories && categories.length > 0 ? { categories } : null
      };

      // Post to Slack if requested
      if (postToSlack) {
        await this.postReportToSlack(report);
      }

      // Output based on format
      switch (outputFormat) {
        case 'json':
          return this.outputJSON(report);
        case 'csv':
          return this.outputCSV(report);
        default:
          return this.outputConsole(report);
      }

    } catch (error) {
      console.error('❌ Report generation failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Get time range for different periods
   */
  getTimeRange(period) {
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
        // Previous month
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        startTimestamp = Math.floor(prevMonth.getTime() / 1000);
        endTimestamp = Math.floor(lastDayOfPrevMonth.getTime() / 1000);
        break;
      case 'quarterly':
        // Previous quarter
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
        const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const prevQuarterStart = new Date(prevQuarterYear, prevQuarter * 3, 1);
        const prevQuarterEnd = new Date(prevQuarterYear, (prevQuarter + 1) * 3, 0, 23, 59, 59);
        startTimestamp = Math.floor(prevQuarterStart.getTime() / 1000);
        endTimestamp = Math.floor(prevQuarterEnd.getTime() / 1000);
        break;
      case 'yearly':
        // Previous year
        const prevYear = now.getFullYear() - 1;
        const prevYearStart = new Date(prevYear, 0, 1);
        const prevYearEnd = new Date(prevYear, 11, 31, 23, 59, 59);
        startTimestamp = Math.floor(prevYearStart.getTime() / 1000);
        endTimestamp = Math.floor(prevYearEnd.getTime() / 1000);
        break;
      default:
        throw new Error(`Unknown period: ${period}`);
    }
    
    return { start: startTimestamp, end: endTimestamp };
  }

  /**
   * Get all analyzed posts in time range
   */
  async getAnalyzedPosts(startTime, endTime) {
    const queryText = `
      SELECT 
        p.id,
        p.title,
        p.body,
        p.author,
        p.created_utc,
        p.score,
        p.upvote_ratio,
        p.num_comments,
        p.permalink,
        p.link_flair_text,
        p.category,
        ap.intent,
        ap.target,
        ap.sentiment,
        ap.summary,
        ap.key_issues,
        ap.llm_model,
        ap.llm_tokens_in,
        ap.llm_tokens_out,
        ap.llm_cost_usd,
        ap.created_at as analyzed_at
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
      ORDER BY p.created_utc DESC
    `;
    
    const result = await query(queryText, [startTime, endTime]);
    return result.rows;
  }

  /**
   * Get analysis summary
   */
  async getAnalysisSummary(startTime, endTime, categories = null) {
    let queryText = `
      SELECT 
        COUNT(*) as total_posts,
        COUNT(CASE WHEN ap.target = 'faceit' THEN 1 END) as faceit_posts,
        COUNT(CASE WHEN ap.intent = 'help' THEN 1 END) as help_posts,
        COUNT(CASE WHEN ap.intent = 'comment' THEN 1 END) as comment_posts,
        COUNT(CASE WHEN ap.sentiment = 'pos' THEN 1 END) as positive_sentiment,
        COUNT(CASE WHEN ap.sentiment = 'neg' THEN 1 END) as negative_sentiment,
        COUNT(CASE WHEN ap.sentiment = 'neu' THEN 1 END) as neutral_sentiment,
        SUM(ap.llm_tokens_in) as total_input_tokens,
        SUM(ap.llm_tokens_out) as total_output_tokens,
        SUM(ap.llm_cost_usd) as total_cost_usd,
        AVG(p.score) as avg_score,
        AVG(p.num_comments) as avg_comments
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    const result = await query(queryText, params);
    return result.rows[0];
  }

  /**
   * Get category distribution
   */
  async getCategoryDistribution(startTime, endTime, categories = null) {
    let queryText = `
      SELECT 
        ap.category,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
      AND ap.category IS NOT NULL
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    queryText += ` GROUP BY ap.category ORDER BY count DESC`;
    
    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Get sentiment distribution
   */
  async getSentimentDistribution(startTime, endTime, categories = null) {
    let queryText = `
      SELECT 
        ap.sentiment,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    queryText += ` GROUP BY ap.sentiment ORDER BY count DESC`;
    
    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Get intent distribution
   */
  async getIntentDistribution(startTime, endTime, categories = null) {
    let queryText = `
      SELECT 
        ap.intent,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    queryText += ` GROUP BY ap.intent ORDER BY count DESC`;
    
    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Get top posts by engagement
   */
  async getTopPosts(startTime, endTime, limit = 10, categories = null) {
    let queryText = `
      SELECT 
        p.id,
        p.title,
        p.score,
        p.num_comments,
        p.author,
        p.created_utc,
        p.permalink,
        ap.category,
        ap.sentiment,
        ap.summary
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    queryText += ` ORDER BY (p.score + p.num_comments * 2) DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Get top 2 engaged posts with their top comments and moderator replies
   */
  async getTop2EngagedPostsWithComments(startTime, endTime, categories = null) {
    // First get top 2 posts
    const topPosts = await this.getTopPosts(startTime, endTime, 2, categories);
    
    const postsWithComments = [];
    
    for (const post of topPosts) {
      // Get top comments for this post
      const topComments = await this.getTopCommentsForPost(post.id, 3);
      
      // Get moderator replies for this post
      const moderatorReplies = await this.getModeratorRepliesForPost(post.id);
      
      postsWithComments.push({
        ...post,
        topComments,
        moderatorReplies,
        hasModeratorReply: moderatorReplies.length > 0
      });
    }
    
    return postsWithComments;
  }

  /**
   * Get top comments for a specific post
   */
  async getTopCommentsForPost(postId, limit = 3) {
    const queryText = `
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        c.created_utc,
        c.distinguished,
        ac.sentiment,
        ac.intent
      FROM comments c
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE c.post_id = $1
        AND LENGTH(c.body) > 10
        AND LENGTH(c.body) < 500
      ORDER BY c.score DESC
      LIMIT $2
    `;
    
    const result = await query(queryText, [postId, limit]);
    return result.rows.map(comment => ({
      ...comment,
      body: comment.body.length > 150 ? comment.body.substring(0, 147) + '...' : comment.body
    }));
  }

  /**
   * Get moderator replies for a specific post
   */
  async getModeratorRepliesForPost(postId) {
    const queryText = `
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        c.created_utc,
        c.distinguished,
        ac.sentiment,
        ac.intent,
        mr.response_time_seconds,
        mr.is_first_response
      FROM comments c
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      LEFT JOIN moderator_responses mr ON c.id = mr.comment_id
      WHERE c.post_id = $1
        AND c.distinguished = 'moderator'
      ORDER BY c.created_utc ASC
    `;
    
    const result = await query(queryText, [postId]);
    return result.rows.map(comment => ({
      ...comment,
      body: comment.body.length > 150 ? comment.body.substring(0, 147) + '...' : comment.body,
      responseTimeMinutes: comment.response_time_seconds ? Math.round(comment.response_time_seconds / 60) : null
    }));
  }

  /**
   * Get top 5 moderator commenters with their stats
   */
  async getTop5ModeratorCommenters(startTime, endTime, categories = null) {
    // First get the basic moderator stats
    let queryText = `
      SELECT 
        c.author as moderator_username,
        COUNT(DISTINCT c.post_id) as posts_handled,
        COUNT(c.id) as total_comments,
        AVG(c.score) as avg_comment_score,
        AVG(CASE WHEN ac.sentiment = 'pos' THEN 1 ELSE 0 END) as positive_sentiment_ratio,
        AVG(CASE WHEN ac.sentiment = 'neg' THEN 1 ELSE 0 END) as negative_sentiment_ratio,
        AVG(CASE WHEN ac.sentiment = 'neu' THEN 1 ELSE 0 END) as neutral_sentiment_ratio
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE c.distinguished = 'moderator'
        AND p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND EXISTS (
        SELECT 1 FROM analyses_post ap 
        WHERE ap.post_id = p.id 
        AND ap.category = ANY($3)
      )`;
      params.push(categories);
    }
    
    queryText += ` 
      GROUP BY c.author
      ORDER BY posts_handled DESC, total_comments DESC
      LIMIT 5
    `;
    
    const result = await query(queryText, params);
    
    // Now calculate response times separately for each moderator
    const moderatorsWithTimes = await Promise.all(
      result.rows.map(async (moderator) => {
        const responseTimeQuery = `
          SELECT AVG(mr.response_time_seconds) as avg_response_time_seconds
          FROM moderator_responses mr
          JOIN comments c ON mr.comment_id = c.id
          JOIN posts p ON mr.post_id = p.id
          WHERE c.author = $1
            AND c.distinguished = 'moderator'
            AND p.created_utc >= $2 AND p.created_utc <= $3
        `;
        
        const timeParams = [moderator.moderator_username, startTime, endTime];
        const timeResult = await query(responseTimeQuery, timeParams);
        const avgResponseTimeSeconds = parseFloat(timeResult.rows[0]?.avg_response_time_seconds) || null;
        
        return {
          ...moderator,
          avg_response_time_seconds: avgResponseTimeSeconds,
          avg_response_time_minutes: avgResponseTimeSeconds ? Math.round(avgResponseTimeSeconds / 60) : null,
          positive_sentiment_percentage: Math.round((moderator.positive_sentiment_ratio || 0) * 100),
          negative_sentiment_percentage: Math.round((moderator.negative_sentiment_ratio || 0) * 100),
          neutral_sentiment_percentage: Math.round((moderator.neutral_sentiment_ratio || 0) * 100)
        };
      })
    );
    
    return moderatorsWithTimes;
  }

  /**
   * Get enhanced comment analysis
   */
  async getCommentAnalysis(startTime, endTime, categories = null) {
    let queryText = `
      SELECT 
        COUNT(DISTINCT c.id) as total_comments,
        COUNT(DISTINCT CASE WHEN ac.sentiment = 'pos' THEN c.id END) as positive_comments,
        COUNT(DISTINCT CASE WHEN ac.sentiment = 'neg' THEN c.id END) as negative_comments,
        COUNT(DISTINCT CASE WHEN ac.sentiment = 'neu' THEN c.id END) as neutral_comments,
        COUNT(DISTINCT CASE WHEN ac.intent = 'help' THEN c.id END) as help_comments,
        COUNT(DISTINCT CASE WHEN ac.intent = 'comment' THEN c.id END) as discussion_comments,
        AVG(c.score) as avg_comment_score,
        COUNT(DISTINCT c.author) as unique_comment_authors
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      LEFT JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND EXISTS (
        SELECT 1 FROM analyses_post ap 
        WHERE ap.post_id = p.id 
        AND ap.category = ANY($3)
      )`;
      params.push(categories);
    }
    
    const result = await query(queryText, params);
    const row = result.rows[0];
    
    return {
      totalComments: parseInt(row.total_comments) || 0,
      positiveComments: parseInt(row.positive_comments) || 0,
      negativeComments: parseInt(row.negative_comments) || 0,
      neutralComments: parseInt(row.neutral_comments) || 0,
      helpComments: parseInt(row.help_comments) || 0,
      discussionComments: parseInt(row.discussion_comments) || 0,
      avgCommentScore: parseFloat(row.avg_comment_score) || 0,
      uniqueCommentAuthors: parseInt(row.unique_comment_authors) || 0
    };
  }

  /**
   * Get enhanced comment examples
   */
  async getCommentExamples(startTime, endTime, categories = null) {
    let baseQuery = `
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN analyses_comment ac ON c.id = ac.comment_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
        AND LENGTH(c.body) > 20
        AND LENGTH(c.body) < 300
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      baseQuery += ` AND EXISTS (
        SELECT 1 FROM analyses_post ap 
        WHERE ap.post_id = p.id 
        AND ap.category = ANY($3)
      )`;
      params.push(categories);
    }

    // Get positive examples
    const positiveResult = await query(`
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        p.permalink,
        p.title as post_title,
        ac.sentiment,
        ac.intent,
        ac.summary
      ${baseQuery}
        AND ac.sentiment = 'pos'
      ORDER BY c.score DESC
      LIMIT 5
    `, params);

    // Get negative examples
    const negativeResult = await query(`
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        p.permalink,
        p.title as post_title,
        ac.sentiment,
        ac.intent,
        ac.summary
      ${baseQuery}
        AND ac.sentiment = 'neg'
      ORDER BY c.score DESC
      LIMIT 5
    `, params);

    // Get neutral examples
    const neutralResult = await query(`
      SELECT 
        c.id,
        c.body,
        c.author,
        c.score,
        p.permalink,
        p.title as post_title,
        ac.sentiment,
        ac.intent,
        ac.summary
      ${baseQuery}
        AND ac.sentiment = 'neu'
      ORDER BY c.score DESC
      LIMIT 3
    `, params);

    return {
      positive: positiveResult.rows.map(this.formatCommentExample),
      negative: negativeResult.rows.map(this.formatCommentExample),
      neutral: neutralResult.rows.map(this.formatCommentExample)
    };
  }

  /**
   * Format comment example
   */
  formatCommentExample(comment) {
    return {
      id: comment.id,
      body: comment.body.length > 150 ? comment.body.substring(0, 147) + '...' : comment.body,
      author: comment.author,
      score: comment.score,
      postTitle: comment.post_title,
      url: `https://reddit.com${comment.permalink}`,
      sentiment: comment.sentiment,
      intent: comment.intent,
      summary: comment.summary
    };
  }

  /**
   * Get moderator response analysis
   */
  async getModeratorAnalysis(startTime, endTime, categories = null) {
    // For filtered reports, we need to count moderator responses differently
    // Total posts should be filtered by category, but moderator responses should be counted globally
    
    let queryText = `
      SELECT 
        COUNT(DISTINCT p.id) as total_posts,
        COUNT(DISTINCT CASE WHEN c.post_id IS NOT NULL THEN p.id END) as posts_with_moderator_response
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      LEFT JOIN comments c ON p.id = c.post_id AND c.distinguished = 'moderator'
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    // Get moderator stats separately to avoid NULL issues with LEFT JOIN
    // Use the same data source as Top 5 Moderator Commenters (comments table)
    let moderatorStatsQuery = `
      SELECT 
        COUNT(DISTINCT c.author) as unique_moderators,
        COUNT(c.id) as total_moderator_responses
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE c.distinguished = 'moderator'
        AND p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    // Separate query for average response time (using moderator_responses table)
    let responseTimeQuery = `
      SELECT 
        AVG(mr.response_time_seconds) as avg_first_response_time_seconds
      FROM moderator_responses mr
      JOIN comments c ON mr.comment_id = c.id
      JOIN posts p ON mr.post_id = p.id
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE c.distinguished = 'moderator'
        AND p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const moderatorParams = [startTime, endTime];
    const responseTimeParams = [startTime, endTime];
    
    // Add category filter to moderator stats if needed
    if (categories && categories.length > 0) {
      moderatorStatsQuery += ` AND ap.category = ANY($3)`;
      moderatorParams.push(categories);
      
      // Add category filter to response time query
      responseTimeQuery = responseTimeQuery.replace(
        'WHERE p.created_utc >= $1 AND p.created_utc <= $2',
        'WHERE p.created_utc >= $1 AND p.created_utc <= $2 AND ap.category = ANY($3)'
      );
      responseTimeParams.push(categories);
    }
    
    const result = await query(queryText, params);
    const row = result.rows[0];
    
    const totalPosts = parseInt(row.total_posts) || 0;
    const postsWithModeratorResponse = parseInt(row.posts_with_moderator_response) || 0;
    
    // Get moderator stats separately to avoid NULL issues with LEFT JOIN
    const moderatorResult = await query(moderatorStatsQuery, moderatorParams);
    const moderatorRow = moderatorResult.rows[0];
    const uniqueModerators = parseInt(moderatorRow.unique_moderators) || 0;
    const totalModeratorResponses = parseInt(moderatorRow.total_moderator_responses) || 0;
    
    // Get average response time separately
    const responseTimeResult = await query(responseTimeQuery, responseTimeParams);
    const responseTimeRow = responseTimeResult.rows[0];
    const avgFirstResponseTimeSeconds = parseFloat(responseTimeRow.avg_first_response_time_seconds) || 0;
    
    const moderatorResponsePercentage = totalPosts > 0 ? Math.round((postsWithModeratorResponse / totalPosts) * 100) : 0;
    const avgFirstResponseTimeMinutes = Math.round(avgFirstResponseTimeSeconds / 60);
    
    return {
      totalPosts,
      postsWithModeratorResponse,
      moderatorResponsePercentage,
      avgFirstResponseTimeSeconds,
      avgFirstResponseTimeMinutes,
      uniqueModerators,
      totalModeratorResponses
    };
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(startTime, endTime, categories = null) {
    let queryText = `
      SELECT 
        DATE_TRUNC('day', TO_TIMESTAMP(p.created_utc)) as date,
        COUNT(*) as posts_count,
        COUNT(CASE WHEN ap.target = 'faceit' THEN 1 END) as faceit_count,
        AVG(p.score) as avg_score
      FROM posts p
      JOIN analyses_post ap ON p.id = ap.post_id
      WHERE p.created_utc >= $1 AND p.created_utc <= $2
    `;
    
    const params = [startTime, endTime];
    
    if (categories && categories.length > 0) {
      queryText += ` AND ap.category = ANY($3)`;
      params.push(categories);
    }
    
    queryText += ` GROUP BY DATE_TRUNC('day', TO_TIMESTAMP(p.created_utc)) ORDER BY date DESC`;
    
    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Output report to console
   */
  outputConsole(report) {
    console.log('\n' + '='.repeat(80));
    console.log(`📊 ${report.period.toUpperCase()} ANALYSIS REPORT`);
    console.log('='.repeat(80));
    console.log(`📅 Period: ${new Date(report.timeRange.start).toLocaleDateString()} - ${new Date(report.timeRange.end).toLocaleDateString()}`);
    
    // Summary
    console.log('\n📈 SUMMARY');
    console.log('-'.repeat(40));
    console.log(`Total Posts Analyzed: ${report.summary.total_posts}`);
    console.log(`FACEIT Posts: ${report.summary.faceit_posts} (${Math.round(report.summary.faceit_posts / report.summary.total_posts * 100)}%)`);
    console.log(`Help Requests: ${report.summary.help_posts}`);
    console.log(`Comments/Discussions: ${report.summary.comment_posts}`);
    console.log(`Average Score: ${Math.round(report.summary.avg_score)}`);
    console.log(`Average Comments: ${Math.round(report.summary.avg_comments)}`);
    
    // Sentiment
    console.log('\n😊 SENTIMENT DISTRIBUTION');
    console.log('-'.repeat(40));
    report.sentiments.forEach(s => {
      console.log(`${s.sentiment.toUpperCase()}: ${s.count} (${s.percentage}%)`);
    });
    
    // Categories
    console.log('\n🏷️ TOP CATEGORIES');
    console.log('-'.repeat(40));
    report.categories.slice(0, 10).forEach(c => {
      console.log(`${c.category.replace('_', ' ').toUpperCase()}: ${c.count} (${c.percentage}%)`);
    });
    
    // Top Post (reduced to 1)
    console.log('\n🔥 TOP ENGAGED POST');
    console.log('-'.repeat(40));
    if (report.topPosts && report.topPosts.length > 0) {
      const post = report.topPosts[0];
      const date = new Date(post.created_utc * 1000).toLocaleDateString();
      const engagement = post.score + (post.num_comments * 2);
      console.log(`"${post.title.substring(0, 60)}..."`);
      console.log(`   Score: ${post.score}, Comments: ${post.num_comments}, Engagement: ${engagement}`);
      console.log(`   Category: ${post.category}, Sentiment: ${post.sentiment}`);
      console.log(`   Date: ${date}, Author: ${post.author}`);
      if (post.summary) {
        console.log(`   Summary: ${post.summary.substring(0, 100)}...`);
      }
    } else {
      console.log('No posts found in this period');
    }
    
    // Enhanced Comment Analysis
    if (report.commentAnalysis && report.commentAnalysis.totalComments > 0) {
      console.log('\n💬 COMMENT ANALYSIS');
      console.log('-'.repeat(40));
      const commentAnalysis = report.commentAnalysis;
      const posPercent = Math.round((commentAnalysis.positiveComments / commentAnalysis.totalComments) * 100);
      const negPercent = Math.round((commentAnalysis.negativeComments / commentAnalysis.totalComments) * 100);
      const helpPercent = Math.round((commentAnalysis.helpComments / commentAnalysis.totalComments) * 100);
      
      console.log(`Total Comments: ${commentAnalysis.totalComments}`);
      console.log(`Unique Authors: ${commentAnalysis.uniqueCommentAuthors}`);
      console.log(`Sentiment: ${posPercent}% Positive, ${negPercent}% Negative`);
      console.log(`Help Requests: ${helpPercent}% (${commentAnalysis.helpComments}/${commentAnalysis.totalComments})`);
      console.log(`Average Comment Score: ${Math.round(commentAnalysis.avgCommentScore)}`);
      console.log(`Discussion Comments: ${commentAnalysis.discussionComments}`);
    }

    // Moderator Response Analysis
    if (report.moderatorAnalysis && report.moderatorAnalysis.totalPosts > 0) {
      console.log('\n👮 MODERATOR RESPONSE ANALYSIS');
      console.log('-'.repeat(40));
      const moderatorAnalysis = report.moderatorAnalysis;
      
      console.log(`Total Posts: ${moderatorAnalysis.totalPosts}`);
      console.log(`Posts with Moderator Response: ${moderatorAnalysis.postsWithModeratorResponse} (${moderatorAnalysis.moderatorResponsePercentage}%)`);
      console.log(`Total Moderator Responses: ${moderatorAnalysis.totalModeratorResponses}`);
      console.log(`Unique Moderators: ${moderatorAnalysis.uniqueModerators}`);
      if (moderatorAnalysis.avgFirstResponseTimeMinutes > 0) {
        console.log(`Average First Response Time: ${moderatorAnalysis.avgFirstResponseTimeMinutes} minutes`);
      } else {
        console.log(`Average First Response Time: No moderator responses`);
      }
    }

    // Comment Examples - Single most engaged comment
    if (report.commentExamples && (report.commentExamples.positive.length > 0 || report.commentExamples.negative.length > 0 || report.commentExamples.neutral?.length > 0)) {
      console.log('\n💬 MOST ENGAGED COMMENT');
      console.log('-'.repeat(40));
      
      // Find the most engaged comment across all sentiments
      const allComments = [
        ...report.commentExamples.positive,
        ...report.commentExamples.negative,
        ...(report.commentExamples.neutral || [])
      ];
      
      if (allComments.length > 0) {
        // Sort by score and take the highest
        const mostEngagedComment = allComments.sort((a, b) => b.score - a.score)[0];
        
        console.log(`"${mostEngagedComment.body.substring(0, 80)}..."`);
        console.log(`   Author: ${mostEngagedComment.author}, Score: ${mostEngagedComment.score}`);
        console.log('');
      }
    }

    // AI Usage
    console.log('\n🤖 AI USAGE');
    console.log('-'.repeat(40));
    console.log(`Total Input Tokens: ${report.summary.total_input_tokens?.toLocaleString() || 0}`);
    console.log(`Total Output Tokens: ${report.summary.total_output_tokens?.toLocaleString() || 0}`);
    console.log(`Total Cost: $${parseFloat(report.summary.total_cost_usd || 0).toFixed(6)}`);
    
    console.log('\n' + '='.repeat(80));
    return report;
  }

  /**
   * Output report as JSON
   */
  outputJSON(report) {
    const json = JSON.stringify(report, null, 2);
    console.log(json);
    return report;
  }

  /**
   * Output report as CSV
   */
  outputCSV(report) {
    console.log('📄 CSV Export not implemented yet');
    return report;
  }

  /**
   * Post report to Slack
   */
  async postReportToSlack(report) {
    try {
      console.log('📤 Posting report to Slack...');
      
      const periodEmoji = {
        daily: '📅',
        weekly: '📊', 
        monthly: '📈',
        quarterly: '🎯',
        yearly: '🏆'
      };

      const emoji = periodEmoji[report.period] || '📊';
      
      // Create title without categories
      let title = `${report.period.toUpperCase()} ANALYSIS REPORT`;
      
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

      // Add main content sections
      slackMessage.blocks.push({
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
      });

      // Add sentiment distribution
      slackMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*😊 Sentiment Distribution:*'
        }
      });

      if (report.sentiments && report.sentiments.length > 0) {
        slackMessage.blocks.push({
          type: 'section',
          fields: report.sentiments.map(sentiment => ({
            type: 'mrkdwn',
            text: `*${sentiment.sentiment.toUpperCase()}:* ${sentiment.count} (${sentiment.percentage}%)`
          }))
        });
      } else {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*😊 Sentiment Distribution:* No data available'
          }
        });
      }

      // Add top categories
      slackMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🏷️ Top Categories:*'
        }
      });

      if (report.categories && report.categories.length > 0) {
        slackMessage.blocks.push({
          type: 'section',
          fields: report.categories.slice(0, 6).map(category => ({
            type: 'mrkdwn',
            text: `*${category.category.replace('_', ' ').toUpperCase()}:* ${category.count} (${category.percentage}%)`
          }))
        });
      } else {
        slackMessage.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🏷️ Categories:* No data available'
          }
        });
      }

      // Add top engaged posts header
      slackMessage.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🔥 Top Engaged Posts:*'
        }
      });

      // Add top post (reduced to 1)
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

      // Add enhanced comment analysis
      if (report.commentAnalysis && report.commentAnalysis.totalComments > 0) {
        const commentAnalysis = report.commentAnalysis;
        const posPercent = Math.round((commentAnalysis.positiveComments / commentAnalysis.totalComments) * 100);
        const negPercent = Math.round((commentAnalysis.negativeComments / commentAnalysis.totalComments) * 100);
        const helpPercent = Math.round((commentAnalysis.helpComments / commentAnalysis.totalComments) * 100);
        
        slackMessage.blocks.push({
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

      // Add engagement info
      slackMessage.blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📈 Post Engagement:*\nAvg Score: ${Math.round(report.summary.avg_score)}\nAvg Comments: ${Math.round(report.summary.avg_comments)}`
          }
        ]
      });

      // Post to Slack
      await this.slack.postMessage(slackMessage);
      console.log('✅ Report posted to Slack successfully');
      
    } catch (error) {
      console.error('❌ Failed to post report to Slack:', error);
      throw error;
    }
  }
}

// CLI Interface
async function runReport() {
  const args = process.argv.slice(2);
  const period = args[0] || 'daily';
  const format = args[1] || 'console';
  const postToSlack = args.includes('--slack');
  
  // Extract categories (all arguments that are not flags)
  const categories = args.filter(arg => 
    !arg.startsWith('--') && 
    !['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'].includes(arg) &&
    !['console', 'json', 'csv'].includes(arg) &&
    !['slack'].includes(arg)
  );
  
  const validPeriods = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
  const validFormats = ['console', 'json', 'csv'];
  const validCategories = [
    'account_recovery', 'verification', '2fa', 'matchmaking_issues', 'game_registration_issues', 
    'afk_leaver_bans', 'griefing', 'verbal_abuse', 'smurfs', 'cheaters', 'anti_cheat',
    'subscriptions', 'faceit_shop', 'technical_client', 'platform_website', 'steam_issues_game_update',
    'tournaments_leagues', 'esea', 'mission', 'moderation_community', 'feature_request', 
    'track_stats', 'ow2', 'dota2', 'legal_issues_gdpr', 'other'
  ];
  
  if (!validPeriods.includes(period)) {
    console.error(`❌ Invalid period. Valid options: ${validPeriods.join(', ')}`);
    process.exit(1);
  }
  
  if (!validFormats.includes(format)) {
    console.error(`❌ Invalid format. Valid options: ${validFormats.join(', ')}`);
    process.exit(1);
  }
  
  // Validate categories
  const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
  if (invalidCategories.length > 0) {
    console.error(`❌ Invalid categories: ${invalidCategories.join(', ')}`);
    console.error(`Valid categories: ${validCategories.join(', ')}`);
    process.exit(1);
  }
  
  try {
    const creator = new ReportCreator();
    await creator.generateReport(period, null, null, format, postToSlack, categories);
  } catch (error) {
    console.error('❌ Report generation failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMainModule) {
  runReport();
}

export { ReportCreator };
