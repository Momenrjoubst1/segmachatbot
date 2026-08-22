-- ==========================================
-- 008: Fix Sidebar & Thread Management
-- ==========================================
-- NOTE: The 008_ prefix is intentionally shared with 008_fix_hybrid_search.sql.
-- Renaming migrations is unsafe if already applied to production databases.
-- The order between these two files does not matter.
-- ==========================================
-- Fixes:
--  1. updated_at never bumps on new messages (sidebar sort broken)
--  2. Orphan sessions with 0 messages clutter the sidebar
--  3. Default title mismatch between schema ('محادثة جديدة') and code ('New Chat')
--  4. Backfill existing "New Chat" sessions with titles from first user message
--  5. Cleanup truly empty sessions older than 7 days
--
-- Run this in Supabase SQL Editor.

-- ==========================================
-- 1. updated_at trigger: bump on every new message
--    Standard pattern (like Django's auto_now, Rails' touch: true)
-- ==========================================
CREATE OR REPLACE FUNCTION bump_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_sessions SET updated_at = NOW() WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_bump_session_updated_at ON chat_messages;
CREATE TRIGGER trigger_bump_session_updated_at
    AFTER INSERT ON chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION bump_session_updated_at();

-- ==========================================
-- 2. View: non-empty sessions only
--    The backend GET /threads endpoint queries this instead of chat_sessions
--    to automatically exclude orphan sessions that have zero messages.
--
--    security_invoker (PG15+, Supabase default) makes the view execute with
--    the CALLER's rights, so the base tables' RLS policies apply as if the
--    caller queried chat_sessions directly. Views cannot have their own
--    policies — this is the Supabase-documented pattern.
-- ==========================================
CREATE OR REPLACE VIEW chat_sessions_with_messages
WITH (security_invoker = true) AS
SELECT cs.id, cs.user_id, cs.title, cs.updated_at, cs.course_id
FROM chat_sessions cs
WHERE EXISTS (
    SELECT 1 FROM chat_messages cm WHERE cm.session_id = cs.id
);

-- ==========================================
-- 3. Unify default title to 'New Chat'
-- ==========================================
ALTER TABLE chat_sessions ALTER COLUMN title SET DEFAULT 'New Chat';

-- ==========================================
-- 4. Backfill: title "New Chat" sessions from first user message
-- ==========================================
UPDATE chat_sessions cs
SET title = (
    SELECT CASE
        WHEN LENGTH(TRIM(cm.content)) > 50
        THEN LEFT(TRIM(REPLACE(REPLACE(cm.content, E'\n', ' '), E'\r', '')), 50) || '…'
        ELSE TRIM(REPLACE(REPLACE(cm.content, E'\n', ' '), E'\r', ''))
    END
    FROM chat_messages cm
    WHERE cm.session_id = cs.id
      AND cm.role = 'user'
    ORDER BY cm.created_at ASC
    LIMIT 1
)
WHERE cs.title IN ('New Chat', 'محادثة جديدة')
  AND EXISTS (
      SELECT 1 FROM chat_messages
      WHERE session_id = cs.id AND role = 'user'
  );

-- ==========================================
-- 5. Cleanup: delete truly empty sessions older than 7 days
-- ==========================================
DELETE FROM chat_sessions
WHERE title IN ('New Chat', 'محادثة جديدة')
  AND created_at < NOW() - INTERVAL '7 days'
  AND NOT EXISTS (
      SELECT 1 FROM chat_messages WHERE session_id = chat_sessions.id
  );
