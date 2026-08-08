/**
 * Thread Lookup Service — "Thread Summoner" utility for the Octopus system.
 *
 * Searches a user's chat_sessions by fuzzy title match to find a specific
 * past conversation. Used by the fast-pass interceptor in the chat pipeline
 * to instantly navigate to a thread without invoking the LLM.
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("thread-lookup");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadLookupResult {
  /** Whether a matching thread was found. */
  found: boolean;
  /** The matched thread's UUID (null when not found). */
  threadId: string | null;
  /** The matched thread's title for display (null when not found). */
  matchedTitle: string | null;
}

// ---------------------------------------------------------------------------
// Arabic Intent Detection â€” Broad Verb Patterns
// ---------------------------------------------------------------------------

/**
 * Comprehensive regex that matches a wide range of Arabic imperative and
 * directional verb phrases used to express "navigate to / open a chat".
 *
 * Covered verbs:
 *   Ø§ÙØªØ­ (open) Â· Ø§Ø°Ù‡Ø¨/Ø±ÙˆØ­/Ø±ÙˆÙ‘Ø­ (go) Â· Ø¬ÙŠØ¨ (bring) Â· ÙˆØ±ÙŠÙ†ÙŠ (show me)
 *   Ø®Ø°Ù†ÙŠ/ÙˆØ¯Ù‘Ù†ÙŠ (take me) Â· Ø§Ù†Ù‚Ù„Ù†ÙŠ (move me) Â· Ø±Ø¬Ù‘Ø¹Ù†ÙŠ (take me back)
 *   Ø¯ÙˆØ±/Ø§Ø¨Ø­Ø« (find/search)
 *
 * Optionally followed by directional connectors: Ø¥Ù„Ù‰ØŒ Ø§Ù„Ù‰ØŒ Ù„Ù€ØŒ Ù„ØŒ Ø¹Ù„Ù‰ØŒ Ù„ÙŠ
 */
const THREAD_INTENT_VERB_REGEX = new RegExp(
  "^(?:" +
    // "Ø§ÙØªØ­" â€” open
    "Ø§ÙØªØ­" +
    // "Ø§Ø°Ù‡Ø¨" (+ optional Ø¥Ù„Ù‰/Ø§Ù„Ù‰/Ù„) â€” go
    "|Ø§Ø°Ù‡Ø¨(?:\\s+(?:Ø§Ù„Ù‰|Ø¥Ù„Ù‰|Ù„[Ù€]?))?" +
    // "Ø±ÙˆØ­" / "Ø±ÙˆÙ‘Ø­" (+ optional Ø¹Ù„Ù‰/Ø¥Ù„Ù‰/Ø§Ù„Ù‰)
    "|Ø±Ùˆ\\s*[Ù‘Ø­]?(?:\\s+(?:Ø¹Ù„Ù‰|Ø§Ù„Ù‰|Ø¥Ù„Ù‰))?" +
    // "Ø¬ÙŠØ¨" (+ optional Ù„ÙŠ) â€” bring (me)
    "|Ø¬ÙŠØ¨(?:\\s+Ù„ÙŠ)?" +
    // "ÙˆØ±ÙŠÙ†ÙŠ" â€” show me
    "|ÙˆØ±ÙŠÙ†ÙŠ" +
    // "Ø®Ø°Ù†ÙŠ" â€” take me
    "|Ø®Ø°Ù†ÙŠ(?:\\s+(?:Ø¹Ù„Ù‰|Ø§Ù„Ù‰|Ø¥Ù„Ù‰))?" +
    // "ÙˆØ¯Ù‘Ù†ÙŠ" / "ÙˆØ¯Ù†ÙŠ" â€” take me (Gulf dialect)
    "|ÙˆØ¯\\s*[Ù‘]Ù†ÙŠ(?:\\s+(?:Ø¹Ù„Ù‰|Ø§Ù„Ù‰|Ø¥Ù„Ù‰))?" +
    // "Ø§Ù†Ù‚Ù„Ù†ÙŠ" â€” move/transfer me
    "|Ø§Ù†Ù‚Ù„Ù†ÙŠ(?:\\s+(?:Ø§Ù„Ù‰|Ø¥Ù„Ù‰|Ø¹Ù„Ù‰))?" +
    // "Ø±Ø¬Ù‘Ø¹Ù†ÙŠ" / "Ø±Ø¬Ø¹Ù†ÙŠ" â€” take me back
    "|Ø±Ø¬\\s*[Ù‘]?\\s*Ø¹\\s*[Ù‘]?Ù†ÙŠ(?:\\s+(?:Ø¹Ù„Ù‰|Ø§Ù„Ù‰|Ø¥Ù„Ù‰))?" +
    // "Ø¯ÙˆØ±" / "Ø§Ø¨Ø­Ø«" â€” find / search
    "|Ø¯ÙˆØ±(?:\\s+Ù„ÙŠ)?" +
    "|Ø§Ø¨Ø­Ø«(?:\\s+Ù„ÙŠ)?" +
  ")(?:\\s+|$)",
);

