import dotenv from 'dotenv';
import RedditService from './src/reddit.js';
import AnalysisService from './src/analyze.js';
import KPIService from './src/kpi.js';
import SlackService from './src/slack.js';
import GroqService from './src/groq.js';
import FilterService from './src/filter.js';
import { createDbConnection, closeDb, healthCheck } from './src/db.js';
import { validateAnalysis, getDefaultAnalysis } from './src/prompts.js';

dotenv.config();

class AIBotTester {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
    
    // Initialize services with error handling
    try {
      this.reddit = new RedditService();
      this.analysis = new AnalysisService();
      this.kpi = new KPIService();
      this.slack = new SlackService();
      this.groq = new GroqService();
      this.filter = new FilterService();
      console.log('✅ All services initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize services:', error.message);
      throw error;
    }
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const emoji = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} [${timestamp}] ${message}`);
  }

  addResult(testName, success, message, data = null) {
    this.testResults.push({
      testName,
      success,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Test 1: Environment configuration
  async testConfiguration() {
    this.log('🔧 Testing environment configuration...', 'info');
    
    try {
      const requiredEnvVars = [
        'PGHOST',
        'PGDATABASE', 
        'PGUSER',
        'PGPASSWORD',
        'REDDIT_CLIENT_ID',
        'REDDIT_CLIENT_SECRET',
        'REDDIT_REFRESH_TOKEN',
        'GROQ_API_KEY',
        'SLACK_BOT_TOKEN',
        'SLACK_CHANNEL_ID'
      ];

      const missing = requiredEnvVars.filter(varName => !process.env[varName]);
      const warnings = [];

      // Check optional variables
      if (!process.env.REDDIT_USERNAME) warnings.push('REDDIT_USERNAME (fallback auth)');
      if (!process.env.REDDIT_PASSWORD) warnings.push('REDDIT_PASSWORD (fallback auth)');

      if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
      }

      let message = 'All required environment variables present';
      if (warnings.length > 0) {
        message += ` (Optional: ${warnings.join(', ')})`;
      }

      this.log('Configuration validation passed', 'success');
      this.addResult('Configuration', true, message, {
        requiredVars: requiredEnvVars.length,
        missingVars: missing.length,
        optionalWarnings: warnings
      });
      return true;
    } catch (error) {
      this.log(`Configuration test failed: ${error.message}`, 'error');
      this.addResult('Configuration', false, error.message);
      return false;
    }
  }

  // Test 2: Database connection and health
  async testDatabaseConnection() {
    this.log('🗄️ Testing database connection...', 'info');
    
    try {
      const pool = await createDbConnection();
      const health = await healthCheck();

      if (health.status !== 'healthy') {
        throw new Error(`Database health check failed: ${health.error}`);
      }

      this.log('Database connection successful', 'success');
      this.addResult('Database Connection', true, 'Successfully connected to PostgreSQL', {
        status: health.status,
        timestamp: health.timestamp,
        version: health.version
      });
      return true;
    } catch (error) {
      this.log(`Database connection test failed: ${error.message}`, 'error');
      this.addResult('Database Connection', false, error.message);
      return false;
    }
  }

  // Test 3: Database schema verification
  async testDatabaseSchema() {
    this.log('📋 Testing database schema...', 'info');
    
    try {
      const pool = await createDbConnection();
      
      // Check if all required tables exist
      const tableCheck = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('posts', 'comments', 'analyses_post', 'analyses_comment')
        ORDER BY table_name;
      `);

      const expectedTables = ['analyses_comment', 'analyses_post', 'comments', 'posts'];
      const existingTables = tableCheck.rows.map(row => row.table_name);

      const missingTables = expectedTables.filter(table => !existingTables.includes(table));

      if (missingTables.length > 0) {
        throw new Error(`Missing database tables: ${missingTables.join(', ')}`);
      }

      // Check table structure for posts table
      const postsColumns = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'posts' AND table_schema = 'public'
        ORDER BY ordinal_position;
      `);

      const requiredColumns = ['id', 'created_utc', 'title', 'body', 'author', 'permalink'];
      const existingColumns = postsColumns.rows.map(row => row.column_name);
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));

      if (missingColumns.length > 0) {
        throw new Error(`Missing columns in posts table: ${missingColumns.join(', ')}`);
      }

      this.log('Database schema validation passed', 'success');
      this.addResult('Database Schema', true, 'All required tables and columns exist', {
        tables: existingTables,
        postsColumns: postsColumns.rows.length
      });
      return true;
    } catch (error) {
      this.log(`Database schema test failed: ${error.message}`, 'error');
      this.addResult('Database Schema', false, error.message);
      return false;
    }
  }

  // Test 4: Reddit API connection
  async testRedditAPI() {
    this.log('🔗 Testing Reddit API connection...', 'info');
    
    try {
      // Test basic Reddit connection
      const posts = await this.reddit.fetchPostsForTimeWindow(
        Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        Math.floor(Date.now() / 1000)
      );

      this.log(`Successfully connected to Reddit API - Found ${posts.length} posts in test window`, 'success');
      this.addResult('Reddit API', true, `Connected successfully, found ${posts.length} posts in 1-hour test window`, {
        postCount: posts.length,
        subreddit: process.env.SUBREDDIT || 'faceit'
      });
      return true;
    } catch (error) {
      this.log(`Reddit API test failed: ${error.message}`, 'error');
      this.addResult('Reddit API', false, error.message);
      return false;
    }
  }

  // Test 5: Groq AI API connection and analysis
  async testGroqAI() {
    this.log('🤖 Testing Groq AI API...', 'info');
    
    try {
      // Test basic Groq connection with health check
      const healthResult = await this.groq.healthCheck();

      if (healthResult.status !== 'healthy') {
        throw new Error(`Groq API health check failed: ${healthResult.error}`);
      }

      // Test actual analysis with sample content
      const testPost = {
        title: 'FACEIT anti-cheat keeps crashing my game',
        body: 'Every time I try to play on FACEIT, the anti-cheat software crashes my CS2. This has been happening for weeks and I can\'t play ranked matches. Anyone else having this issue?',
        link_flair_text: 'Technical Issue',
        num_comments: 5
      };

      const result = await this.groq.chatJSONWithRetry({
        system: 'You are a helpful assistant. Respond with valid JSON containing {"status": "ok", "test": true}.',
        user: `Analyze this post: ${testPost.title}`,
        max_tokens: 100,
        temperature: 0
      });

      if (!result || !result.json) {
        throw new Error('Groq API returned invalid response');
      }

      this.log('Groq AI API test passed', 'success');
      this.addResult('Groq AI API', true, 'Successfully connected and analyzed test content', {
        model: healthResult.model,
        tokensUsed: result.usage.total_tokens,
        cost: result.usage.cost_usd
      });
      return true;
    } catch (error) {
      this.log(`Groq AI test failed: ${error.message}`, 'error');
      this.addResult('Groq AI API', false, error.message);
      return false;
    }
  }

  // Test 6: Analysis validation and sanitization
  async testAnalysisValidation() {
    this.log('🔍 Testing analysis validation...', 'info');
    
    try {
      // Test valid post analysis
      const validPostAnalysis = {
        intent: 'help',
        target: 'faceit',
        sentiment: 'neg',
        departments: ['anti_cheat', 'technical_client'],
        summary: 'User experiencing anti-cheat crashes',
        key_issues: ['anti-cheat crashes', 'cannot play matches']
      };

      const validResult = validateAnalysis(validPostAnalysis, 'post');
      if (!validResult.isValid) {
        throw new Error(`Valid analysis failed validation: ${validResult.errors.join(', ')}`);
      }

      // Test invalid analysis and sanitization
      const invalidAnalysis = {
        intent: 'invalid_intent',
        target: 'faceit',
        sentiment: 'invalid_sentiment',
        departments: 'not_an_array',
        summary: 'Test summary',
        key_issues: 'not_an_array'
      };

      const invalidResult = validateAnalysis(invalidAnalysis, 'post');
      if (invalidResult.isValid) {
        throw new Error('Invalid analysis passed validation when it should have failed');
      }

      // Test default analysis generation
      const defaultAnalysis = getDefaultAnalysis('post');
      const defaultResult = validateAnalysis(defaultAnalysis, 'post');
      if (!defaultResult.isValid) {
        throw new Error(`Default analysis is invalid: ${defaultResult.errors.join(', ')}`);
      }

      this.log('Analysis validation test passed', 'success');
      this.addResult('Analysis Validation', true, 'Successfully validated analysis formats and sanitization', {
        validationPassed: validResult.isValid,
        invalidationWorked: !invalidResult.isValid,
        defaultAnalysisValid: defaultResult.isValid,
        errorCount: invalidResult.errors.length
      });
      return true;
    } catch (error) {
      this.log(`Analysis validation test failed: ${error.message}`, 'error');
      this.addResult('Analysis Validation', false, error.message);
      return false;
    }
  }

  // Test 7: Slack API connection
  async testSlackAPI() {
    this.log('💬 Testing Slack API connection...', 'info');
    
    try {
      const healthResult = await this.slack.healthCheck();

      if (healthResult.status !== 'healthy') {
        throw new Error(`Slack API health check failed: ${healthResult.error}`);
      }

      this.log('Slack API connection successful', 'success');
      this.addResult('Slack API', true, 'Successfully connected to Slack', {
        botId: healthResult.botId,
        userId: healthResult.userId,
        team: healthResult.team
      });
      return true;
    } catch (error) {
      this.log(`Slack API test failed: ${error.message}`, 'error');
      this.addResult('Slack API', false, error.message);
      return false;
    }
  }

  // Test 8: Filter service functionality
  async testFilterService() {
    this.log('🔍 Testing filter service...', 'info');
    
    try {
      const config = this.filter.getConfig();
      
      // Test with sample posts
      const testPosts = [
        {
          title: 'FACEIT anti-cheat issue',
          body: 'Having problems with the anti-cheat',
          link_flair_text: 'Technical Issue'
        },
        {
          title: 'Great match last night',
          body: 'Had an amazing valorant game',
          link_flair_text: 'Discussion'
        },
        {
          title: 'Need help with matchmaking',
          body: 'Matchmaking is not working properly',
          link_flair_text: 'Help'
        }
      ];

      const filterResult = this.filter.filterPosts(testPosts);

      this.log(`Filter test completed: ${filterResult.stats.accepted}/${filterResult.stats.total} posts accepted`, 'success');
      this.addResult('Filter Service', true, `Successfully filtered posts`, {
        totalPosts: filterResult.stats.total,
        acceptedPosts: filterResult.stats.accepted,
        rejectedPosts: filterResult.stats.rejected,
        includeKeywords: config.includeCount,
        excludeKeywords: config.excludeCount
      });
      return true;
    } catch (error) {
      this.log(`Filter service test failed: ${error.message}`, 'error');
      this.addResult('Filter Service', false, error.message);
      return false;
    }
  }

  // Test 9: End-to-end analysis workflow
  async testAnalysisWorkflow() {
    this.log('⚙️ Testing end-to-end analysis workflow...', 'info');
    
    try {
      // Create a test post in database
      const testPost = {
        id: `test_${Date.now()}`,
        created_utc: Math.floor(Date.now() / 1000),
        title: 'Test FACEIT anti-cheat problem',
        body: 'I need help with anti-cheat issues causing crashes',
        author: 'test_user',
        permalink: '/r/faceit/test_post',
        link_flair_text: 'Help',
        score: 10,
        upvote_ratio: 0.8,
        approx_upvotes: 8,
        approx_downvotes: 2,
        num_comments: 3
      };

      // Save test post
      await this.reddit.savePost(testPost);

      // Run analysis on the test post
      const startTime = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const endTime = Math.floor(Date.now() / 1000) + 60;   // 1 minute from now

      // This will analyze our test post
      await this.analysis.analyzePosts(startTime, endTime);

      // Verify analysis was saved
      const pool = await createDbConnection();
      const analysisCheck = await pool.query(
        'SELECT * FROM analyses_post WHERE post_id = $1',
        [testPost.id]
      );

      if (analysisCheck.rows.length === 0) {
        throw new Error('Analysis was not saved to database');
      }

      const analysis = analysisCheck.rows[0];

      // Clean up test data
      await pool.query('DELETE FROM analyses_post WHERE post_id = $1', [testPost.id]);
      await pool.query('DELETE FROM posts WHERE id = $1', [testPost.id]);

      this.log('End-to-end analysis workflow test passed', 'success');
      this.addResult('Analysis Workflow', true, 'Successfully completed full analysis workflow', {
        postId: testPost.id,
        analysisIntent: analysis.intent,
        analysisSentiment: analysis.sentiment,
        analysisTarget: analysis.target,
        tokensCost: parseFloat(analysis.llm_cost_usd)
      });
      return true;
    } catch (error) {
      this.log(`Analysis workflow test failed: ${error.message}`, 'error');
      this.addResult('Analysis Workflow', false, error.message);
      return false;
    }
  }

  // Test 10: KPI report generation
  async testKPIGeneration() {
    this.log('📊 Testing KPI report generation...', 'info');
    
    try {
      // Generate a test report for the last 24 hours
      const report = await this.kpi.buildReport('daily');

      if (!report || !report.metadata) {
        throw new Error('Invalid report structure generated');
      }

      // Verify report structure
      const requiredSections = ['metadata', 'volume', 'intent', 'sentiment', 'departments', 'examples', 'trends'];
      const missingSections = requiredSections.filter(section => !(section in report));

      if (missingSections.length > 0) {
        throw new Error(`Report missing sections: ${missingSections.join(', ')}`);
      }

      this.log('KPI report generation test passed', 'success');
      this.addResult('KPI Generation', true, 'Successfully generated comprehensive KPI report', {
        window: report.metadata.window,
        postsAnalyzed: report.volume.posts,
        commentsAnalyzed: report.volume.comments,
        uniqueAuthors: report.volume.uniqueAuthors,
        topDepartments: report.departments.slice(0, 3).map(d => d.department),
        filteringEnabled: report.metadata.useKeywordFilter
      });
      return true;
    } catch (error) {
      this.log(`KPI generation test failed: ${error.message}`, 'error');
      this.addResult('KPI Generation', false, error.message);
      return false;
    }
  }

  // Test 11: Slack report sending (sends actual message by default)
  async testSlackReportSending(skipActualReport = false) {
    this.log('📤 Testing Slack report sending...', 'info');
    
    try {
      if (skipActualReport) {
        // Just test the report building without sending
        const testReport = {
          metadata: {
            window: 'test',
            period: {
              start: new Date(Date.now() - 86400000).toISOString(),
              end: new Date().toISOString()
            },
            generatedAt: new Date().toISOString()
          },
          volume: { posts: 5, comments: 15, uniqueAuthors: 8 },
          intent: { posts: [{ intent: 'help', count: 3 }, { intent: 'comment', count: 2 }] },
          sentiment: { 
            posts: [{ sentiment: 'neg', count: 2 }, { sentiment: 'neu', count: 2 }, { sentiment: 'pos', count: 1 }],
            comments: [{ sentiment: 'neg', count: 5 }, { sentiment: 'neu', count: 7 }, { sentiment: 'pos', count: 3 }]
          },
          departments: [{ department: 'anti_cheat', count: 3 }, { department: 'technical_client', count: 2 }],
          topPost: {
            title: 'Test post title',
            author: 'test_user',
            score: 15,
            numComments: 8,
            url: 'https://reddit.com/r/faceit/test'
          },
          examples: { positive: [], negative: [] },
          trends: [{ issue: 'anti-cheat crashes', count: 3 }]
        };

        // Test report block building
        const blocks = this.slack.buildReportBlocks(testReport);
        
        if (!blocks || blocks.length === 0) {
          throw new Error('No report blocks generated');
        }

        this.log('Slack report formatting test passed (no message sent)', 'success');
        this.addResult('Slack Report', true, 'Successfully formatted report for Slack (test mode)', {
          blockCount: blocks.length,
          testMode: true
        });
      } else {
        // Generate and send actual report
        this.log('Generating actual KPI report for Slack...', 'info');
        const report = await this.kpi.buildReport('daily');
        
        this.log('Sending report to Slack...', 'info');
        const result = await this.slack.sendReport(report);

        if (!result || !result.ok) {
          throw new Error('Failed to send report to Slack');
        }

        this.log('✅ Slack report sent successfully!', 'success');
        this.addResult('Slack Report', true, 'Successfully sent actual report to Slack', {
          messageTs: result.ts,
          channel: result.channel,
          testMode: false
        });
      }
      
      return true;
    } catch (error) {
      this.log(`Slack report test failed: ${error.message}`, 'error');
      this.addResult('Slack Report', false, error.message);
      return false;
    }
  }

  // Generate comprehensive test report
  generateReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    this.log('\n📊 COMPREHENSIVE AI BOT TEST REPORT', 'info');
    this.log('=' .repeat(60), 'info');
    
    const successCount = this.testResults.filter(r => r.success).length;
    const totalTests = this.testResults.length;
    const successRate = ((successCount / totalTests) * 100).toFixed(1);

    this.log(`Test Duration: ${duration} seconds`, 'info');
    this.log(`Overall Success Rate: ${successCount}/${totalTests} (${successRate}%)`, 
      successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'error');
    
    this.log('\nDetailed Results:', 'info');
    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      this.log(`${index + 1}. ${result.testName}: ${status}`, result.success ? 'success' : 'error');
      this.log(`   ${result.message}`, 'info');
      
      if (result.data && Object.keys(result.data).length > 0) {
        // Show only key metrics to avoid clutter
        const keyData = {};
        Object.keys(result.data).forEach(key => {
          if (typeof result.data[key] !== 'object' || Array.isArray(result.data[key])) {
            keyData[key] = result.data[key];
          }
        });
        if (Object.keys(keyData).length > 0) {
          this.log(`   Key metrics: ${JSON.stringify(keyData)}`, 'info');
        }
      }
    });

    // System recommendations
    this.log('\n💡 System Status & Recommendations:', 'info');
    const failedTests = this.testResults.filter(r => !r.success);
    
    if (failedTests.length === 0) {
      this.log('🎉 All tests passed! Your AI analysis bot is ready for production deployment.', 'success');
      this.log('✅ Database schema is correct', 'success');
      this.log('✅ All API connections are working', 'success');
      this.log('✅ Analysis pipeline is functional', 'success');
      this.log('✅ Reporting system is operational', 'success');
    } else {
      this.log('⚠️ Some components need attention:', 'warning');
      
      failedTests.forEach(test => {
        if (test.testName === 'Database Connection') {
          this.log('• Check your PostgreSQL connection settings in .env', 'warning');
          this.log('• Ensure your AWS Lightsail database is running', 'warning');
        } else if (test.testName === 'Database Schema') {
          this.log('• Run: npm run initdb to create required tables', 'warning');
        } else if (test.testName === 'Reddit API') {
          this.log('• Verify REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env', 'warning');
          this.log('• Check REDDIT_REFRESH_TOKEN is valid', 'warning');
        } else if (test.testName === 'Groq AI API') {
          this.log('• Verify GROQ_API_KEY in .env file', 'warning');
          this.log('• Check Groq API service status', 'warning');
        } else if (test.testName === 'Slack API') {
          this.log('• Verify SLACK_BOT_TOKEN in .env file', 'warning');
          this.log('• Ensure bot has required permissions', 'warning');
        }
      });
    }

    // Performance insights
    this.log('\n📈 Performance Insights:', 'info');
    const groqResult = this.testResults.find(r => r.testName === 'Groq AI API');
    if (groqResult && groqResult.success && groqResult.data) {
      this.log(`• AI Analysis Cost: $${groqResult.data.cost?.toFixed(6) || '0.000000'} per request`, 'info');
      this.log(`• Token Usage: ${groqResult.data.tokensUsed || 'N/A'} tokens per analysis`, 'info');
    }

    const dbResult = this.testResults.find(r => r.testName === 'Database Connection');
    if (dbResult && dbResult.success) {
      this.log('• Database connection is stable and ready for high-volume operations', 'info');
    }

    return {
      totalTests,
      successCount,
      successRate: parseFloat(successRate),
      duration: parseFloat(duration),
      results: this.testResults,
      recommendations: failedTests.map(test => ({
        component: test.testName,
        issue: test.message
      }))
    };
  }

  // Run all tests
  async runAllTests(options = {}) {
    const { skipSlackReport = false } = options;
    
    this.log('🚀 Starting comprehensive AI bot testing...', 'info');
    this.log('=' .repeat(60), 'info');

    const tests = [
      () => this.testConfiguration(),
      () => this.testDatabaseConnection(),
      () => this.testDatabaseSchema(),
      () => this.testRedditAPI(),
      () => this.testGroqAI(),
      () => this.testAnalysisValidation(),
      () => this.testSlackAPI(),
      () => this.testFilterService(),
      () => this.testAnalysisWorkflow(),
      () => this.testKPIGeneration(),
      () => this.testSlackReportSending(skipSlackReport)
    ];

    let completedTests = 0;

    for (let i = 0; i < tests.length; i++) {
      try {
        this.log(`\n[${i + 1}/${tests.length}] Running test...`, 'info');
        await tests[i]();
        completedTests++;
        
        // Delay between tests to avoid rate limiting
        if (i < tests.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        this.log(`Unexpected error in test ${i + 1}: ${error.message}`, 'error');
        this.addResult(`Test ${i + 1}`, false, `Unexpected error: ${error.message}`);
      }
    }

    this.log(`\n✅ Completed ${completedTests}/${tests.length} tests`, 'info');

    return this.generateReport();
  }

  // Cleanup method
  async cleanup() {
    try {
      await closeDb();
      this.log('🧹 Cleanup completed', 'info');
    } catch (error) {
      this.log(`⚠️ Cleanup warning: ${error.message}`, 'warning');
    }
  }
}

// Run tests if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1].endsWith('test-ai-bot.js') ||
                     process.argv[1].includes('test-ai-bot');

if (isMainModule) {
  console.log('🚀 Starting AI Bot Test Suite...');
  
  let tester;
  try {
    tester = new AIBotTester();
  } catch (error) {
    console.error('❌ Failed to initialize test suite:', error.message);
    console.error('💡 Check your environment variables and service configurations');
    process.exit(1);
  }
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const skipSlackReport = args.includes('--no-slack-report');
  
  if (skipSlackReport) {
    console.log('ℹ️ --no-slack-report flag detected: Will skip sending actual report to Slack');
  } else {
    console.log('📤 Will send actual report to Slack (use --no-slack-report to skip)');
  }
  
  tester.runAllTests({ skipSlackReport })
    .then(async (report) => {
      await tester.cleanup();
      
      console.log('\n🏁 AI Bot testing completed!');
      
      if (report.successRate >= 90) {
        console.log('🎉 AI Bot is ready for production deployment!');
        process.exit(0);
      } else if (report.successRate >= 70) {
        console.log('⚠️ AI Bot has some issues but core functionality works. Address warnings before full deployment.');
        process.exit(0);
      } else {
        console.log('❌ AI Bot has critical issues. Please fix failed tests before deployment.');
        process.exit(1);
      }
    })
    .catch(async (error) => {
      await tester.cleanup();
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

export default AIBotTester;
