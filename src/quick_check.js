import dotenv from 'dotenv';
dotenv.config();

console.log('🚀 Quick System Check');
console.log('='.repeat(50));

// 1. Environment Variables
console.log('\n📋 Environment Variables:');
const requiredVars = [
    'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_REFRESH_TOKEN',
    'GROQ_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'
];

let allEnvSet = true;
for (const varName of requiredVars) {
    if (process.env[varName]) {
        console.log(`✅ ${varName}`);
    } else {
        console.log(`❌ ${varName} - MISSING`);
        allEnvSet = false;
    }
}

// 2. Database Quick Check
console.log('\n🗄️ Database:');
try {
    const { createDbConnection, closeDb } = await import('./db.js');
    
    // Very quick database test with short timeout
    const dbTest = async () => {
        const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), 5000)
        );
        
        const pool = await Promise.race([createDbConnection(), timeout]);
        const result = await Promise.race([
            pool.query('SELECT 1 as test'),
            timeout
        ]);
        await closeDb();
        return result;
    };
    
    await dbTest();
    console.log('✅ Database connection working');
} catch (error) {
    console.log(`❌ Database connection failed: ${error.message}`);
    allEnvSet = false;
}

// 3. Module Imports
console.log('\n📦 Core Modules:');
const modules = [
    { name: 'Google AI', path: './google_ai.js' },
    { name: 'Slack', path: './slack.js' },
    { name: 'Reddit Fetcher', path: './reddit_fetcher.js' },
    { name: 'AI Analyzer', path: './ai_analyzer.js' }
];

for (const mod of modules) {
    try {
        await import(mod.path);
        console.log(`✅ ${mod.name}`);
    } catch (error) {
        console.log(`❌ ${mod.name}: ${error.message}`);
        allEnvSet = false;
    }
}

// 4. File System
console.log('\n📁 Required Files:');
const fs = await import('fs');
const files = [
    'src/schedule.js',
    'src/reddit_fetcher.js', 
    'src/ai_analyzer.js'
];

for (const file of files) {
    try {
        await fs.promises.access(file);
        console.log(`✅ ${file}`);
    } catch {
        console.log(`❌ ${file} - MISSING`);
        allEnvSet = false;
    }
}

// Summary
console.log('\n' + '='.repeat(50));
if (allEnvSet) {
    console.log('🎉 SYSTEM READY!');
    console.log('\nNext steps:');
    console.log('  node src/schedule.js        # Start full scheduler');
    console.log('  node src/test_scheduler.js  # Test all scheduler tasks');
    console.log('  node src/test_without_ai.js # Test reports only (no AI)');
    console.log('  node src/quick_test.js      # Quick test (daily + fetch)');
    console.log('  node src/reddit_fetcher.js  # Test Reddit fetch only');
    console.log('  node src/ai_analyzer.js     # Test AI analysis only');
    console.log('  node src/reset_database.js  # Reset database if needed');
} else {
    console.log('❌ SYSTEM NOT READY');
    console.log('\nFixes needed:');
    console.log('  1. Check .env file for missing variables');
    console.log('  2. Verify database connectivity');
    console.log('  3. Install missing dependencies: npm install');
}
console.log('='.repeat(50));

process.exit(allEnvSet ? 0 : 1);
