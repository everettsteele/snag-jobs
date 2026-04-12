-- Migration 005: Add configurable weekly targets for Snag Metrics dashboard

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weekly_outreach_target INT NOT NULL DEFAULT 50;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weekly_apps_target INT NOT NULL DEFAULT 10;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weekly_events_target INT NOT NULL DEFAULT 2;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weekly_followups_target INT NOT NULL DEFAULT 10;
