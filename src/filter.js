import dotenv from 'dotenv';

dotenv.config();

class FilterService {
  constructor() {
    this.loadKeywords();
    console.log('🔍 Filter service initialized');
  }

  /**
   * Load keywords from environment variables
   */
  loadKeywords() {
    // Parse include keywords
    const includeStr = process.env.INCLUDE_KEYWORDS || '';
    this.includeKeywords = includeStr
      .split(',')
      .map(kw => kw.trim().toLowerCase())
      .filter(kw => kw.length > 0);

    // Parse exclude keywords
    const excludeStr = process.env.EXCLUDE_KEYWORDS || '';
    this.excludeKeywords = excludeStr
      .split(',')
      .map(kw => kw.trim().toLowerCase())
      .filter(kw => kw.length > 0);

    console.log(`🎯 Filter keywords loaded:`);
    console.log(`  Include: ${this.includeKeywords.length} keywords`);
    console.log(`  Exclude: ${this.excludeKeywords.length} keywords`);
  }

  /**
   * Check if content passes keyword filters
   * @param {string} title - Post title
   * @param {string} body - Post body/content
   * @param {string} flair - Post flair text
   * @returns {Object} - { passes: boolean, reason: string, matchedKeywords: string[] }
   */
  checkContent(title = '', body = '', flair = '') {
    // Combine all text and normalize
    const combinedText = `${title} ${body} ${flair}`.toLowerCase().trim();
    
    if (!combinedText) {
      return {
        passes: false,
        reason: 'Empty content',
        matchedKeywords: []
      };
    }

    console.log(`🔍 Filtering content: "${title.substring(0, 50)}..."`);

    // Step 1: Check include keywords (at least one must match)
    const matchedIncludeKeywords = [];
    let hasIncludeKeyword = false;

    if (this.includeKeywords.length > 0) {
      for (const keyword of this.includeKeywords) {
        if (combinedText.includes(keyword)) {
          matchedIncludeKeywords.push(keyword);
          hasIncludeKeyword = true;
        }
      }

      if (!hasIncludeKeyword) {
        console.log(`  ❌ No include keywords found`);
        return {
          passes: false,
          reason: 'No required keywords found',
          matchedKeywords: []
        };
      }

      console.log(`  ✅ Include keywords found: [${matchedIncludeKeywords.join(', ')}]`);
    }

    // Step 2: Check exclude keywords (none should match)
    const matchedExcludeKeywords = [];
    
    if (this.excludeKeywords.length > 0) {
      for (const keyword of this.excludeKeywords) {
        if (combinedText.includes(keyword)) {
          matchedExcludeKeywords.push(keyword);
        }
      }

      if (matchedExcludeKeywords.length > 0) {
        console.log(`  ❌ Exclude keywords found: [${matchedExcludeKeywords.join(', ')}]`);
        return {
          passes: false,
          reason: `Contains excluded keywords: ${matchedExcludeKeywords.join(', ')}`,
          matchedKeywords: matchedExcludeKeywords
        };
      }

      console.log(`  ✅ No exclude keywords found`);
    }

    console.log(`  🎯 Content PASSED filtering`);
    return {
      passes: true,
      reason: 'Passed all filters',
      matchedKeywords: matchedIncludeKeywords
    };
  }

  /**
   * Filter array of posts
   * @param {Array} posts - Array of post objects
   * @returns {Object} - { accepted: Array, rejected: Array, stats: Object }
   */
  filterPosts(posts) {
    console.log(`🔍 Filtering ${posts.length} posts...`);
    
    const accepted = [];
    const rejected = [];
    const stats = {
      total: posts.length,
      accepted: 0,
      rejected: 0,
      rejectionReasons: {}
    };

    for (const post of posts) {
      const filterResult = this.checkContent(
        post.title || '',
        post.body || post.selftext || '',
        post.link_flair_text || ''
      );

      if (filterResult.passes) {
        accepted.push({
          ...post,
          filterResult
        });
        stats.accepted++;
      } else {
        rejected.push({
          ...post,
          filterResult
        });
        stats.rejected++;
        
        // Track rejection reasons
        const reason = filterResult.reason;
        stats.rejectionReasons[reason] = (stats.rejectionReasons[reason] || 0) + 1;
      }
    }

    console.log(`📊 Filtering results:`);
    console.log(`  ✅ Accepted: ${stats.accepted}/${stats.total} posts`);
    console.log(`  ❌ Rejected: ${stats.rejected}/${stats.total} posts`);
    
    if (stats.rejected > 0) {
      console.log(`  📋 Rejection reasons:`);
      Object.entries(stats.rejectionReasons).forEach(([reason, count]) => {
        console.log(`    - ${reason}: ${count}`);
      });
    }

    return { accepted, rejected, stats };
  }

  /**
   * Get current filter configuration
   */
  getConfig() {
    return {
      includeKeywords: [...this.includeKeywords],
      excludeKeywords: [...this.excludeKeywords],
      includeCount: this.includeKeywords.length,
      excludeCount: this.excludeKeywords.length
    };
  }

  /**
   * Update keywords at runtime (useful for dynamic configuration)
   */
  updateKeywords(includeKeywords = null, excludeKeywords = null) {
    if (includeKeywords !== null) {
      this.includeKeywords = includeKeywords
        .map(kw => kw.trim().toLowerCase())
        .filter(kw => kw.length > 0);
      console.log(`🔄 Updated include keywords: ${this.includeKeywords.length} keywords`);
    }

    if (excludeKeywords !== null) {
      this.excludeKeywords = excludeKeywords
        .map(kw => kw.trim().toLowerCase())
        .filter(kw => kw.length > 0);
      console.log(`🔄 Updated exclude keywords: ${this.excludeKeywords.length} keywords`);
    }
  }

  /**
   * Test filter with sample content
   */
  test(title, body = '', flair = '') {
    console.log(`🧪 Testing filter with: "${title}"`);
    const result = this.checkContent(title, body, flair);
    console.log(`Result: ${result.passes ? '✅ PASS' : '❌ FAIL'} - ${result.reason}`);
    return result;
  }
}

export default FilterService;
