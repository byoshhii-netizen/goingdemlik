-- Migration: create ads_events table
-- Run this against your PostgreSQL database if `initDb()` cannot connect from the app.

CREATE TABLE IF NOT EXISTS ads_events (
  id BIGSERIAL PRIMARY KEY,
  ad_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  user_id BIGINT,
  ip TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY(ad_id) REFERENCES ads(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ads_events_ad_created_at ON ads_events(ad_id, created_at);