// ---------------------------------------------------------------------------
// Title Sanitization â€” Filler Word Stripping
// ---------------------------------------------------------------------------

/**
 * Ordered list of Arabic filler words that commonly appear between the verb
 * and the actual chat title. Stripped iteratively from the beginning of the
 * extracted text until no more filler remains.
 *
 * Examples of what this removes:
 *   "Ø´Ø§Øª Ø§Ø³Ù…Ù‡ X"  â†’  "X"
 *   "Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø© ØªØ¨Ø¹ X"  â†’  "X"
 *   "Ù…ÙˆØ¶ÙˆØ¹ Ø¨Ø§Ø³Ù… X"  â†’  "X"
 */
const TITLE_FILLER_WORDS: readonly string[] = [
  "Ø´Ø§Øª",
  "Ù…Ø­Ø§Ø¯Ø«Ù‡",
  "Ù…Ø­Ø§Ø¯Ø«Ø©",
  "Ù…ÙˆØ¶ÙˆØ¹",
  "ØªØ´Ø§Ø±Øª",
  "Ø§Ø³Ù…Ù‡",
  "Ø¨Ø§Ø³Ù…",
  "Ø¨Ø¹Ù†ÙˆØ§Ù†",
  "ØªØ¨Ø¹",
  "ØªØ¨Ø¹Øª",
  "Ø­Ù‚",
  "Ø­Ù‚Øª",
  "Ù…ØªØ§Ø¹",
  "Ø§Ù„Ù„ÙŠ",
  "Ø§Ù„ÙŠ",
] as const;

/**
 * Directional connector particles that may appear at the start of the
 * extracted text (either standalone or attached to the next word).
 *
 * In Arabic, prepositions like "Ù„Ù€" (to/for) and "Ø¨Ù€" (with/by) attach
 * directly to the following noun without a space, e.g. "Ù„Ø´Ø§Øª" = "to chat".
 * This regex strips those leading connectors iteratively.
 *
 * Ordered longest-first to prevent partial matches (e.g. "Ø§Ù„Ù‰" before "Ø§").
 */
const CONNECTOR_STRIP_REGEX =
  /^(?:Ø§Ù„Ù‰|Ø¥Ù„Ù‰|Ø¹Ù†|Ø¹Ù„Ù‰|Ù„[Ù€]?|Ø¨[Ù€]?)\s*/i;

/**
 * Iteratively strip leading filler words from the raw extracted text
 * until the actual chat title remains.
 */
