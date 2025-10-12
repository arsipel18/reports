import dotenv from 'dotenv';
import { query } from './db.js';
import { RealisticRedditFetcher } from './reddit_fetcher.js';

dotenv.config();

/**
 * Re-process comments for posts that failed comment processing
 */
async function reprocessComments() {
  let redditFetcher = null;
  
  try {
    console.log('🔄 Re-processing comments for affected posts...');
    console.log('=' .repeat(60));
    
    // Initialize Reddit fetcher
    redditFetcher = new RealisticRedditFetcher();
    
    // Get posts without comments
    const postsWithoutComments = await query(`
      SELECT 
        p.id,
        p.title,
        p.author,
        p.created_utc,
        p.num_comments,
        p.created_at
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE c.post_id IS NULL
      ORDER BY p.created_utc DESC
      LIMIT 50
    `);
    
    console.log(`📊 Found ${postsWithoutComments.rows.length} posts without comments to re-process`);
    
    if (postsWithoutComments.rows.length === 0) {
      console.log('✅ No posts need comment re-processing!');
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    let totalCommentsAdded = 0;
    
    for (let i = 0; i < postsWithoutComments.rows.length; i++) {
      const post = postsWithoutComments.rows[i];
      
      try {
        console.log(`\n📝 Processing ${i + 1}/${postsWithoutComments.rows.length}: ${post.id}`);
        console.log(`   Title: "${post.title.substring(0, 60)}..."`);
        console.log(`   Reddit comments: ${post.num_comments}`);
        
        // Get the post from Reddit
        const redditPost = await redditFetcher.reddit.getSubmission(post.id);
        
        if (!redditPost) {
          console.log(`   ⚠️ Could not fetch post from Reddit`);
          errorCount++;
          continue;
        }
        
        // Process comments using the fixed method
        const commentCount = await redditFetcher.processPostComments(post.id, redditPost);
        
        if (commentCount > 0) {
          console.log(`   ✅ Added ${commentCount} comments`);
          totalCommentsAdded += commentCount;
          successCount++;
        } else {
          console.log(`   ⚠️ No comments added (post may have no comments or they were already processed)`);
          successCount++; // Still count as success if post legitimately has no comments
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`   ❌ Error processing post ${post.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n🎯 Re-processing Summary:');
    console.log(`  Posts processed successfully: ${successCount}`);
    console.log(`  Posts with errors: ${errorCount}`);
    console.log(`  Total comments added: ${totalCommentsAdded}`);
    
    // Get updated statistics
    const stats = await query(`
      SELECT 
        COUNT(*) as total_posts,
        COUNT(CASE WHEN c.post_id IS NOT NULL THEN 1 END) as posts_with_comments,
        COUNT(CASE WHEN c.post_id IS NULL THEN 1 END) as posts_without_comments
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
    `);
    
    const stat = stats.rows[0];
    console.log('\n📊 Updated Statistics:');
    console.log(`  Total posts: ${stat.total_posts}`);
    console.log(`  Posts with comments: ${stat.posts_with_comments}`);
    console.log(`  Posts without comments: ${stat.posts_without_comments}`);
    console.log(`  Percentage without comments: ${((stat.posts_without_comments / stat.total_posts) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Error in comment re-processing:', error.message);
    throw error;
  } finally {
    if (redditFetcher && redditFetcher.pool) {
      await redditFetcher.pool.end();
    }
  }
}

/**
 * Re-process comments for posts with missing comments
 */
async function reprocessMissingComments() {
  let redditFetcher = null;
  
  try {
    console.log('\n🔄 Re-processing missing comments...');
    console.log('=' .repeat(60));
    
    // Initialize Reddit fetcher
    redditFetcher = new RealisticRedditFetcher();
    
    // Get posts with missing comments
    const postsWithMissingComments = await query(`
      SELECT 
        p.id,
        p.title,
        p.author,
        p.num_comments as reddit_comments,
        COUNT(c.id) as our_comments,
        p.created_utc
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE p.num_comments > 0
      GROUP BY p.id, p.title, p.author, p.num_comments, p.created_utc
      HAVING COUNT(c.id) < p.num_comments * 0.5
      ORDER BY p.created_utc DESC
      LIMIT 30
    `);
    
    console.log(`📊 Found ${postsWithMissingComments.rows.length} posts with missing comments to re-process`);
    
    if (postsWithMissingComments.rows.length === 0) {
      console.log('✅ No posts need missing comment re-processing!');
      return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    let totalCommentsAdded = 0;
    
    for (let i = 0; i < postsWithMissingComments.rows.length; i++) {
      const post = postsWithMissingComments.rows[i];
      
      try {
        const missingCount = post.reddit_comments - post.our_comments;
        console.log(`\n📝 Processing ${i + 1}/${postsWithMissingComments.rows.length}: ${post.id}`);
        console.log(`   Title: "${post.title.substring(0, 60)}..."`);
        console.log(`   Reddit: ${post.reddit_comments} comments, We have: ${post.our_comments}, Missing: ${missingCount}`);
        
        // Get the post from Reddit
        const redditPost = await redditFetcher.reddit.getSubmission(post.id);
        
        if (!redditPost) {
          console.log(`   ⚠️ Could not fetch post from Reddit`);
          errorCount++;
          continue;
        }
        
        // Process comments using the fixed method
        const commentCount = await redditFetcher.processPostComments(post.id, redditPost);
        
        if (commentCount > 0) {
          console.log(`   ✅ Added ${commentCount} comments`);
          totalCommentsAdded += commentCount;
        } else {
          console.log(`   ⚠️ No new comments added`);
        }
        
        successCount++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`   ❌ Error processing post ${post.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n🎯 Missing Comments Re-processing Summary:');
    console.log(`  Posts processed successfully: ${successCount}`);
    console.log(`  Posts with errors: ${errorCount}`);
    console.log(`  Total comments added: ${totalCommentsAdded}`);
    
  } catch (error) {
    console.error('❌ Error in missing comment re-processing:', error.message);
    throw error;
  } finally {
    if (redditFetcher && redditFetcher.pool) {
      await redditFetcher.pool.end();
    }
  }
}

// Main execution
async function main() {
  try {
    await reprocessComments();
    await reprocessMissingComments();
    
    console.log('\n🎉 Comment re-processing completed!');
    console.log('💡 Run the find_posts_without_comments.js script to verify the fix');
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || 
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}

export { reprocessComments, reprocessMissingComments };
