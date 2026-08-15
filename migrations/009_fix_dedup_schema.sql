-- ==========================================
-- Migration 009: Fix Dedup Schema
-- ==========================================
-- Changes the unique index from global to per-user
-- to prevent conflicts when multiple users upload the same file.
-- ==========================================

-- 1. Drop the global unique index
DROP INDEX IF EXISTS idx_textbooks_hash_unique;

-- 2. Create per-user unique index
-- Each user can have only one completed record per file hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_textbooks_user_hash_unique
ON textbooks(user_id, file_hash) WHERE status = 'completed';
