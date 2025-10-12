-- Multi-Channel Configuration Schema
-- This file contains the SQL schema for managing multiple Slack channels with individual configurations

-- Channel configurations table
CREATE TABLE IF NOT EXISTS channel_configs (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(50) UNIQUE NOT NULL,
    channel_name VARCHAR(100) NOT NULL,
    workspace_id VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Channel report preferences
CREATE TABLE IF NOT EXISTS channel_report_preferences (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(50) REFERENCES channel_configs(channel_id) ON DELETE CASCADE,
    report_type VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly', 'quarterly', 'manual'
    report_name VARCHAR(50) DEFAULT 'default', -- Name for multiple reports of same type
    enabled BOOLEAN DEFAULT true,
    categories TEXT[], -- Array of category names to filter by
    exclude_categories TEXT[], -- Array of categories to exclude
    min_score INTEGER DEFAULT 0, -- Minimum post score threshold
    min_comments INTEGER DEFAULT 0, -- Minimum comment count threshold
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, report_type, report_name)
);

-- Channel notification settings
CREATE TABLE IF NOT EXISTS channel_notifications (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(50) REFERENCES channel_configs(channel_id) ON DELETE CASCADE,
    notification_type VARCHAR(30) NOT NULL, -- 'scheduled_reports', 'manual_reports', 'errors', 'status_updates'
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, notification_type)
);

-- Channel admin users (who can configure the channel)
CREATE TABLE IF NOT EXISTS channel_admins (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(50) REFERENCES channel_configs(channel_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,
    user_name VARCHAR(100) NOT NULL,
    permission_level VARCHAR(20) DEFAULT 'admin', -- 'admin', 'moderator', 'viewer'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, user_id)
);

-- Channel activity log
CREATE TABLE IF NOT EXISTS channel_activity_log (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(50) REFERENCES channel_configs(channel_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'report_generated', 'config_updated', 'bot_added', etc.
    details JSONB, -- Additional details about the action
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_channel_configs_channel_id ON channel_configs(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_configs_workspace_id ON channel_configs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_channel_configs_active ON channel_configs(is_active);

CREATE INDEX IF NOT EXISTS idx_report_prefs_channel_id ON channel_report_preferences(channel_id);
CREATE INDEX IF NOT EXISTS idx_report_prefs_type ON channel_report_preferences(report_type);
CREATE INDEX IF NOT EXISTS idx_report_prefs_enabled ON channel_report_preferences(enabled);

CREATE INDEX IF NOT EXISTS idx_notifications_channel_id ON channel_notifications(channel_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON channel_notifications(notification_type);

CREATE INDEX IF NOT EXISTS idx_admins_channel_id ON channel_admins(channel_id);
CREATE INDEX IF NOT EXISTS idx_admins_user_id ON channel_admins(user_id);

CREATE INDEX IF NOT EXISTS idx_activity_channel_id ON channel_activity_log(channel_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON channel_activity_log(created_at);

-- Insert default configuration for existing channel (if any)
-- This will be populated when the bot is first added to a channel
INSERT INTO channel_configs (channel_id, channel_name, workspace_id) 
VALUES ('C09FK9RK4RX', 'Default Channel', 'default_workspace')
ON CONFLICT (channel_id) DO NOTHING;

-- Insert default report preferences for all report types
INSERT INTO channel_report_preferences (channel_id, report_type, report_name, enabled, categories)
VALUES 
    ('C09FK9RK4RX', 'daily', 'default', true, ARRAY[]::TEXT[]),
    ('C09FK9RK4RX', 'weekly', 'default', true, ARRAY[]::TEXT[]),
    ('C09FK9RK4RX', 'monthly', 'default', true, ARRAY[]::TEXT[]),
    ('C09FK9RK4RX', 'quarterly', 'default', true, ARRAY[]::TEXT[]),
    ('C09FK9RK4RX', 'manual', 'default', true, ARRAY[]::TEXT[])
ON CONFLICT (channel_id, report_type, report_name) DO NOTHING;

-- Insert default notification settings
INSERT INTO channel_notifications (channel_id, notification_type, enabled)
VALUES 
    ('C09FK9RK4RX', 'scheduled_reports', true),
    ('C09FK9RK4RX', 'manual_reports', true),
    ('C09FK9RK4RX', 'errors', true),
    ('C09FK9RK4RX', 'status_updates', true)
ON CONFLICT (channel_id, notification_type) DO NOTHING;
