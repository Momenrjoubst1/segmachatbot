-- ==========================================
-- Migration Tracking Table
-- ==========================================
-- This table tracks which migrations have been applied to the database.
-- Created automatically by apply-migrations.js if it doesn't exist.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT now(),
  checksum TEXT NOT NULL
);
