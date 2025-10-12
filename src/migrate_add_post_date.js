import dotenv from 'dotenv';
import { createDbConnection, closeDb, query } from './db.js';

dotenv.config();

/**
 * Database Migration: Add post_created_utc to analyses_post table
 * This migration adds the actual post creation date to the analyses_post table
 * so that reports can show the real post dates instead of analysis dates.
 */

async function addPostCreatedUtcColumn() {
  let pool = null;
  
  try {
    console.log('🗄️ Starting database migration: Add post_created_utc column');
    pool = await createDbConnection();
    console.log('✅ Connected to database');

    // Check if column already exists
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'analyses_post' 
      AND column_name = 'post_created_utc'
    `;
    
    const checkResult = await query(checkColumnQuery);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ Column post_created_utc already exists in analyses_post table');
      return;
    }

    // Add the new column
    console.log('📝 Adding post_created_utc column to analyses_post table...');
    await query(`
      ALTER TABLE analyses_post 
      ADD COLUMN post_created_utc BIGINT
    `);
    console.log('✅ Column post_created_utc added successfully');

    // Populate the new column with data from posts table
    console.log('🔄 Populating post_created_utc with existing data...');
    const updateResult = await query(`
      UPDATE analyses_post 
      SET post_created_utc = p.created_utc
      FROM posts p 
      WHERE analyses_post.post_id = p.id
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} records with post creation dates`);

    // Add index for better performance
    console.log('📊 Adding index on post_created_utc...');
    await query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_post_created_utc 
      ON analyses_post(post_created_utc)
    `);
    console.log('✅ Index created successfully');

    console.log('🎉 Migration completed successfully!');
    console.log('📋 Summary:');
    console.log('  - Added post_created_utc column to analyses_post table');
    console.log('  - Populated column with actual post creation dates');
    console.log('  - Added performance index');
    console.log('  - Reports will now show correct post creation dates');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    if (pool) {
      await closeDb();
      console.log('📴 Database connection closed');
    }
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('migrate_add_post_date.js')) {
  addPostCreatedUtcColumn()
    .then(() => {
      console.log('\n✅ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration failed:', error);
      process.exit(1);
    });
}

export { addPostCreatedUtcColumn };