function sanitizeSearchTitle(raw: string): string {
  let title = raw.trim();
  let changed = true;

  // Keep stripping as long as a filler or connector is found at the start.
  // Iterative because fillers can stack: "Ù„Ø´Ø§Øª Ø§Ø³Ù…Ù‡ Ø§Ù„Ù…Ø´Ø±ÙˆØ¹" â†’ "Ø§Ù„Ù…Ø´Ø±ÙˆØ¹"
  while (changed && title.length > 0) {
    changed = false;

    // Step A: Strip attached directional connectors (Ù„Ù€, Ø¨Ù€, Ø§Ù„Ù‰, etc.)
    const connectorStripped = title.replace(CONNECTOR_STRIP_REGEX, "").trim();
    if (connectorStripped !== title) {
      title = connectorStripped;
      changed = true;
      continue;
    }

    // Step B: Strip standalone filler words
    for (const filler of TITLE_FILLER_WORDS) {
      const regex = new RegExp(`^${filler}\\s*`, "i");
      const stripped = title.replace(regex, "").trim();
      if (stripped !== title) {
        title = stripped;
        changed = true;
        break; // restart from connector check
      }
    }
  }

  return title;
}

// ---------------------------------------------------------------------------
// Intent Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a user message is an "open thread by title" intent and
 * extract the cleaned search title.
 *
 * Two-phase extraction:
 *   1. Match a broad set of Arabic imperative verbs (intent detection).
 *   2. Strip conversational filler words from the captured text (sanitization).
 *
 * @returns `null` if the message does NOT match the intent.
 *          `{ searchTitle }` with the cleaned title string if it does.
 */
export function extractThreadSearchTitle(userMessage: string): {
  searchTitle: string;
} | null {
  const trimmed = userMessage.trim();
  if (!trimmed) return null;

  // Phase 1: Detect imperative verb â†’ this IS a thread-open intent
  if (!THREAD_INTENT_VERB_REGEX.test(trimmed)) {
    return null;
  }

  // Phase 2: Strip the verb phrase to get raw title candidate
  const rawTitle = trimmed.replace(THREAD_INTENT_VERB_REGEX, "").trim();

  // Phase 3: Sanitize â€” strip leading filler words iteratively
  const searchTitle = sanitizeSearchTitle(rawTitle);

  // Must have meaningful content left after sanitization (â‰¥ 2 chars)
  if (searchTitle.length < 2) return null;

  return { searchTitle };
}

// ---------------------------------------------------------------------------
// Database Lookup
// ---------------------------------------------------------------------------

/**
 * Search the `chat_sessions` table for a thread whose title fuzzy-matches
 * the user's search query. Uses ILIKE for flexible text matching and orders
 * by `updated_at DESC` so the most recently active thread wins.
 *
 * @param userId     - The authenticated user's UUID.
 * @param userMessage - The raw user message (prefixes will be stripped internally).
 * @returns A `ThreadLookupResult` indicating whether a match was found.
 */
export async function findThreadByTitle(
  userId: string,
  userMessage: string,
): Promise<ThreadLookupResult> {
  const extracted = extractThreadSearchTitle(userMessage);
  if (!extracted) {
    return { found: false, threadId: null, matchedTitle: null };
  }

  const { searchTitle } = extracted;

  try {
    const { supabase } = await import("../rag/rag-supabase-client.js");

    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, title")
      .eq("user_id", userId)
      .ilike("title", `%${searchTitle}%`)
      .neq("title", "New Chat")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      log.warn("Supabase query error during thread lookup", {
        error: error.message,
      });
      return { found: false, threadId: null, matchedTitle: null };
    }

    if (data && data.length > 0) {
      log.info("Thread summoner: match found", {
        threadId: data[0].id,
        matchedTitle: data[0].title,
        searchTitle,
      });
      return {
        found: true,
        threadId: data[0].id,
        matchedTitle: data[0].title,
      };
    }

    log.info("Thread summoner: no match", { searchTitle });
    return { found: false, threadId: null, matchedTitle: null };
  } catch (err) {
    log.error("Thread lookup failed unexpectedly", {
      error: (err as Error).message,
    });
    return { found: false, threadId: null, matchedTitle: null };
  }
}
