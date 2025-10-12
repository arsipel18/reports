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
 * Update existing database to mark all moderator comments
 */
async function updateExistingModeratorComments() {
  try {
    console.log('🔄 Updating existing moderator comments in database...');
    console.log('=' .repeat(60));
    
    // Initialize moderator detection service
    const moderatorDetection = new ModeratorDetectionService();
    await moderatorDetection.initialize();
    
    // Get all unique authors from comments
    console.log('📊 Getting all comment authors...');
    const authorsResult = await pool.query(`
      SELECT DISTINCT author 
      FROM comments 
      WHERE author != '[deleted]' 
      ORDER BY author
    `);
    
    console.log(`Found ${authorsResult.rows.length} unique authors`);
    
    // Check which authors are moderators
    console.log('🔍 Checking moderator status for each author...');
    const moderatorAuthors = [];
    
    for (const row of authorsResult.rows) {
      const author = row.author;
      const isModerator = await moderatorDetection.isModerator(author);
      
      if (isModerator) {
        moderatorAuthors.push(author);
        console.log(`✅ ${author} is a moderator`);
      }
    }
    
    console.log(`\n🎯 Found ${moderatorAuthors.length} moderators: ${moderatorAuthors.join(', ')}`);
    
    if (moderatorAuthors.length === 0) {
      console.log('❌ No moderators found. Check your moderator detection service.');
      return;
    }
    
    // Update comments for each moderator
    let totalUpdated = 0;
    
    for (const moderator of moderatorAuthors) {
      console.log(`\n🔄 Updating comments for moderator: ${moderator}`);
      
      const updateResult = await pool.query(`
        UPDATE comments 
        SET distinguished = 'moderator'
        WHERE author = $1 AND (distinguished IS NULL OR distinguished != 'moderator')
      `, [moderator]);
      
      console.log(`✅ Updated ${updateResult.rowCount} comments for ${moderator}`);
      totalUpdated += updateResult.rowCount;
    }
    
    // Show summary
    console.log('\n📊 Update Summary:');
    console.log('=' .repeat(60));
    console.log(`Total moderators found: ${moderatorAuthors.length}`);
    console.log(`Total comments updated: ${totalUpdated}`);
    
    // Verify the update
    console.log('\n🔍 Verification:');
    const verifyResult = await pool.query(`
      SELECT 
        author,
        COUNT(*) as total_comments,
        COUNT(CASE WHEN distinguished = 'moderator' THEN 1 END) as moderator_comments
      FROM comments 
      WHERE author = ANY($1)
      GROUP BY author
      ORDER BY author
    `, [moderatorAuthors]);
    
    verifyResult.rows.forEach(row => {
      console.log(`${row.author}: ${row.moderator_comments}/${row.total_comments} comments marked as moderator`);
    });
    
    // Show some examples
    console.log('\n📋 Sample updated comments:');
    const sampleResult = await pool.query(`
      SELECT id, author, body, distinguished, created_at
      FROM comments 
      WHERE distinguished = 'moderator'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    sampleResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.author}: "${row.body.substring(0, 50)}..."`);
      console.log(`   Created: ${row.created_at}`);
      console.log(`   Distinguished: ${row.distinguished}`);
      console.log();
    });
    
  } catch (error) {
    console.error('❌ Error updating moderator comments:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('update_moderator_comments.js')) {
  updateExistingModeratorComments()
    .then(() => {
      console.log('✅ Moderator comment update completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Moderator comment update failed:', error);
      process.exit(1);
    });
}

export { updateExistingModeratorComments };
