import { createDbConnection, query } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

async function getPostsFromFirstOfMonth2025() {
    let pool = null;
    
    try {
        console.log('📡 Connecting to database...');
        pool = await createDbConnection();
        console.log('✅ Connected successfully');
        
        // Define the 1st of each month in 2025 (UTC timestamps)
        const firstOfMonthDates = [
            { month: 'January', timestamp: 1735689600 },    // 2025-01-01 00:00:00 UTC
            { month: 'February', timestamp: 1738368000 },   // 2025-02-01 00:00:00 UTC
            { month: 'March', timestamp: 1740787200 },      // 2025-03-01 00:00:00 UTC
            { month: 'April', timestamp: 1743465600 },      // 2025-04-01 00:00:00 UTC
            { month: 'May', timestamp: 1746057600 },        // 2025-05-01 00:00:00 UTC
            { month: 'June', timestamp: 1748736000 },       // 2025-06-01 00:00:00 UTC
            { month: 'July', timestamp: 1751328000 },       // 2025-07-01 00:00:00 UTC
            { month: 'August', timestamp: 1754006400 },     // 2025-08-01 00:00:00 UTC
            { month: 'September', timestamp: 1756684800 },  // 2025-09-01 00:00:00 UTC
            { month: 'October', timestamp: 1759276800 },    // 2025-10-01 00:00:00 UTC
            { month: 'November', timestamp: 1761955200 },    // 2025-11-01 00:00:00 UTC
            { month: 'December', timestamp: 1764547200 }     // 2025-12-01 00:00:00 UTC
        ];
        
        console.log('\n🔍 Searching for posts from the 1st of each month in 2025...\n');
        
        const results = [];
        
        for (const dateInfo of firstOfMonthDates) {
            const nextMonthTimestamp = dateInfo.timestamp + (30 * 24 * 60 * 60); // Add ~30 days
            
            const queryText = `
                SELECT id, created_utc, title, author, score, num_comments
                FROM posts 
                WHERE created_utc >= $1 AND created_utc < $2
                ORDER BY created_utc ASC
                LIMIT 1
            `;
            
            try {
                const result = await query(queryText, [dateInfo.timestamp, nextMonthTimestamp]);
                
                if (result.rows.length > 0) {
                    const post = result.rows[0];
                    const postDate = new Date(post.created_utc * 1000).toISOString();
                    
                    console.log(`📅 ${dateInfo.month} 1st, 2025:`);
                    console.log(`   Post ID: ${post.id}`);
                    console.log(`   Title: ${post.title}`);
                    console.log(`   Author: ${post.author}`);
                    console.log(`   Score: ${post.score}`);
                    console.log(`   Comments: ${post.num_comments}`);
                    console.log(`   Created: ${postDate}`);
                    console.log('');
                    
                    results.push({
                        month: dateInfo.month,
                        postId: post.id,
                        title: post.title,
                        author: post.author,
                        score: post.score,
                        numComments: post.num_comments,
                        createdUtc: post.created_utc,
                        createdDate: postDate
                    });
                } else {
                    console.log(`📅 ${dateInfo.month} 1st, 2025: No posts found`);
                    console.log('');
                    
                    results.push({
                        month: dateInfo.month,
                        postId: null,
                        message: 'No posts found'
                    });
                }
            } catch (error) {
                console.error(`❌ Error querying ${dateInfo.month}:`, error.message);
                results.push({
                    month: dateInfo.month,
                    error: error.message
                });
            }
        }
        
        console.log('\n📊 Summary:');
        console.log('='.repeat(50));
        
        const foundPosts = results.filter(r => r.postId);
        const notFound = results.filter(r => !r.postId && !r.error);
        
        console.log(`✅ Posts found: ${foundPosts.length}/12 months`);
        console.log(`❌ No posts found: ${notFound.length}/12 months`);
        
        if (foundPosts.length > 0) {
            console.log('\n📋 Post IDs found:');
            foundPosts.forEach(result => {
                console.log(`${result.month}: ${result.postId}`);
            });
        }
        
        return results;
        
    } catch (error) {
        console.error('❌ Database error:', error);
        throw error;
    } finally {
        if (pool) {
            await pool.end();
            console.log('\n📴 Database connection closed');
        }
    }
}

// Run the query
getPostsFromFirstOfMonth2025()
    .then(results => {
        console.log('\n✅ Query completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });
