import { ReportCreator } from './report_creator.js';
import { postReportAsPNG } from './send-to-slack.js';
import { closeDb } from './db.js';

/**
 * Example usage of PNG report generation
 * This shows how to use the new PNG report functionality
 */

async function exampleUsage() {
  try {
    console.log('📊 Example: Generating PNG Report\n');
    
    // Step 1: Generate a report using the existing ReportCreator
    const reportCreator = new ReportCreator();
    
    // Generate a daily report with specific categories
    const report = await reportCreator.generateReport(
      'daily',           // period
      null,              // startDate (null = use period default)
      null,              // endDate (null = use period default)
      'console',         // outputFormat (not used for PNG)
      false,             // postToSlack (we'll do this manually)
      ['cheaters', 'technical_client'] // categories to filter
    );
    
    console.log('✅ Report generated with data:', {
      totalPosts: report.summary.total_posts,
      categories: report.categories.length,
      sentiments: report.sentiments.length
    });
    
    // Step 2: Post as PNG to Slack
    if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
      console.log('\n🎨 Posting PNG report to Slack...');
      
      const result = await postReportAsPNG(
        report,                    // report data
        process.env.SLACK_CHANNEL_ID, // channel ID
        'daily',                   // period
        ['cheaters', 'technical_client'] // categories
      );
      
      console.log('✅ PNG report posted successfully!', {
        fileId: result.fileId,
        filename: result.filename,
        channelId: result.channelId
      });
    } else {
      console.log('\n⚠️  Skipping Slack upload (missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID)');
    }
    
  } catch (error) {
    console.error('❌ Example failed:', error);
  } finally {
    await closeDb();
  }
}

// Usage examples for different scenarios:

/**
 * Example 1: Daily report with all posts
 */
async function dailyReportExample() {
  const reportCreator = new ReportCreator();
  const report = await reportCreator.generateReport('daily');
  
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
    await postReportAsPNG(report, process.env.SLACK_CHANNEL_ID, 'daily');
  }
}

/**
 * Example 2: Weekly report filtered by cheating categories
 */
async function weeklyCheatingReportExample() {
  const reportCreator = new ReportCreator();
  const report = await reportCreator.generateReport(
    'weekly', 
    null, 
    null, 
    'console', 
    false, 
    ['cheaters', 'anti_cheat', 'smurfs']
  );
  
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
    await postReportAsPNG(
      report, 
      process.env.SLACK_CHANNEL_ID, 
      'weekly', 
      ['cheaters', 'anti_cheat', 'smurfs']
    );
  }
}

/**
 * Example 3: Monthly report for specific month
 */
async function monthlyReportExample() {
  const reportCreator = new ReportCreator();
  
  // Generate report for September 2024
  const report = await reportCreator.generateReport(
    'monthly',
    new Date('2024-09-01'),
    new Date('2024-09-30'),
    'console',
    false,
    ['technical_client', 'platform_website']
  );
  
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
    await postReportAsPNG(
      report,
      process.env.SLACK_CHANNEL_ID,
      'monthly',
      ['technical_client', 'platform_website']
    );
  }
}

// Run the main example
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleUsage();
}

export {
  dailyReportExample,
  weeklyCheatingReportExample,
  monthlyReportExample
};
