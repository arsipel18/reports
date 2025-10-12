import dotenv from 'dotenv';
import snoowrap from 'snoowrap';

dotenv.config();

/**
 * Moderator Detection Service
 * Detects if a user is a moderator of the subreddit
 */
class ModeratorDetectionService {
  constructor() {
    this.reddit = new snoowrap({
      userAgent: process.env.REDDIT_USER_AGENT,
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      refreshToken: process.env.REDDIT_REFRESH_TOKEN
    });
    
    this.subreddit = process.env.SUBREDDIT || 'FACEITcom';
    this.moderatorCache = new Map(); // Cache moderator status
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
    this.lastModeratorFetch = 0;
  }

  /**
   * Check if a user is a moderator of the subreddit
   */
  async isModerator(username) {
    try {
      // Skip deleted users
      if (!username || username === '[deleted]') {
        return false;
      }

      // Check cache first
      if (this.moderatorCache.has(username)) {
        return this.moderatorCache.get(username);
      }

      // Refresh moderator list if cache is expired
      if (Date.now() - this.lastModeratorFetch > this.cacheExpiry) {
        await this.refreshModeratorList();
      }

      // Check if user is in moderator list
      const isMod = this.moderatorCache.has(username) && this.moderatorCache.get(username);
      
      // Cache the result
      this.moderatorCache.set(username, isMod);
      
      return isMod;

    } catch (error) {
      console.error(`❌ Error checking moderator status for ${username}:`, error.message);
      return false;
    }
  }

  /**
   * Refresh the list of moderators from Reddit
   */
  async refreshModeratorList() {
    try {
      console.log('🔄 Refreshing moderator list...');
      
      const subreddit = await this.reddit.getSubreddit(this.subreddit);
      const moderators = await subreddit.getModerators();
      
      // Clear existing cache
      this.moderatorCache.clear();
      
      // Add moderators to cache
      moderators.forEach(mod => {
        this.moderatorCache.set(mod.name, true);
      });
      
      this.lastModeratorFetch = Date.now();
      
      console.log(`✅ Cached ${moderators.length} moderators: ${moderators.map(m => m.name).join(', ')}`);
      
    } catch (error) {
      console.error('❌ Error refreshing moderator list:', error.message);
    }
  }

  /**
   * Get all known moderators
   */
  getKnownModerators() {
    return Array.from(this.moderatorCache.keys()).filter(username => 
      this.moderatorCache.get(username)
    );
  }

  /**
   * Manually add a moderator (useful for known moderators)
   */
  addKnownModerator(username) {
    this.moderatorCache.set(username, true);
    console.log(`✅ Added known moderator: ${username}`);
  }

  /**
   * Initialize with known moderators
   */
  async initialize() {
    try {
      // Add some known moderators manually (you can expand this list)
      const knownModerators = [
        'FACEIT-InfinityG',
        'Faceit_Alexa',
        'FACEIT_Darwin',
        'Faceit_Mikey',
        'FACEIT_RestfulGoat'
      ];

      knownModerators.forEach(mod => {
        this.addKnownModerator(mod);
      });

      // Also fetch from Reddit API
      await this.refreshModeratorList();
      
      console.log(`🎯 Moderator detection initialized with ${this.getKnownModerators().length} moderators`);
      
    } catch (error) {
      console.error('❌ Error initializing moderator detection:', error.message);
    }
  }
}

export default ModeratorDetectionService;
