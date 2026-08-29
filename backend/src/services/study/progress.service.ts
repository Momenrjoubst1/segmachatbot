import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("study:progress");

export interface StudyProgressRow {
  id: string;
  user_id: string;
  course_id: string | null;
  textbook_id: string | null;
  topic: string;
  correct_count: number;
  incorrect_count: number;
  mastery_level: number;
  last_outcome: boolean | null;
  last_quizzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordQuizResultInput {
  userId: string;
  topic: string;
  correct: boolean;
  courseId?: string;
  textbookId?: string;
}

/**
 * Record the outcome of a single quiz question.
 * Uses exponential moving average (alpha=0.3) for mastery_level:
 *   mastery = 0.3 * outcome + 0.7 * previous_mastery
 *   (outcome = 1 for correct, 0 for incorrect)
 *
 * Runs as a single atomic upsert (migrations/036_atomic_quiz_result.sql) keyed
 * on the real UNIQUE (user_id, topic) constraint — the old read-then-insert
 * path 500'd when the same topic arrived with a different course/textbook
 * scoping and was racy under concurrent answers.
 */
export async function recordQuizResult(input: RecordQuizResultInput): Promise<StudyProgressRow> {
  const { userId, topic, correct, courseId, textbookId } = input;

  const { data, error } = await supabase
    .rpc("record_quiz_result", {
      p_user_id: userId,
      p_topic: topic,
      p_correct: correct,
      p_course_id: courseId ?? null,
      p_textbook_id: textbookId ?? null,
    })
    .single();

  if (!error && data) return data as unknown as StudyProgressRow;

  // Function not deployed yet (rolling deploy) — fall back to the legacy path.
  if ((error as { code?: string } | null)?.code === "42883") {
    log.warn("record_quiz_result rpc missing; using legacy read-modify-write");
    return legacyRecordQuizResult(input);
  }

  log.error("Failed to record quiz result", { error: error?.message, userId, topic });
  throw new Error(error?.message || "Failed to record quiz result");
}

/** Legacy read-modify-write path, kept only as a deploy-order fallback. */
async function legacyRecordQuizResult(input: RecordQuizResultInput): Promise<StudyProgressRow> {
  const { userId, topic, correct, courseId, textbookId } = input;

  // Fetch current progress row
  let query = supabase
    .from("study_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("topic", topic);

  if (courseId) query = query.eq("course_id", courseId);
  else if (textbookId) query = query.eq("textbook_id", textbookId);

  const { data: existing } = await query.maybeSingle();

  const now = new Date().toISOString();
  const outcomeVal = correct ? 1 : 0;
  const alpha = 0.3;

  let mastery = existing?.mastery_level ?? 0.5;
  mastery = alpha * outcomeVal + (1 - alpha) * mastery;

  const correctCount = (existing?.correct_count ?? 0) + (correct ? 1 : 0);
  const incorrectCount = (existing?.incorrect_count ?? 0) + (correct ? 0 : 1);

  if (existing) {
    const { data, error } = await supabase
      .from("study_progress")
      .update({
        correct_count: correctCount,
        incorrect_count: incorrectCount,
        mastery_level: Math.round(mastery * 1000) / 1000, // 3 decimal places
        last_outcome: correct,
        last_quizzed_at: now,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      log.error("Failed to update study progress", { error: error.message, userId, topic });
      throw new Error(error.message);
    }
    return data as StudyProgressRow;
  } else {
    const { data, error } = await supabase
      .from("study_progress")
      .insert({
        user_id: userId,
        course_id: courseId || null,
        textbook_id: textbookId || null,
        topic,
        correct_count: correctCount,
        incorrect_count: incorrectCount,
        mastery_level: Math.round(mastery * 1000) / 1000,
        last_outcome: correct,
        last_quizzed_at: now,
      })
      .select("*")
      .single();

    if (error) {
      log.error("Failed to create study progress", { error: error.message, userId, topic });
      throw new Error(error.message);
    }
    return data as StudyProgressRow;
  }
}

/** Get all progress rows for a user, sorted by mastery ASC (weakest first). */
export async function getStudyProgress(
  userId: string,
  options: { courseId?: string; textbookId?: string; limit?: number } = {}
): Promise<StudyProgressRow[]> {
  const { courseId, textbookId, limit = 50 } = options;
  let query = supabase
    .from("study_progress")
    .select("*")
    .eq("user_id", userId)
    .order("mastery_level", { ascending: true })
    .limit(limit);

  if (courseId) query = query.eq("course_id", courseId);
  if (textbookId) query = query.eq("textbook_id", textbookId);

  const { data, error } = await query;
  if (error) {
    log.error("Failed to fetch study progress", { error: error.message, userId });
    throw new Error(error.message);
  }
  return (data || []) as StudyProgressRow[];
}

/** Build a compact context block for the system prompt summarizing weak topics. */
export async function buildProgressContext(userId: string, options: { courseId?: string; textbookId?: string } = {}): Promise<string> {
  const progress = await getStudyProgress(userId, { ...options, limit: 10 });
  if (progress.length === 0) return "";

  const weak = progress.filter((p) => p.mastery_level < 0.5).slice(0, 6);
  if (weak.length === 0) return "";

  const lines = weak.map((p) => {
    const total = p.correct_count + p.incorrect_count;
    const pct = total > 0 ? Math.round((p.correct_count / total) * 100) : 0;
    return `- "${p.topic}": mastery ${Math.round(p.mastery_level * 100)}% (${pct}% correct, ${total} questions)`;
  });

  return `# Learning Progress — Weak Topics\n\nStudent's weakest areas (need review):\n${lines.join("\n")}\n`;
}