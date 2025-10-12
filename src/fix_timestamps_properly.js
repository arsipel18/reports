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

async function fixTimestampsProperly() {
  try {
    console.log('🔧 Properly fixing timestamps...');
    console.log('=' .repeat(60));
    
    // First, let's see what we're working with
    const sampleResult = await pool.query(`
      SELECT 
        id,
        created_utc,
        created_at
      FROM comments 
      WHERE id = 'fszirxl'
    `);
    
    if (sampleResult.rows.length > 0) {
      const row = sampleResult.rows[0];
      console.log('Before fix:');
      console.log(`ID: ${row.id}`);
      console.log(`created_utc: ${row.created_utc}`);
      console.log(`created_at: ${row.created_at}`);
      
      // Convert Unix timestamp to proper date
      const unixDate = new Date(row.created_utc * 1000);
      console.log(`Should be: ${unixDate}`);
    }
    
    // Now fix all comments
    console.log('\nUpdating comments...');
    const commentsResult = await pool.query(`
      UPDATE comments 
      SET created_at = to_timestamp(created_utc)
    `);
    console.log(`✅ Updated ${commentsResult.rowCount} comments`);
    
    // Fix all posts
    console.log('\nUpdating posts...');
    const postsResult = await pool.query(`
      UPDATE posts 
      SET created_at = to_timestamp(created_utc)
    `);
    console.log(`✅ Updated ${postsResult.rowCount} posts`);
    
    // Verify the fix
    console.log('\nVerification:');
    const verifyResult = await pool.query(`
      SELECT 
        id,
        created_utc,
        created_at
      FROM comments 
      ORDER BY created_utc ASC
      LIMIT 3
    `);
    
    verifyResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   created_utc: ${row.created_utc}`);
      console.log(`   created_at: ${row.created_at}`);
      
      // Convert Unix timestamp to verify
      const unixDate = new Date(row.created_utc * 1000);
      console.log(`   Should match: ${unixDate}`);
      console.log(`   Match: ${row.created_at.getTime() === unixDate.getTime()}`);
      console.log();
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixTimestampsProperly();
