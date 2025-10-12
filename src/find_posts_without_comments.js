import dotenv from 'dotenv';
import { query } from './db.js';

dotenv.config();

/**
 * Find posts that don't have any comments in the database
 * These are likely posts where comment processing failed due to the bug
 */
async function findPostsWithoutComments() {
  try {
    console.log('🔍 Finding posts without comments...');
    console.log('=' .repeat(50));
    
    // Get posts that have no comments
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
      LIMIT 100
    `);
    
    console.log(`📊 Found ${postsWithoutComments.rows.length} posts without comments`);
    
    if (postsWithoutComments.rows.length === 0) {
      console.log('✅ All posts have comments!');
      return [];
    }
    
    console.log('\n📝 Posts without comments:');
    postsWithoutComments.rows.forEach((post, index) => {
      console.log(`${index + 1}. ${post.id} - "${post.title.substring(0, 60)}..."`);
      console.log(`   Author: ${post.author}, Reddit comments: ${post.num_comments}, Created: ${new Date(post.created_utc * 1000).toLocaleDateString()}`);
    });
    
    // Get statistics
    const stats = await query(`
      SELECT 
        COUNT(*) as total_posts,
        COUNT(CASE WHEN c.post_id IS NOT NULL THEN 1 END) as posts_with_comments,
        COUNT(CASE WHEN c.post_id IS NULL THEN 1 END) as posts_without_comments
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
    `);
    
    const stat = stats.rows[0];
    console.log('\n📊 Statistics:');
    console.log(`  Total posts: ${stat.total_posts}`);
    console.log(`  Posts with comments: ${stat.posts_with_comments}`);
    console.log(`  Posts without comments: ${stat.posts_without_comments}`);
    console.log(`  Percentage without comments: ${((stat.posts_without_comments / stat.total_posts) * 100).toFixed(1)}%`);
    
    return postsWithoutComments.rows;
    
  } catch (error) {
    console.error('❌ Error finding posts without comments:', error.message);
    throw error;
  }
}

/**
 * Find posts that have fewer comments than expected based on Reddit's num_comments
 */
async function findPostsWithMissingComments() {
  try {
    console.log('\n🔍 Finding posts with missing comments...');
    console.log('=' .repeat(50));
    
    // Get posts where our comment count is significantly less than Reddit's num_comments
    const postsWithMissingComments = await query(`
      SELECT 
        p.id,
        p.title,
        p.author,
        p.num_comments as reddit_comments,
        COUNT(c.id) as our_comments,
        p.created_utc,
        p.created_at
      FROM posts p
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE p.num_comments > 0
      GROUP BY p.id, p.title, p.author, p.num_comments, p.created_utc, p.created_at
      HAVING COUNT(c.id) < p.num_comments * 0.5  -- We have less than 50% of expected comments
      ORDER BY p.created_utc DESC
      LIMIT 50
    `);
    
    console.log(`📊 Found ${postsWithMissingComments.rows.length} posts with missing comments`);
    
    if (postsWithMissingComments.rows.length === 0) {
      console.log('✅ All posts have adequate comment coverage!');
      return [];
    }
    
    console.log('\n📝 Posts with missing comments:');
    postsWithMissingComments.rows.forEach((post, index) => {
      const missingCount = post.reddit_comments - post.our_comments;
      console.log(`${index + 1}. ${post.id} - "${post.title.substring(0, 60)}..."`);
      console.log(`   Reddit: ${post.reddit_comments} comments, We have: ${post.our_comments}, Missing: ${missingCount}`);
    });
    
    return postsWithMissingComments.rows;
    
  } catch (error) {
    console.error('❌ Error finding posts with missing comments:', error.message);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    console.log('🚀 Starting find_posts_without_comments script...');
    const postsWithoutComments = await findPostsWithoutComments();
    const postsWithMissingComments = await findPostsWithMissingComments();
    
    console.log('\n🎯 Summary:');
    console.log(`Posts without any comments: ${postsWithoutComments.length}`);
    console.log(`Posts with missing comments: ${postsWithMissingComments.length}`);
    
    if (postsWithoutComments.length > 0 || postsWithMissingComments.length > 0) {
      console.log('\n💡 Next steps:');
      console.log('1. Run the comment re-processing script to fix these posts');
      console.log('2. Check the Reddit fetcher logs for any other errors');
      console.log('3. Verify the fix is working by running this script again');
    }
    
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

export { findPostsWithoutComments, findPostsWithMissingComments };
