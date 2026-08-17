-- ==========================================
-- Migration 018: chat-originated materials
-- ==========================================
-- Links a textbook to the chat thread it was uploaded from, so the worker
-- can post the "material is ready" notification back into that chat.
-- ==========================================

ALTER TABLE textbooks
  ADD COLUMN IF NOT EXISTS source_thread_id UUID
    REFERENCES chat_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_textbooks_source_thread
  ON textbooks(source_thread_id) WHERE source_thread_id IS NOT NULL;
