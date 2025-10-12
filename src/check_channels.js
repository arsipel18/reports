#!/usr/bin/env node

/**
 * Check Channel Configuration
 * Simple script to check which channels are configured for reports
 */

import dotenv from 'dotenv';
import { createDbConnection, closeDb } from './db.js';

dotenv.config();

async function checkChannels() {
  console.log('🔍 CHECKING CHANNEL CONFIGURATION');
  console.log('='.repeat(50));

  let pool;
  
  try {
    // Connect to database
    pool = await createDbConnection();
    console.log('✅ Connected to database');

    // Check channel_configs table
    console.log('\n📱 REGISTERED CHANNELS:');
    console.log('-'.repeat(30));
    
    const channelsResult = await pool.query(`
      SELECT channel_id, channel_name, workspace_id, is_active, created_at
      FROM channel_configs
      ORDER BY created_at DESC
    `);

    if (channelsResult.rows.length === 0) {
      console.log('❌ No channels registered');
      console.log('💡 Use /setup command in Slack to register channels');
      return;
    }

    console.log(`✅ Found ${channelsResult.rows.length} registered channel(s):`);
    channelsResult.rows.forEach((channel, index) => {
      console.log(`  ${index + 1}. #${channel.channel_name}`);
      console.log(`     - Channel ID: ${channel.channel_id}`);
      console.log(`     - Workspace: ${channel.workspace_id}`);
      console.log(`     - Active: ${channel.is_active}`);
      console.log(`     - Created: ${new Date(channel.created_at).toLocaleString()}`);
    });

    // Check channel_report_preferences table
    console.log('\n📊 REPORT PREFERENCES:');
    console.log('-'.repeat(30));
    
    const preferencesResult = await pool.query(`
      SELECT crp.channel_id, cc.channel_name, crp.report_type, crp.report_name, crp.enabled, crp.categories
      FROM channel_report_preferences crp
      JOIN channel_configs cc ON crp.channel_id = cc.channel_id
      WHERE crp.enabled = true
      ORDER BY cc.channel_name, crp.report_type
    `);

    if (preferencesResult.rows.length === 0) {
      console.log('❌ No report preferences configured');
      return;
    }

    console.log(`✅ Found ${preferencesResult.rows.length} enabled report preference(s):`);
    preferencesResult.rows.forEach((pref, index) => {
      console.log(`  ${index + 1}. #${pref.channel_name} - ${pref.report_type} (${pref.report_name})`);
      if (pref.categories && pref.categories.length > 0) {
        console.log(`     - Categories: ${pref.categories.join(', ')}`);
      }
    });

    // Check which channels will receive scheduled reports
    console.log('\n📅 SCHEDULED REPORT RECIPIENTS:');
    console.log('-'.repeat(30));
    
    const reportTypes = ['daily', 'weekly', 'monthly', 'quarterly'];
    
    for (const reportType of reportTypes) {
      console.log(`\n${reportType.toUpperCase()} Reports:`);
      
      const scheduledResult = await pool.query(`
        SELECT cc.*, crp.report_name, crp.categories, crp.exclude_categories, crp.min_score, crp.min_comments
        FROM channel_configs cc
        JOIN channel_report_preferences crp ON cc.channel_id = crp.channel_id
        JOIN channel_notifications cn ON cc.channel_id = cn.channel_id
        WHERE cc.is_active = true 
          AND crp.report_type = $1 
          AND crp.enabled = true
          AND cn.notification_type = 'scheduled_reports'
          AND cn.enabled = true
        ORDER BY cc.channel_id, crp.report_name
      `, [reportType]);

      if (scheduledResult.rows.length === 0) {
        console.log(`  ❌ No channels configured for ${reportType} reports`);
        console.log(`  💡 Use /config enable ${reportType} in Slack channels to enable`);
      } else {
        console.log(`  ✅ ${scheduledResult.rows.length} channel(s) will receive ${reportType} reports:`);
        scheduledResult.rows.forEach((channel, index) => {
          console.log(`    ${index + 1}. #${channel.channel_name} (${channel.report_name})`);
          if (channel.categories && channel.categories.length > 0) {
            console.log(`       - Categories: ${channel.categories.join(', ')}`);
          }
        });
      }
    }

    // Check channel_notifications table
    console.log('\n🔔 NOTIFICATION SETTINGS:');
    console.log('-'.repeat(30));
    
    const notificationsResult = await pool.query(`
      SELECT cn.channel_id, cc.channel_name, cn.notification_type, cn.enabled
      FROM channel_notifications cn
      JOIN channel_configs cc ON cn.channel_id = cc.channel_id
      ORDER BY cc.channel_name, cn.notification_type
    `);

    if (notificationsResult.rows.length === 0) {
      console.log('❌ No notification settings configured');
      return;
    }

    console.log(`✅ Found ${notificationsResult.rows.length} notification setting(s):`);
    notificationsResult.rows.forEach((notif, index) => {
      console.log(`  ${index + 1}. #${notif.channel_name} - ${notif.notification_type}: ${notif.enabled ? '✅' : '❌'}`);
    });

  } catch (error) {
    console.error('❌ Error checking channels:', error);
  } finally {
    if (pool) {
      await closeDb();
      console.log('\n📴 Database connection closed');
    }
  }
}

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('\n🛑 Received interrupt signal, shutting down...');
  await closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received termination signal, shutting down...');
  await closeDb();
  process.exit(0);
});

// Run the checker
checkChannels()
  .then(() => {
    console.log('\n✅ Channel check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Channel check failed:', error);
    process.exit(1);
  });
