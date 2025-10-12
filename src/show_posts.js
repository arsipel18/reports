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

try {
  console.log('📋 Posts Table - Recent Posts with Creation Times:');
  console.log('=' .repeat(60));
  
  const result = await pool.query(`
    SELECT 
      id,
      title,
      author,
      created_at,
      created_utc,
      score,
      num_comments
    FROM posts 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  
  console.log(`Found ${result.rows.length} recent posts:`);
  console.log();
  
  result.rows.forEach((post, index) => {
    console.log(`${index + 1}. ID: ${post.id}`);
    console.log(`   Title: ${post.title.substring(0, 60)}...`);
    console.log(`   Author: ${post.author}`);
    console.log(`   Created: ${post.created_at}`);
    console.log(`   UTC: ${post.created_utc}`);
    console.log(`   Score: ${post.score}, Comments: ${post.num_comments}`);
    console.log();
  });
  
  console.log('\n📊 Posts Table Structure:');
  console.log('=' .repeat(60));
  
  const structureResult = await pool.query(`
    SELECT 
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns 
    WHERE table_name = 'posts' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  
  structureResult.rows.forEach(column => {
    const nullable = column.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const defaultVal = column.column_default ? ` DEFAULT ${column.column_default}` : '';
    console.log(`📝 ${column.column_name}: ${column.data_type} ${nullable}${defaultVal}`);
  });
  
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  await pool.end();
}
