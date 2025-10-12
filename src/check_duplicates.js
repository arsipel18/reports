import dotenv from 'dotenv';
import { createDbConnection, closeDb } from './db.js';

dotenv.config();

console.log('🔍 Simple Duplicate Check');

async function simpleCheck() {
    let pool = null;
    
    try {
        console.log('📡 Connecting...');
        pool = await createDbConnection();
        console.log('✅ Connected');
        
        // Check duplicate posts
        console.log('\n📝 Checking duplicate posts...');
        const posts = await pool.query(`
            SELECT COUNT(*) as total, COUNT(DISTINCT id) as unique_ids
            FROM posts
        `);
        const postStats = posts.rows[0];
        console.log(`Total posts: ${postStats.total}, Unique IDs: ${postStats.unique_ids}`);
        
        if (postStats.total === postStats.unique_ids) {
            console.log('✅ No duplicate posts found');
        } else {
            console.log(`❌ Found ${postStats.total - postStats.unique_ids} duplicate posts`);
        }
        
        // Check duplicate comments
        console.log('\n💬 Checking duplicate comments...');
        const comments = await pool.query(`
            SELECT COUNT(*) as total, COUNT(DISTINCT id) as unique_ids
            FROM comments
        `);
        const commentStats = comments.rows[0];
        console.log(`Total comments: ${commentStats.total}, Unique IDs: ${commentStats.unique_ids}`);
        
        if (commentStats.total === commentStats.unique_ids) {
            console.log('✅ No duplicate comments found');
        } else {
            console.log(`❌ Found ${commentStats.total - commentStats.unique_ids} duplicate comments`);
        }
        
        // Database stats
        console.log('\n📊 Database Summary:');
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM posts) as posts,
                (SELECT COUNT(*) FROM comments) as comments,
                (SELECT COUNT(*) FROM analyses_post) as post_analyses,
                (SELECT COUNT(*) FROM analyses_comment) as comment_analyses
        `);
        const stat = stats.rows[0];
        console.log(`Posts: ${stat.posts}`);
        console.log(`Comments: ${stat.comments}`);
        console.log(`Post Analyses: ${stat.post_analyses}`);
        console.log(`Comment Analyses: ${stat.comment_analyses}`);
        
        console.log('\n🎉 Check completed successfully!');
        
    } catch (error) {
        console.error('❌ Check failed:', error.message);
    } finally {
        if (pool) {
            await closeDb();
            console.log('📴 Connection closed');
        }
    }
}

simpleCheck();
