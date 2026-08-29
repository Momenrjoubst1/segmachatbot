-- 037: Student study profile + topic-level spaced repetition.
--
-- student_profiles: the onboarding data the system never collected (grade,
-- major, exam date, daily review goal) — injected into the system prompt so
-- personalization is real instead of assumed.
--
-- study_progress gains topic-level SRS columns: next_review_at schedules a
-- topic for review on a forgetting-curve-like interval derived from its
-- mastery, and review_count counts completed review rounds.

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  grade_level TEXT,
  major TEXT,
  exam_date DATE,
  daily_goal INT NOT NULL DEFAULT 10 CHECK (daily_goal BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own study profile" ON student_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE study_progress
  ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_study_progress_user_next_review
  ON study_progress(user_id, next_review_at)
  WHERE next_review_at IS NOT NULL;

-- Re-create the atomic upsert with topic-level SRS scheduling: the next
-- review date scales with the resulting mastery (10 min → 1d → 3d → 7d).
CREATE OR REPLACE FUNCTION record_quiz_result(
  p_user_id uuid,
  p_topic text,
  p_correct boolean,
  p_course_id uuid DEFAULT NULL,
  p_textbook_id uuid DEFAULT NULL
)
RETURNS study_progress
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_outcome numeric := CASE WHEN p_correct THEN 1 ELSE 0 END;
  v_row study_progress%ROWTYPE;
BEGIN
  INSERT INTO study_progress (
    user_id, course_id, textbook_id, topic,
    correct_count, incorrect_count, mastery_level,
    last_outcome, last_quizzed_at, review_count
  ) VALUES (
    p_user_id, p_course_id, p_textbook_id, p_topic,
    CASE WHEN p_correct THEN 1 ELSE 0 END,
    CASE WHEN p_correct THEN 0 ELSE 1 END,
    round((0.3 * v_outcome + 0.7 * 0.5)::numeric, 3),
    p_correct,
    now(),
    1
  )
  ON CONFLICT (user_id, topic) DO UPDATE SET
    correct_count = study_progress.correct_count + CASE WHEN p_correct THEN 1 ELSE 0 END,
    incorrect_count = study_progress.incorrect_count + CASE WHEN p_correct THEN 0 ELSE 1 END,
    mastery_level = round((0.3 * v_outcome + 0.7 * study_progress.mastery_level)::numeric, 3),
    last_outcome = p_correct,
    last_quizzed_at = now(),
    review_count = study_progress.review_count + 1,
    course_id = COALESCE(p_course_id, study_progress.course_id),
    textbook_id = COALESCE(p_textbook_id, study_progress.textbook_id),
    updated_at = now()
  RETURNING * INTO v_row;

  -- Schedule the next review from the NEW mastery (v_row.mastery_level).
  UPDATE study_progress SET
    next_review_at = CASE
      WHEN v_row.mastery_level >= 0.8 THEN now() + interval '7 days'
      WHEN v_row.mastery_level >= 0.6 THEN now() + interval '3 days'
      WHEN v_row.mastery_level >= 0.4 THEN now() + interval '1 day'
      ELSE now() + interval '10 minutes'
    END
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
