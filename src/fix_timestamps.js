import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
});

/**
 * Fix created_at timestamps to use actual Reddit creation times
 */
async function fixCreationTimes() {
  try {
    console.log('🔧 Fixing created_at timestamps to use actual Reddit creation times...');
    console.log('=' .repeat(60));
    
    // Fix posts table
    console.log('📝 Updating posts table...');
    const postsResult = await pool.query(`
      UPDATE posts 
      SET created_at = to_timestamp(created_utc)
      WHERE created_at != to_timestamp(created_utc)
    `);
    console.log(`✅ Updated ${postsResult.rowCount} posts`);
    
    // Fix comments table  
    console.log('💬 Updating comments table...');
    const commentsResult = await pool.query(`
      UPDATE comments 
      SET created_at = to_timestamp(created_utc)
      WHERE created_at != to_timestamp(created_utc)
    `);
    console.log(`✅ Updated ${commentsResult.rowCount} comments`);
    
    // Show some examples
    console.log('\n📊 Sample of corrected timestamps:');
    console.log('=' .repeat(60));
    
    const samplePosts = await pool.query(`
      SELECT id, title, created_at, created_utc
      FROM posts 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('Recent Posts (by actual Reddit creation time):');
    samplePosts.rows.forEach((post, index) => {
      console.log(`${index + 1}. ${post.id}: "${post.title.substring(0, 40)}..."`);
      console.log(`   Created: ${post.created_at}`);
      console.log(`   UTC: ${post.created_utc}`);
      console.log();
    });
    
    const sampleComments = await pool.query(`
      SELECT id, body, author, created_at, created_utc
      FROM comments 
      ORDER BY created_at DESC 
      LIMIT 3
    `);
    
    console.log('Recent Comments (by actual Reddit creation time):');
    sampleComments.rows.forEach((comment, index) => {
      console.log(`${index + 1}. ${comment.id}: "${comment.body.substring(0, 40)}..."`);
      console.log(`   Author: ${comment.author}`);
      console.log(`   Created: ${comment.created_at}`);
      console.log(`   UTC: ${comment.created_utc}`);
      console.log();
    });
    
  } catch (error) {
    console.error('❌ Error fixing timestamps:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('fix_timestamps.js')) {
  fixCreationTimes()
    .then(() => {
      console.log('✅ Timestamp fix completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Timestamp fix failed:', error);
      process.exit(1);
    });
}

export { fixCreationTimes };
