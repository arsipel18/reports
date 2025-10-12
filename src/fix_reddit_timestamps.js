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

async function fixRedditTimestamps() {
  try {
    console.log('🔧 Comprehensive Reddit Timestamp Fix');
    console.log('=' .repeat(60));
    
    // Step 1: Remove DEFAULT NOW() from created_at columns
    console.log('1. Removing DEFAULT NOW() from created_at columns...');
    
    await pool.query(`
      ALTER TABLE posts ALTER COLUMN created_at DROP DEFAULT
    `);
    console.log('✅ Removed DEFAULT from posts.created_at');
    
    await pool.query(`
      ALTER TABLE comments ALTER COLUMN created_at DROP DEFAULT
    `);
    console.log('✅ Removed DEFAULT from comments.created_at');
    
    // Step 2: Update existing data to use real Reddit creation times
    console.log('\n2. Updating existing data with real Reddit creation times...');
    
    const postsResult = await pool.query(`
      UPDATE posts 
      SET created_at = to_timestamp(created_utc)
    `);
    console.log(`✅ Updated ${postsResult.rowCount} posts`);
    
    const commentsResult = await pool.query(`
      UPDATE comments 
      SET created_at = to_timestamp(created_utc)
    `);
    console.log(`✅ Updated ${commentsResult.rowCount} comments`);
    
    // Step 3: Verify the fix
    console.log('\n3. Verification:');
    const verifyResult = await pool.query(`
      SELECT 
        id,
        created_utc,
        created_at,
        author,
        body
      FROM comments 
      ORDER BY created_utc ASC
      LIMIT 5
    `);
    
    verifyResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Author: ${row.author}`);
      console.log(`   created_utc: ${row.created_utc}`);
      console.log(`   created_at: ${row.created_at}`);
      
      // Convert Unix timestamp to verify
      const unixDate = new Date(row.created_utc * 1000);
      console.log(`   Should be: ${unixDate}`);
      console.log(`   Match: ${Math.abs(row.created_at.getTime() - unixDate.getTime()) < 1000}`);
      console.log(`   Body: ${row.body.substring(0, 40)}...`);
      console.log();
    });
    
    // Step 4: Show date range
    const rangeResult = await pool.query(`
      SELECT 
        MIN(created_at) as earliest,
        MAX(created_at) as latest,
        COUNT(*) as total_comments
      FROM comments
    `);
    
    const range = rangeResult.rows[0];
    console.log('📊 Date Range:');
    console.log(`Earliest comment: ${range.earliest}`);
    console.log(`Latest comment: ${range.latest}`);
    console.log(`Total comments: ${range.total_comments}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixRedditTimestamps();
