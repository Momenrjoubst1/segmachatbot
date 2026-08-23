/**
 * Voice transcript flush — persistence bridge for live sessions.
 *
 * While a Voice Agent session runs, the /ws/voice-agent relay appends every
 * finalized ConversationText turn to a Redis list keyed by the browser-side
 * conversation id (`va:transcript:<sid>`). When the session ends, this module
 * drains that buffer and writes it into the SAME store text chat uses
 * (`chat_sessions` + `chat_messages`), so voice conversations show up in the
 * thread list exactly like typed ones — including cross-device.
 *
 * Fire-and-forget by contract: a failed flush must never break session
 * teardown. The Redis buffer carries a 24h TTL as a retry window.
 */

import { createLogger } from "../../utils/logger.js";
import redis from "../../config/redis/client.js";
import { triggerChatTitlingAsync } from "../chat-title-generator.service.js";

const log = createLogger("voice-flush");

const TRANSCRIPT_TTL_SECONDS = 24 * 60 * 60;
const MAX_BUFFERED_TURNS = 80;
const MAX_CONTENT_CHARS = 8_000;

export function voiceTranscriptKey(sid: string): string {
  return `va:transcript:${sid}`;
}

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

interface RawTurn {
  role?: unknown;
  content?: unknown;
}

/**
 * The redis export unions MockRedis (dev) with ioredis; LTRIM/INCRBY exist
 * only on the real client. Capability-check via this narrowed view so dev
 * degrades gracefully instead of crashing.
 */
const cappedRedis = redis as unknown as {
  rpush(key: string, ...vals: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  expire?(key: string, seconds: number): Promise<number>;
  ltrim?(key: string, start: number, stop: number): Promise<unknown>;
  del(key: string): Promise<number>;
};

/** Append one finalized turn. Best-effort; called on the relay hot path. */
export async function appendVoiceTurn(sid: string | null, turn: VoiceTurn): Promise<void> {
  if (!sid || !turn.content) return;
  try {
    const key = voiceTranscriptKey(sid);
    await cappedRedis.rpush(key, JSON.stringify({ role: turn.role, content: turn.content.slice(0, MAX_CONTENT_CHARS) }));
    cappedRedis.ltrim?.(key, -MAX_BUFFERED_TURNS, -1);
    await cappedRedis.expire?.(key, TRANSCRIPT_TTL_SECONDS);
  } catch {
    /* metering/transcript must never throw into the relay loop */
  }
}

/** Prior turns for a sid (oldest first) — merged into think requests after reconnects. */
export async function loadVoiceTranscript(sid: string | null): Promise<VoiceTurn[]> {
  if (!sid) return [];
  try {
    const raw = await redis.lrange(voiceTranscriptKey(sid), 0, -1);
    const turns: VoiceTurn[] = [];
    for (const line of raw) {
      try {
        const t = JSON.parse(line) as RawTurn;
        const role = t.role === "assistant" ? "assistant" : "user";
        const content = typeof t.content === "string" ? t.content.trim() : "";
        if (!content) continue;
        // Collapse consecutive same-role entries (defensive vs provider dupes).
        const prev = turns[turns.length - 1];
        if (prev && prev.role === role) {
          if (prev.content !== content) prev.content = `${prev.content}\n${content}`.slice(0, MAX_CONTENT_CHARS);
          continue;
        }
        turns.push({ role, content });
      } catch {
        /* skip malformed line */
      }
    }
    return turns;
  } catch {
    return [];
  }
}

/** True when a resume already has buffered history (relay uses it to skip greetings). */
export async function hasVoiceHistory(sid: string | null): Promise<boolean> {
  if (!sid) return false;
  try {
    // LRANGE 0..0 instead of LLEN — MockRedis (dev) lacks LLEN.
    const head = await cappedRedis.lrange(voiceTranscriptKey(sid), 0, 0);
    return head.length > 0;
  } catch {
    return false;
  }
}

async function releaseBuffer(sid: string | null): Promise<void> {
  if (!sid) return;
  try {
    await cappedRedis.del(voiceTranscriptKey(sid));
  } catch {
    /* TTL is the backstop */
  }
}

/**
 * Drain `va:transcript:<sid>` into chat_sessions/chat_messages.
 * Returns the created thread id, or null when there was nothing worth saving.
 */
export async function flushVoiceTranscriptToThread(
  userId: string,
  sid: string | null,
): Promise<string | null> {
  let turns: VoiceTurn[] = [];
  try {
    turns = await loadVoiceTranscript(sid);
  } finally {
    // Release early so a crash mid-flush can't double-insert on a later flush.
    await releaseBuffer(sid);
  }

  const userTurns = turns.filter((t) => t.role === "user");
  if (userTurns.length === 0) return null;

  const { supabase } = await import("../rag/rag-supabase-client.js");

  const { data: session, error: sessionErr } = await supabase
    .from("chat_sessions")
    .insert([{ title: "New Chat", user_id: userId }])
    .select("id")
    .single();

  if (sessionErr || !session) {
    log.error("Failed to create thread for voice transcript", {
      error: sessionErr?.message,
      userId,
      turns: turns.length,
    });
    return null;
  }

  const threadId = (session as { id: string }).id;

  const rows = turns.map((t) => ({
    session_id: threadId,
    role: t.role,
    content: t.content,
  }));

  const { error: msgErr } = await supabase.from("chat_messages").insert(rows);
  if (msgErr) {
    log.error("Failed to persist voice transcript", {
      error: msgErr.message,
      threadId,
      rows: rows.length,
    });
    return threadId; // thread exists even if messages failed — better than nothing
  }

  // Same async titling the text-chat cache-hit path uses.
  try {
    triggerChatTitlingAsync(threadId);
  } catch {
    /* title stays "New Chat" */
  }

  log.info("Voice transcript persisted", { userId, threadId, turns: turns.length });
  return threadId;
}
