-- Migration 031: chat attachments registry
-- Persistent metadata for every file attached to a chat message (uploaded to
-- R2 under chat-attachments/{userId}/...). Lets thread history restore
-- attachments after reload and powers per-user usage reporting. The binary
-- lives in R2 — this table is metadata only.

CREATE TABLE IF NOT EXISTS chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  -- video | audio | image | document | text
  kind TEXT NOT NULL CHECK (kind IN ('video','audio','image','document','text')),
  -- uploaded (in R2) | ready (understood/staged for the model) | failed | expired
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','ready','failed','expired')),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_attachments_message ON chat_attachments(message_id);
CREATE INDEX idx_chat_attachments_user_created ON chat_attachments(user_id, created_at DESC);
CREATE INDEX idx_chat_attachments_session ON chat_attachments(session_id) WHERE session_id IS NOT NULL;

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own attachments" ON chat_attachments
  FOR SELECT USING (auth.uid() = user_id);
