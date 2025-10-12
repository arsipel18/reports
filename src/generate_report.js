import dotenv from 'dotenv';
import { ReportCreator } from './report_creator.js';

dotenv.config();

/**
 * Simple report generation script
 * Usage examples:
 * node src/generate_report.js daily console
 * node src/generate_report.js weekly json
 * node src/generate_report.js monthly console slack
 * node src/generate_report.js quarterly console --slack
 * node src/generate_report.js yearly console
 * node src/generate_report.js daily console cheating verification
 * node src/generate_report.js weekly console smurfs anti_cheat --slack
 */

async function main() {
  const args = process.argv.slice(2);
  const period = args[0] || 'daily';
  const format = args[1] || 'console';
  const postToSlack = args.includes('--slack') || args.includes('slack');
  
  // Extract categories (all arguments that are not flags or known values)
  const categories = args.filter(arg => 
    !arg.startsWith('--') && 
    !['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'].includes(arg) &&
    !['console', 'json', 'csv'].includes(arg) &&
    !['slack'].includes(arg)
  );
  
  console.log(`🚀 Generating ${period} report in ${format} format${postToSlack ? ' and posting to Slack' : ''}${categories.length > 0 ? ` with categories: ${categories.join(', ')}` : ''}...`);
  
  try {
    const creator = new ReportCreator();
    await creator.generateReport(period, null, null, format, postToSlack, categories);
    
    console.log(`\n✅ ${period} report generated successfully!`);
    
  } catch (error) {
    console.error('❌ Report generation failed:', error.message);
    process.exit(1);
  }
}

main();
