-- 036: Atomic quiz-result recording for study_progress.
--
-- The UNIQUE (user_id, topic) constraint made the old read-then-insert path in
-- recordQuizResult 500 when the same topic arrived with a different
-- courseId/textbookId combination (the scoped lookup found no row, the INSERT
-- hit the constraint). The read-modify-write was also racy under concurrent
-- quiz answers. This single-statement upsert computes the same EMA mastery
-- (alpha = 0.3) atomically, keyed on the real unique constraint.

CREATE OR REPLACE FUNCTION record_quiz_result(
  p_user_id uuid,
  p_topic text,
  p_correct boolean,
  p_course_id uuid DEFAULT NULL,
  p_textbook_id uuid DEFAULT NULL
)
RETURNS study_progress
LANGUAGE plpgsql
AS $$
DECLARE
  v_outcome numeric := CASE WHEN p_correct THEN 1 ELSE 0 END;
  v_row study_progress%ROWTYPE;
BEGIN
  INSERT INTO study_progress (
    user_id, course_id, textbook_id, topic,
    correct_count, incorrect_count, mastery_level,
    last_outcome, last_quizzed_at
  ) VALUES (
    p_user_id, p_course_id, p_textbook_id, p_topic,
    CASE WHEN p_correct THEN 1 ELSE 0 END,
    CASE WHEN p_correct THEN 0 ELSE 1 END,
    round((0.3 * v_outcome + 0.7 * 0.5)::numeric, 3),
    p_correct,
    now()
  )
  ON CONFLICT (user_id, topic) DO UPDATE SET
    correct_count = study_progress.correct_count + CASE WHEN p_correct THEN 1 ELSE 0 END,
    incorrect_count = study_progress.incorrect_count + CASE WHEN p_correct THEN 0 ELSE 1 END,
    mastery_level = round((0.3 * v_outcome + 0.7 * study_progress.mastery_level)::numeric, 3),
    last_outcome = p_correct,
    last_quizzed_at = now(),
    course_id = COALESCE(p_course_id, study_progress.course_id),
    textbook_id = COALESCE(p_textbook_id, study_progress.textbook_id),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
