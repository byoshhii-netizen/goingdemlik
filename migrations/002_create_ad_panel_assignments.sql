-- Migration: connect existing music/reals ads to user profiles.
-- The application also creates this table from database.js during startup.

CREATE TABLE IF NOT EXISTS ad_panel_assignments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('music','reals')),
  ad_id BIGINT NOT NULL,
  portal_code CHAR(6) NOT NULL,
  assigned_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_admin_username TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, ad_type, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_panel_assignments_user
  ON ad_panel_assignments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_panel_assignments_ad
  ON ad_panel_assignments(ad_type, ad_id);