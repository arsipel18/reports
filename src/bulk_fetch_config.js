/**
 * Configuration for bulk Reddit data fetching
 * Adjust these settings as needed
 */

export const BULK_FETCH_CONFIG = {
  // Date range for data collection (Note: Reddit API has limitations for historical data)
  // For historical data, we'll fetch recent posts and work backwards
  START_DATE: '2024-01-01T00:00:00Z',  // Changed to 2024 for realistic data
  END_DATE: '2024-12-31T23:59:59Z',    // Changed to 2024 for realistic data
  
  // Reddit API settings
  SUBREDDIT: 'FACEITcom',
  POSTS_PER_BATCH: 1000,
  MAX_COMMENTS_PER_POST: 200,
  
  // Rate limiting (in milliseconds)
  DELAY_BETWEEN_POSTS: 2000,      // 2 seconds between posts
  DELAY_BETWEEN_MONTHS: 60000,    // 1 minute between months
  
  // Database settings
  BATCH_SIZE: 100,                 // Process posts in batches
  
  // Filtering options
  MIN_POST_SCORE: 0,               // Minimum post score to include
  MIN_COMMENT_SCORE: 0,            // Minimum comment score to include
  MIN_COMMENT_LENGTH: 10,          // Minimum comment character length
  
  // Logging
  VERBOSE_LOGGING: true,           // Enable detailed logging
  LOG_PROGRESS_INTERVAL: 10,       // Log progress every N posts
};

export default BULK_FETCH_CONFIG;
