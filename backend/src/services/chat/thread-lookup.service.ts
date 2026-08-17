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
// Arabic Intent Detection — Broad Verb Patterns
// ---------------------------------------------------------------------------

/**
 * Comprehensive regex that matches a wide range of Arabic imperative and
 * directional verb phrases used to express "navigate to / open a chat".
 *
 * Covered verbs:
 *   افتح (open) · اذهب/روح/روّح (go) · جيب (bring) · وريني (show me)
 *   خذني/ودّني (take me) · انقلني (move me) · رجّعني (take me back)
 *   دور/ابحث (find/search)
 *
 * Optionally followed by directional connectors: إلى، الى، لـ، ل، على، لي
 */
const THREAD_INTENT_VERB_REGEX = new RegExp(
  "^(?:" +
    // "افتح" — open
    "افتح" +
    // "اذهب" (+ optional إلى/الى/ل) — go
    "|اذهب(?:\\s+(?:الى|إلى|ل[ـ]?))?" +
    // "روح" / "روّح" (+ optional على/إلى/الى)
    "|رو\\s*[ّح]?(?:\\s+(?:على|الى|إلى))?" +
    // "جيب" (+ optional لي) — bring (me)
    "|جيب(?:\\s+لي)?" +
    // "وريني" — show me
    "|وريني" +
    // "خذني" — take me
    "|خذني(?:\\s+(?:على|الى|إلى))?" +
    // "ودّني" / "ودني" — take me (Gulf dialect)
    "|ود\\s*[ّ]?ني(?:\\s+(?:على|الى|إلى))?" +
    // "انقلني" — move/transfer me
    "|انقلني(?:\\s+(?:الى|إلى|على))?" +
    // "رجّعني" / "رجعني" — take me back
    "|رج\\s*[ّ]?\\s*ع\\s*[ّ]?ني(?:\\s+(?:على|الى|إلى))?" +
    // "دور" / "ابحث" — find / search
    "|دور(?:\\s+لي)?" +
    "|ابحث(?:\\s+لي)?" +
  ")(?:\\s+|$)",
);

// ---------------------------------------------------------------------------
// Title Sanitization — Filler Word Stripping
// ---------------------------------------------------------------------------

/**
 * Ordered list of Arabic filler words that commonly appear between the verb
 * and the actual chat title. Stripped iteratively from the beginning of the
 * extracted text until no more filler remains.
 *
 * Examples of what this removes:
 *   "شات اسمه X"  →  "X"
 *   "المحادثة تبع X"  →  "X"
 *   "موضوع باسم X"  →  "X"
 */
const TITLE_FILLER_WORDS: readonly string[] = [
  "شات",
  "محادثه",
  "محادثة",
  "موضوع",
  "تشارت",
  "اسمه",
  "باسم",
  "بعنوان",
  "تبع",
  "تبعت",
  "حق",
  "حقت",
  "متاع",
  "اللي",
  "الي",
] as const;

/**
 * Directional connector particles that may appear at the start of the
 * extracted text (either standalone or attached to the next word).
 *
 * In Arabic, prepositions like "لـ" (to/for) and "بـ" (with/by) attach
 * directly to the following noun without a space, e.g. "لشات" = "to chat".
 * This regex strips those leading connectors iteratively.
 *
 * Ordered longest-first to prevent partial matches (e.g. "الى" before "ا").
 */
const CONNECTOR_STRIP_REGEX =
  /^(?:الى|إلى|عن|على|ل[ـ]?|ب[ـ]?)\s*/i;

/**
 * Iteratively strip leading filler words from the raw extracted text
 * until the actual chat title remains.
 */
function sanitizeSearchTitle(raw: string): string {
  let title = raw.trim();
  let changed = true;

  // Keep stripping as long as a filler or connector is found at the start.
  // Iterative because fillers can stack: "لشات اسمه المشروع" → "المشروع"
  while (changed && title.length > 0) {
    changed = false;

    // Step A: Strip attached directional connectors (لـ, بـ, الى, etc.)
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

  // Phase 1: Detect imperative verb → this IS a thread-open intent
  if (!THREAD_INTENT_VERB_REGEX.test(trimmed)) {
    return null;
  }

  // Phase 2: Strip the verb phrase to get raw title candidate
  const rawTitle = trimmed.replace(THREAD_INTENT_VERB_REGEX, "").trim();

  // Phase 3: Sanitize — strip leading filler words iteratively
  const searchTitle = sanitizeSearchTitle(rawTitle);

  // Must have meaningful content left after sanitization (≥ 2 chars)
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

    const escapedTitle = searchTitle.replace(/[%_\\]/g, "\\$&");

    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, title")
      .eq("user_id", userId)
      .ilike("title", `%${escapedTitle}%`)
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
