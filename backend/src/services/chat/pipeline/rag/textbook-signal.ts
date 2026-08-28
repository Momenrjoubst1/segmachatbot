/**
 * Textbook Signal — checks if user has completed textbooks.
 * إشارة الكتاب المدرسي — يتحقق مما إذا كان المستخدم قد أنهى الكتب
 *
 * Uses Redis cache with short TTL for performance.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import redis from "../../../../config/redis/client.js";

const USER_TEXTBOOK_SIGNAL_TTL_MS = 60;
const USER_TEXTBOOK_SIGNAL_KEY_PREFIX = "rag:textbook_signal:";

// Fallback in-memory cache when Redis is unavailable
const fallbackCache = new Map<string, { value: boolean; expiry: number }>();

/**
 * Invalidate the textbook signal cache for a user.
 * Call this when a user uploads or completes a textbook.
 */
export function invalidateUserTextbookSignal(userId: string): void {
  const key = USER_TEXTBOOK_SIGNAL_KEY_PREFIX + userId;
  redis.del(key).catch(() => {});
  fallbackCache.delete(userId);
}

/**
 * Check if the user has any completed textbooks.
 * Returns true if the user has textbooks (used to bypass response cache).
 */
export async function getUserTextbookSignal(
  userId: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  const key = USER_TEXTBOOK_SIGNAL_KEY_PREFIX + userId;

  // Try Redis first
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return cached === "1";
    }
  } catch {
    // Redis unavailable — try fallback
    const fb = fallbackCache.get(userId);
    if (fb && fb.expiry > Date.now()) {
      return fb.value;
    }
  }

  // Cache miss — query DB
  try {
    const { count } = await supabase
      .from("textbooks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed");
    const value = (count ?? 0) > 0;

    // Write to Redis
    try {
      await redis.set(key, value ? "1" : "0", "EX", USER_TEXTBOOK_SIGNAL_TTL_MS);
    } catch {
      // Redis write failed — use fallback
      fallbackCache.set(userId, { value, expiry: Date.now() + USER_TEXTBOOK_SIGNAL_TTL_MS * 1000 });
    }

    return value;
  } catch {
    // On lookup failure, prefer correctness over caching: bypass
    return true;
  }
}
