-- 038: Study events — one append-only table powering streaks, XP, badges and
-- weekly stats. Events are written by the flashcard-review and quiz-result
-- flows; summaries are computed on read (no counters to keep in sync).

CREATE TABLE IF NOT EXISTS study_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('card_review', 'quiz_result')),
  correct BOOLEAN,
  points INT NOT NULL DEFAULT 1,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_study_events_user_created
  ON study_events(user_id, created_at DESC);

ALTER TABLE study_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own study events" ON study_events
  FOR SELECT USING (auth.uid() = user_id);
-- Writes happen through the backend service-role connection (RLS bypassed),
-- so no INSERT policy is granted to clients.
