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

async function investigateTimestamps() {
  try {
    console.log('🔍 Investigating timestamp data...');
    console.log('=' .repeat(60));
    
    // Check some sample data
    const result = await pool.query(`
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
    
    console.log('Sample comments with timestamps:');
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ID: ${row.id}`);
      console.log(`   Author: ${row.author}`);
      console.log(`   created_utc: ${row.created_utc}`);
      console.log(`   created_at: ${row.created_at}`);
      
      // Convert Unix timestamp to date
      const unixDate = new Date(row.created_utc * 1000);
      console.log(`   Unix converted: ${unixDate}`);
      console.log(`   Body: ${row.body.substring(0, 50)}...`);
      console.log();
    });
    
    // Check if created_utc values look like proper Unix timestamps
    const statsResult = await pool.query(`
      SELECT 
        MIN(created_utc) as min_utc,
        MAX(created_utc) as max_utc,
        COUNT(*) as total_comments
      FROM comments
    `);
    
    const stats = statsResult.rows[0];
    console.log('Timestamp Statistics:');
    console.log(`Min created_utc: ${stats.min_utc}`);
    console.log(`Max created_utc: ${stats.max_utc}`);
    console.log(`Total comments: ${stats.total_comments}`);
    
    // Convert to dates
    const minDate = new Date(stats.min_utc * 1000);
    const maxDate = new Date(stats.max_utc * 1000);
    console.log(`Min date: ${minDate}`);
    console.log(`Max date: ${maxDate}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

investigateTimestamps();
