import dotenv from 'dotenv';
import { Pool } from 'pg';
import ModeratorDetectionService from './moderator_detection.js';

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
 * Update all moderator comments in the comments table
 * This script scans all comments and marks moderator ones properly
 */
async function updateAllModeratorComments() {
  try {
    console.log('🔄 Updating all moderator comments in comments table...');
    console.log('=' .repeat(60));
    
    // Initialize moderator detection service
    const moderatorDetection = new ModeratorDetectionService();
    await moderatorDetection.initialize();
    
    // Get all unique authors from comments
    console.log('📊 Getting all comment authors...');
    const authorsResult = await pool.query(`
      SELECT DISTINCT author 
      FROM comments 
      WHERE author IS NOT NULL 
      AND author != '[deleted]'
      ORDER BY author
    `);
    
    const authors = authorsResult.rows.map(row => row.author);
    console.log(`📝 Found ${authors.length} unique comment authors`);
    
    // Check which authors are moderators
    console.log('🔍 Checking which authors are moderators...');
    const moderatorAuthors = [];
    
    for (const author of authors) {
      try {
        const isModerator = await moderatorDetection.isModerator(author);
        if (isModerator) {
          moderatorAuthors.push(author);
          console.log(`✅ ${author} is a moderator`);
        }
      } catch (error) {
        console.warn(`⚠️ Error checking moderator status for ${author}: ${error.message}`);
      }
    }
    
    console.log(`👮 Found ${moderatorAuthors.length} moderator authors: ${moderatorAuthors.join(', ')}`);
    
    // Update all comments from these moderators
    if (moderatorAuthors.length > 0) {
      console.log('🔄 Updating moderator comments in database...');
      
      const updateResult = await pool.query(`
        UPDATE comments 
        SET distinguished = 'moderator'
        WHERE author = ANY($1)
        AND distinguished IS DISTINCT FROM 'moderator'
      `, [moderatorAuthors]);
      
      console.log(`✅ Updated ${updateResult.rowCount} comments to mark as moderator comments`);
    }
    
    // Get final statistics
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_comments,
        COUNT(CASE WHEN distinguished = 'moderator' THEN 1 END) as moderator_comments,
        COUNT(DISTINCT CASE WHEN distinguished = 'moderator' THEN author END) as unique_moderators
      FROM comments
    `);
    
    const stats = statsResult.rows[0];
    console.log('\n📊 Final Statistics:');
    console.log(`  Total comments: ${stats.total_comments}`);
    console.log(`  Moderator comments: ${stats.moderator_comments}`);
    console.log(`  Unique moderators: ${stats.unique_moderators}`);
    console.log(`  Moderator comment percentage: ${Math.round((stats.moderator_comments / stats.total_comments) * 100)}%`);
    
    console.log('\n🎉 Moderator comment update completed successfully!');
    
  } catch (error) {
    console.error('❌ Error updating moderator comments:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('update_all_moderator_comments.js')) {
  updateAllModeratorComments()
    .then(() => {
      console.log('✅ Moderator comment update completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Moderator comment update failed:', error);
      process.exit(1);
    });
}

export { updateAllModeratorComments };
