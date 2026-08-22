import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import type { SrsState } from "./srs.js";

const log = createLogger("study:flashcards");

export interface FlashcardRow {
  id: string;
  user_id: string;
  textbook_id: string | null;
  course_id: string | null;
  topic: string;
  section_path: string | null;
  question: string;
  answer: string;
  source: 'ai' | 'manual';
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFlashcardsInput {
  userId: string;
  cards: Array<{
    textbookId?: string;
    courseId?: string;
    topic: string;
    sectionPath?: string;
    question: string;
    answer: string;
    source?: 'ai' | 'manual';
  }>;
}

export interface ReviewResult {
  id: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string;
}

/** Persist generated flashcards (idempotent on question per user). */
export async function createFlashcards(input: CreateFlashcardsInput): Promise<FlashcardRow[]> {
  const { userId, cards } = input;
  if (cards.length === 0) return [];

  // Upsert on (user_id, question) — returns existing if duplicate
  const { data, error } = await supabase
    .from("flashcards")
    .upsert(
      cards.map((c) => ({
        user_id: userId,
        textbook_id: c.textbookId || null,
        course_id: c.courseId || null,
        topic: c.topic,
        section_path: c.sectionPath || null,
        question: c.question,
        answer: c.answer,
        source: c.source || 'ai',
        interval_days: 0,
        ease_factor: 2.5,
        repetitions: 0,
        lapses: 0,
        due_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,question', ignoreDuplicates: false }
    )
    .select();

  if (error) {
    log.error("Failed to create flashcards", { error: error.message, userId, count: cards.length });
    throw new Error(error.message);
  }

  return (data || []) as FlashcardRow[];
}

/** List flashcards due for review (optionally filtered by course). */
export async function getDueFlashcards(
  userId: string,
  options: { courseId?: string; limit?: number } = {}
): Promise<FlashcardRow[]> {
  const { courseId, limit = 30 } = options;
  const now = new Date().toISOString();

  let query = supabase
    .from("flashcards")
    .select("*")
    .eq("user_id", userId)
    .lte("due_at", now)
    .order("due_at", { ascending: true })
    .limit(limit);

  if (courseId) query = query.eq("course_id", courseId);

  const { data, error } = await query;
  if (error) {
    log.error("Failed to fetch due flashcards", { error: error.message, userId });
    throw new Error(error.message);
  }
  return (data || []) as FlashcardRow[];
}

/** Update a single flashcard's SRS state after a review. */
export async function reviewFlashcard(
  userId: string,
  cardId: string,
  quality: 'again' | 'hard' | 'good' | 'easy'
): Promise<ReviewResult> {
  // Fetch current state
  const { data: card, error: fetchErr } = await supabase
    .from("flashcards")
    .select("*")
    .eq("id", cardId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !card) {
    throw new Error("Flashcard not found");
  }

  const currentState: SrsState = {
    interval_days: card.interval_days,
    ease_factor: card.ease_factor,
    repetitions: card.repetitions,
    lapses: card.lapses,
  };

  const { scheduleNext, nextDueAt } = await import("./srs.js");
  const next = scheduleNext(currentState, quality);
  const dueAt = nextDueAt(next.interval_days);

  const { data: updated, error: updErr } = await supabase
    .from("flashcards")
    .update({
      interval_days: next.interval_days,
      ease_factor: next.ease_factor,
      repetitions: next.repetitions,
      lapses: next.lapses,
      due_at: dueAt.toISOString(),
      last_reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updErr || !updated) {
    log.error("Failed to update flashcard SRS state", { error: updErr?.message, cardId });
    throw new Error(updErr?.message || "Update failed");
  }

  return {
    id: updated.id,
    interval_days: updated.interval_days,
    ease_factor: updated.ease_factor,
    repetitions: updated.repetitions,
    lapses: updated.lapses,
    due_at: updated.due_at,
    last_reviewed_at: updated.last_reviewed_at || new Date().toISOString(),
  };
}

/** Delete a flashcard. */
export async function deleteFlashcard(userId: string, cardId: string): Promise<void> {
  const { error } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", userId);

  if (error) {
    log.error("Failed to delete flashcard", { error: error.message, cardId });
    throw new Error(error.message);
  }
}

/** List all flashcards for a user (paginated, optional course filter). */
export async function listFlashcards(
  userId: string,
  options: { courseId?: string; offset?: number; limit?: number } = {}
): Promise<FlashcardRow[]> {
  const { courseId, offset = 0, limit = 50 } = options;
  let query = supabase
    .from("flashcards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (courseId) query = query.eq("course_id", courseId);

  const { data, error } = await query;
  if (error) {
    log.error("Failed to list flashcards", { error: error.message, userId });
    throw new Error(error.message);
  }
  return (data || []) as FlashcardRow[];
}