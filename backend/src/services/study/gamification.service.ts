// Gamification — streaks, XP, badges and weekly stats computed from the
// append-only study_events table (migration 038). One write path
// (recordStudyEvent) feeds everything; nothing is denormalized.

import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("study:gamification");

export type StudyEventType = "card_review" | "quiz_result";

export interface StudyEventRow {
  id: string;
  user_id: string;
  type: StudyEventType;
  correct: boolean | null;
  points: number;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export async function recordStudyEvent(
  userId: string,
  type: StudyEventType,
  options: { correct?: boolean; points?: number; detail?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    const { error } = await supabase.from("study_events").insert({
      user_id: userId,
      type,
      correct: options.correct ?? null,
      points: options.points ?? 1,
      detail: options.detail ?? null,
    });
    if (error) {
      log.warn("Failed to record study event", { error: error.message, userId, type });
    }
  } catch (err) {
    log.warn("Study event insert threw", { error: (err as Error).message, userId, type });
  }
}

export interface GamificationSummary {
  xp: number;
  streak: number;
  reviewedToday: number;
  totals: {
    cardsReviewed: number;
    quizCorrect: number;
    quizIncorrect: number;
  };
  /** Last 7 days, oldest first: { date: YYYY-MM-DD, reviewed, correct } */
  week: Array<{ date: string; reviewed: number; correct: number }>;
  badges: Array<{ id: string; earned: boolean }>;
}

interface EventRow {
  type: string;
  correct: boolean | null;
  points: number;
  created_at: string;
}

function todayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Consecutive active days ending today or yesterday. */
function computeStreak(activeDays: Set<string>): number {
  let streak = 0;
  const cursor = new Date();
  // A streak survives if the student was active yesterday but not yet today.
  if (!activeDays.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    if (!activeDays.has(todayKey(cursor))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export async function getGamificationSummary(userId: string): Promise<GamificationSummary> {
  // 90 days is plenty for streaks (max meaningful) and cheap to scan.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("study_events")
    .select("type, correct, points, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    log.error("Failed to load study events", { error: error.message, userId });
    throw new Error(error.message);
  }

  const events = (data || []) as EventRow[];

  const activeDays = new Set(events.map((e) => todayKey(new Date(e.created_at))));
  const today = todayKey(new Date());
  const reviewedToday = events.filter((e) => todayKey(new Date(e.created_at)) === today).length;

  const week: GamificationSummary["week"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    const dayEvents = events.filter((e) => todayKey(new Date(e.created_at)) === key);
    week.push({
      date: key,
      reviewed: dayEvents.length,
      correct: dayEvents.filter((e) => e.correct === true).length,
    });
  }

  const cardsReviewed = events.filter((e) => e.type === "card_review").length;
  const quizCorrect = events.filter((e) => e.type === "quiz_result" && e.correct === true).length;
  const quizIncorrect = events.filter((e) => e.type === "quiz_result" && e.correct === false).length;
  const xp = events.reduce((sum, e) => sum + (e.points || 0), 0);

  const streak = computeStreak(activeDays);

  const badges: GamificationSummary["badges"] = [
    { id: "first_steps", earned: events.length > 0 },
    { id: "streak_3", earned: streak >= 3 },
    { id: "streak_7", earned: streak >= 7 },
    { id: "cards_50", earned: cardsReviewed >= 50 },
    { id: "quiz_20", earned: quizCorrect + quizIncorrect >= 20 },
  ];

  return {
    xp,
    streak,
    reviewedToday,
    totals: { cardsReviewed, quizCorrect, quizIncorrect },
    week,
    badges,
  };
}
