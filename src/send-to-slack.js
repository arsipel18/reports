import { WebClient } from "@slack/web-api";
import { renderReportPNG } from "./report-image.js";
import dotenv from 'dotenv';

dotenv.config();

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

/**
 * Post weekly report as PNG image to Slack
 * @param {Object} reportData - Report data from ReportCreator
 * @param {string} channelId - Slack channel ID
 * @param {string} period - Report period (daily, weekly, etc.)
 * @param {Array} categories - Filtered categories if any
 */
export async function postReportAsPNG(reportData, channelId, period = 'daily', categories = []) {
  try {
    console.log(`🎨 Generating PNG report for ${period} period...`);
    
    // Generate the PNG image
    const imageBuffer = await renderReportPNG(reportData);
    
    // Create filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10);
    const categorySuffix = categories.length > 0 ? `-${categories.join('-')}` : '';
    const filename = `${period}-report-${timestamp}${categorySuffix}.png`;
    
    // Create title for the report
    let title = `${period.toUpperCase()} Analysis Report`;
    if (categories.length > 0) {
      title += ` - ${categories.length} Categories`;
    }
    
    // Create initial comment
    let comment = `📊 ${period.toUpperCase()} Analysis Report`;
    if (categories.length > 0) {
      comment += `\n🔍 Filtered Categories: ${categories.map(c => c.replace('_', ' ')).join(', ')}`;
    }
    
    console.log(`📤 Uploading PNG to Slack channel ${channelId}...`);
    
    // Upload to Slack using files.uploadV2
    const result = await slack.files.uploadV2({
      channel_id: channelId,
      filename: filename,
      file: imageBuffer,
      title: title,
      initial_comment: comment,
    });
    
    console.log(`✅ Report PNG uploaded successfully! File ID: ${result.file?.id}`);
    
    return {
      success: true,
      fileId: result.file?.id,
      filename: filename,
      channelId: channelId
    };
    
  } catch (error) {
    console.error('❌ Failed to post report PNG to Slack:', error);
    throw error;
  }
}

/**
 * Post report as PNG with enhanced error handling and retry logic
 * @param {Object} reportData - Report data from ReportCreator
 * @param {string} channelId - Slack channel ID
 * @param {Object} options - Additional options
 */
export async function postReportWithRetry(reportData, channelId, options = {}) {
  const { period = 'daily', categories = [], maxRetries = 3 } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${maxRetries} to post report PNG...`);
      
      const result = await postReportAsPNG(reportData, channelId, period, categories);
      
      if (attempt > 1) {
        console.log(`✅ Report PNG posted successfully on attempt ${attempt}`);
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Failed to post report PNG after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

/**
 * Test function to verify Slack integration
 */
export async function testSlackConnection(channelId) {
  try {
    console.log(`🧪 Testing Slack connection to channel ${channelId}...`);
    
    // Try to get channel info
    const channelInfo = await slack.conversations.info({
      channel: channelId
    });
    
    console.log(`✅ Slack connection successful! Channel: ${channelInfo.channel?.name || 'Unknown'}`);
    return { success: true, channel: channelInfo.channel };
    
  } catch (error) {
    console.error('❌ Slack connection test failed:', error.message);
    throw error;
  }
}
