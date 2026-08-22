/**
 * SM-2 Spaced Repetition Scheduler
 *
 * Pure, side-effect-free implementation of the SuperMemo-2 algorithm used by
 * Anki and most SRS apps. Quality ratings follow the standard 4-button scheme:
 *
 *   again (0) — complete blackout / wrong
 *   hard  (1) — correct with serious difficulty
 *   good  (2) — correct with some effort
 *   easy  (3) — correct effortlessly
 */

export type ReviewQuality = 'again' | 'hard' | 'good' | 'easy';

export interface SrsState {
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
}

/** Map the 4-button UI quality to SM-2's 0..5 scale. */
const QUALITY_MAP: Record<ReviewQuality, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

export const MIN_EASE_FACTOR = 1.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute the next SRS state given the current state and review quality.
 * Returns a NEW state object; inputs are never mutated.
 */
export function scheduleNext(state: SrsState, quality: ReviewQuality): SrsState {
  const q = QUALITY_MAP[quality];

  // Lapse: reset the streak, ease the card down slightly
  if (q < 3) {
    return {
      interval_days: 0,
      ease_factor: clamp(state.ease_factor - 0.2, MIN_EASE_FACTOR, 3.0),
      repetitions: 0,
      lapses: state.lapses + 1,
    };
  }

  const newEase = clamp(
    state.ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
    MIN_EASE_FACTOR,
    3.0,
  );

  let newInterval: number;
  if (state.repetitions === 0) {
    // First successful review
    newInterval = quality === 'hard' ? 1 : quality === 'easy' ? 4 : 2;
  } else if (state.repetitions === 1) {
    newInterval = quality === 'hard' ? 3 : quality === 'easy' ? 7 : 5;
  } else {
    newInterval = Math.round(state.interval_days * newEase);
    if (quality === 'hard') newInterval = Math.max(1, Math.round(newInterval * 0.8));
    if (quality === 'easy') newInterval = Math.round(newInterval * 1.2);
  }

  return {
    interval_days: newInterval,
    ease_factor: newEase,
    repetitions: state.repetitions + 1,
    lapses: state.lapses,
  };
}

/** Compute the UTC instant the card becomes due next. */
export function nextDueAt(intervalDays: number, from: Date = new Date()): Date {
  const days = intervalDays <= 0 ? 0 : intervalDays;
  const due = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  if (days === 0) {
    // Lapsed/new cards come back in the same session after 10 minutes
    due.setMinutes(due.getMinutes() + 10);
  }
  return due;
}
