-- Migration 028: Message-level like/dislike feedback with analytics snapshots
--
-- Introduces `message_feedback` as the source of truth for per-message ratings.
-- The legacy chat_messages.feedback SMALLINT column is kept in sync by the API
-- for backward compatibility but is no longer authoritative.
--
-- Key properties:
--   UNIQUE (message_id, user_id) — one rating per user per message; re-rating
--     upserts, re-clicking the same button removes (handled by the API layer).
--   Snapshots (prompt/response) freeze the rated exchange at rating time so
--   feedback remains analyzable even if messages are edited or deleted later.
--   updated_at is maintained by the application on UPDATE (repo convention:
--   no auto-update triggers; see 022_study_tools.sql).
--
-- Also adds chat_messages.model so future responses record which model
-- generated them (fed into message_feedback.model_version at rating time).

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS model TEXT;

CREATE TABLE IF NOT EXISTS message_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('like', 'dislike')),
  -- Only populated for dislikes; cleared when the rating changes to a like.
  reason_category TEXT CHECK (reason_category IN ('inaccurate', 'harmful', 'not_helpful', 'off_topic', 'other')),
  comment TEXT,
  prompt_snapshot TEXT,
  response_snapshot TEXT,
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_feedback_user
ON message_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_feedback_conversation
ON message_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_dislikes
ON message_feedback(created_at DESC) WHERE feedback_type = 'dislike';

ALTER TABLE message_feedback ENABLE ROW LEVEL SECURITY;
-- (select auth.uid()) wraps the call in an InitPlan so it evaluates once per
-- statement instead of per row — silences the auth_rls_initplan advisor.
CREATE POLICY "Users can manage their own message feedback" ON message_feedback
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- Backfill existing thumb ratings. Historical prompt snapshots and model names
-- were never stored, so they stay NULL ('unknown' is applied at query time).
INSERT INTO message_feedback
  (conversation_id, message_id, user_id, feedback_type, response_snapshot)
SELECT cm.session_id, cm.id, cs.user_id,
       CASE WHEN cm.feedback = 1 THEN 'like' ELSE 'dislike' END,
       LEFT(cm.content, 8000)
FROM chat_messages cm
JOIN chat_sessions cs ON cs.id = cm.session_id
WHERE cm.feedback IN (-1, 1)
ON CONFLICT (message_id, user_id) DO NOTHING;
