import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { streamText } from "ai";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { createLogger } from "../utils/logger.js";
import { moderateInput } from "../services/chat/moderation.service.js";
import { createProviderClient, getProviderAndModel } from "./chat/chat-shared.js";
import { guestIpLimiter, guestStatusLimiter } from "../middleware/rate-limiters.js";
import { withTimeout, TIMEOUTS } from "../utils/timeout-wrapper.js";
import redis from "../config/redis/client.js";

const log = createLogger("guest-chat");

// ---------------------------------------------------------------------------
// i18n refusal messages + locale detection
// ---------------------------------------------------------------------------

const REFUSAL_TEXT: Record<string, string> = {
  en: "I can't help with that request. Could you try rephrasing?",
  ar: "لا أستطيع المساعدة في هذا الطلب. هل يمكنك إعادة صياغته؟",
};

function resolveLocale(req: any): string {
  const accept = req.headers["accept-language"] ?? "";
  return accept.includes("ar") ? "ar" : "en";
}

/** Send a refusal text as a single AI SDK SSE chunk and close the response. */
function sendRefusalChunk(res: any, text: string): void {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.write(`0:${JSON.stringify(text)}\n`);
  res.end();
}

const router = Router();

// ---------------------------------------------------------------------------
// FIX 1: Model pinning — server-controlled, client cannot override
// ---------------------------------------------------------------------------

const GUEST_MODEL = process.env.GUEST_MODEL ?? "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// FIX 3: Zod body validation — replaces manual checks
// ---------------------------------------------------------------------------

const GuestChatBodySchema = z.object({
  message: z.string().min(1, "Message is required").max(10_000, "Message too long"),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(10_000),
      }),
    )
    .max(10, "Conversation history too long")
    .default([]),
});

/**
 * Sanitize conversation history to prevent prompt injection attacks.
 * - Strips any messages with system/developer roles (shouldn't exist but defense in depth)
 * - Removes empty messages
 * - Trims whitespace from content
 * - Limits total history length to prevent token abuse
 */
function sanitizeConversationHistory(
  history: Array<{ role: string; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  const MAX_HISTORY_CONTENT_LENGTH = 50_000; // Total chars across all messages
  const sanitized: Array<{ role: "user" | "assistant"; content: string }> = [];
  let totalLength = 0;

  for (const msg of history) {
    // Only allow user/assistant roles (defense in depth - Zod already validates this)
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    // Trim and skip empty messages
    const content = msg.content.trim();
    if (!content) continue;

    // Check total content length to prevent token abuse
    totalLength += content.length;
    if (totalLength > MAX_HISTORY_CONTENT_LENGTH) break;

    sanitized.push({
      role: msg.role as "user" | "assistant",
      content,
    });
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Guest cookie + rate limiting (self-contained, no external middleware deps)
// ---------------------------------------------------------------------------

const GUEST_COOKIE = "guest_id";
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_GUEST_MESSAGES = 4;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h fixed window (matches cookie lifetime)

// Server-side transcript constants
const TRANSCRIPT_KEY_PREFIX = "guest:transcript:";
const MAX_TRANSCRIPT_MESSAGES = 20; // Keep last 20 turns (user+assistant pairs)
const MAX_TRANSCRIPT_CHARS = 40_000; // Total chars cap for transcript

/**
 * Parse raw Cookie header string into a key→value map.
 * No external cookie-parser dependency needed.
 */
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const [rawKey, ...rest] = pair.split("=");
    const key = rawKey?.trim();
    if (key) cookies[key] = rest.join("=").trim();
  }
  return cookies;
}

// ── Fixed-window counters (Redis-backed when available, in-memory fallback) ─
// FIX 5: Uses Redis when available for multi-instance deployments.
// Falls back to in-memory Map for development/single-instance.
// Cleanup runs every 30 minutes for in-memory fallback.
//
// Fixed-window algorithm: TTL is set ONLY when the counter is first created.
// Subsequent INCR calls do NOT extend the TTL, so the window stays anchored
// to the first request in each 24-hour period.

interface GuestWindow {
  count: number;
  resetTimeMs: number;
}

// In-memory fallback (single-instance only)
const guestWindows = new Map<string, GuestWindow>();

// Periodic cleanup — remove expired entries every 30 minutes (in-memory only)
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

function startInMemoryCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, win] of guestWindows) {
      if (win.resetTimeMs <= now) {
        guestWindows.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) log.debug(`Guest rate-limit cleanup: removed ${cleaned} expired entries`);
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

// Start cleanup if not using Redis
const useRedis = process.env.RATE_LIMIT_STORE === "redis";
if (!useRedis) {
  startInMemoryCleanup();
}

/**
 * Check if Redis is available and responsive.
 * The ping result is cached briefly (both success and failure): during a Redis
 * outage every guest request would otherwise pay the full retry/backoff
 * latency of a failing PING, amplifying outage-induced latency.
 */
const REDIS_PING_CACHE_MS = 5_000;
let lastPingAt = 0;
let lastPingOk = false;

async function isRedisAvailable(): Promise<boolean> {
  if (!useRedis) return false;
  if (Date.now() - lastPingAt < REDIS_PING_CACHE_MS) return lastPingOk;
  try {
    if (typeof redis.ping === "function") {
      await redis.ping();
      lastPingOk = true;
    } else {
      lastPingOk = false;
    }
  } catch {
    lastPingOk = false;
  }
  lastPingAt = Date.now();
  return lastPingOk;
}

/**
 * Lua script for fixed-window guest quota.
 *
 * Behavior:
 * - INCR the counter.
 * - If the counter is 1 (first request in window), set EXPIRE to anchor the window.
 * - If the counter is > 1, do NOT call EXPIRE (window stays anchored).
 * - Return [count, ttl_seconds].
 *
 * This ensures a guest gets exactly 4 messages in a fixed 24-hour window;
 * sending more messages does NOT extend the reset time.
 */
const FIXED_WINDOW_LUA = `
  local key = KEYS[1]
  local window_seconds = tonumber(ARGV[1])

  local count = redis.call('INCR', key)

  if count == 1 then
    -- First message in this window: anchor the TTL
    redis.call('EXPIRE', key, window_seconds)
  end

  local ttl = redis.call('TTL', key)
  -- TTL of -1 means no expiry (shouldn't happen), -2 means key missing
  if ttl < 0 then
    ttl = window_seconds
  end

  return { count, ttl }
`;

// Register the Lua command on the Redis client
(redis as any).defineCommand("guestFixedWindowIncr", {
  numberOfKeys: 1,
  lua: FIXED_WINDOW_LUA,
});

/**
 * Increment the guest message counter using Redis with fixed-window semantics.
 * Returns { allowed, count, limit, retryAfterMs }.
 */
async function incrementGuestCountRedis(guestId: string): Promise<{
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterMs: number;
}> {
  const key = `guest:count:${guestId}`;
  const windowSeconds = Math.floor(WINDOW_MS / 1000);

  try {
    // Use atomic Lua script for fixed-window semantics
    const result = await (redis as any).guestFixedWindowIncr(key, windowSeconds);
    const [count, ttl] = result as [number, number];
    const retryAfterMs = ttl > 0 ? ttl * 1000 : WINDOW_MS;

    return {
      allowed: count <= MAX_GUEST_MESSAGES,
      count,
      limit: MAX_GUEST_MESSAGES,
      retryAfterMs,
    };
  } catch (err) {
    log.error("Redis guest rate limit error, falling back to in-memory", {
      error: (err as Error)?.message,
    });
    // Fall back to in-memory
    return incrementGuestCountMemory(guestId);
  }
}

/**
 * Read the current guest count without incrementing.
 * Used by GET /status.
 */
async function readGuestCountRedis(guestId: string): Promise<{
  count: number;
  limit: number;
  retryAfterMs: number;
}> {
  const key = `guest:count:${guestId}`;
  try {
    const rawCount = await redis.get(key);
    const count = rawCount ? parseInt(rawCount, 10) : 0;
    const ttl = await redis.ttl(key);
    const retryAfterMs = ttl > 0 ? ttl * 1000 : WINDOW_MS;
    return { count, limit: MAX_GUEST_MESSAGES, retryAfterMs };
  } catch (err) {
    log.error("Redis guest status read error", { error: (err as Error)?.message });
    return { count: 0, limit: MAX_GUEST_MESSAGES, retryAfterMs: WINDOW_MS };
  }
}

/**
 * Decrement the guest message counter (rollback on failed request).
 * Only decrements if count > 0.
 */
async function decrementGuestCountRedis(guestId: string): Promise<void> {
  const key = `guest:count:${guestId}`;
  try {
    await redis.decr(key);
    // Ensure key still has TTL (decr on a new key would remove expiry)
    const ttl = await redis.ttl(key);
    if (ttl === -1) {
      // Key exists but no TTL — set it
      await redis.expire(key, Math.floor(WINDOW_MS / 1000));
    }
  } catch (err) {
    log.warn("Redis guest quota rollback failed", { error: (err as Error)?.message });
  }
}

/**
 * Increment the guest message counter using in-memory Map.
 * Returns { allowed, count, limit, retryAfterMs }.
 */
function incrementGuestCountMemory(guestId: string): {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterMs: number;
} {
  const now = Date.now();
  const existing = guestWindows.get(guestId);

  if (existing && existing.resetTimeMs > now) {
    existing.count++;
    return {
      allowed: existing.count <= MAX_GUEST_MESSAGES,
      count: existing.count,
      limit: MAX_GUEST_MESSAGES,
      retryAfterMs: existing.resetTimeMs - now,
    };
  }

  // New window
  const entry: GuestWindow = { count: 1, resetTimeMs: now + WINDOW_MS };
  guestWindows.set(guestId, entry);
  return {
    allowed: true,
    count: 1,
    limit: MAX_GUEST_MESSAGES,
    retryAfterMs: WINDOW_MS,
  };
}

/**
 * Read the current guest count without incrementing (in-memory).
 */
function readGuestCountMemory(guestId: string): {
  count: number;
  limit: number;
  retryAfterMs: number;
} {
  const now = Date.now();
  const existing = guestWindows.get(guestId);
  if (existing && existing.resetTimeMs > now) {
    return { count: existing.count, limit: MAX_GUEST_MESSAGES, retryAfterMs: existing.resetTimeMs - now };
  }
  return { count: 0, limit: MAX_GUEST_MESSAGES, retryAfterMs: WINDOW_MS };
}

/**
 * Decrement the guest message counter (in-memory rollback).
 */
function decrementGuestCountMemory(guestId: string): void {
  const existing = guestWindows.get(guestId);
  if (existing && existing.count > 0) {
    existing.count--;
  }
}

/**
 * Increment the guest message counter.
 * Uses Redis when available for multi-instance support, otherwise in-memory.
 */
async function incrementGuestCount(guestId: string): Promise<{
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterMs: number;
}> {
  if (useRedis && (await isRedisAvailable())) {
    return incrementGuestCountRedis(guestId);
  }
  return incrementGuestCountMemory(guestId);
}

/**
 * Read the current guest count without incrementing.
 */
async function readGuestCount(guestId: string): Promise<{
  count: number;
  limit: number;
  retryAfterMs: number;
}> {
  if (useRedis && (await isRedisAvailable())) {
    return readGuestCountRedis(guestId);
  }
  return readGuestCountMemory(guestId);
}

/**
 * Decrement the guest message counter (rollback on failure).
 */
async function decrementGuestCount(guestId: string): Promise<void> {
  if (useRedis && (await isRedisAvailable())) {
    await decrementGuestCountRedis(guestId);
  } else {
    decrementGuestCountMemory(guestId);
  }
}

// ─── Guest ID middleware ──────────────────────────────────────────────────────
// Reads or generates the anonymous cookie. Attaches guestId to req for
// downstream use. Sets the cookie on the response if newly generated.

function guestCookieMiddleware(req: any, res: any, next: any): void {
  const cookies = parseCookies(req.headers.cookie);
  let guestId = cookies[GUEST_COOKIE];

  if (!guestId) {
    guestId = randomUUID();

    // Cookie configuration based on environment
    const isProduction = process.env.NODE_ENV === "production";
    const sameSite = process.env.GUEST_COOKIE_SAMESITE || "Lax";

    // SameSite=None MUST have Secure flag (browser requirement)
    const requireSecure = sameSite === "None" || isProduction;

    const cookieParts = [
      `${GUEST_COOKIE}=${guestId}`,
      "Path=/",
      `Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`,
      "HttpOnly",
      requireSecure ? "Secure" : "",
      `SameSite=${sameSite}`,
    ].filter(Boolean);

    res.setHeader("Set-Cookie", cookieParts.join("; "));

    log.debug("Guest cookie created", {
      sameSite,
      secure: requireSecure,
      isProduction,
    });
  }

  req.guestId = guestId;
  next();
}

// ── Guest rate-limit middleware ──────────────────────────────────────────────
// Returns 429 with a structured body the frontend can parse directly.
// IMPORTANT: This runs AFTER body validation (moved to route handler).

async function guestRateLimitMiddleware(req: any, res: any, next: any): Promise<void> {
  const guestId: string | undefined = req.guestId;
  if (!guestId) {
    res.status(400).json({ error: "Missing guest session" });
    return;
  }

  const { allowed, count, limit, retryAfterMs } = await incrementGuestCount(guestId);

  // Always set these headers so the frontend can read quota state
  res.setHeader("X-Guest-Message-Count", String(count));
  res.setHeader("X-Guest-Message-Limit", String(limit));
  res.setHeader("X-Guest-Retry-After", String(Math.ceil(retryAfterMs / 1000)));

  if (!allowed) {
    res.status(429).json({
      error: "guest_limit_reached",
      limitReached: true,
      message:
        "You've used all your free messages. Sign in to continue chatting — it's quick and free!",
      count,
      limit,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    });
    return;
  }

  next();
}

// ─── Server-side guest transcript storage ───────────────────────────────────
// Stores conversation history in Redis keyed by guest_id.
// The server builds the LLM history from this transcript, NOT from
// client-provided assistant messages (which could be forged).
//
// Fallback: When Redis is unavailable, the client-provided history is used
// with strict sanitization (roles restricted to user/assistant, length capped).
// This is documented and logged as degraded mode.

function transcriptKey(guestId: string): string {
  return `${TRANSCRIPT_KEY_PREFIX}${guestId}`;
}

interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * Load the server-side transcript for a guest.
 */
async function loadTranscript(guestId: string): Promise<TranscriptEntry[]> {
  if (useRedis && (await isRedisAvailable())) {
    try {
      const raw = await redis.get(transcriptKey(guestId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as TranscriptEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      log.warn("Failed to load guest transcript from Redis", { error: (err as Error)?.message });
      return [];
    }
  }
  // In-memory fallback: no transcript persistence across requests
  return [];
}

/**
 * Lua script for atomic transcript append with fixed-window TTL.
 * Appends entries to the JSON array, trims to max size, and only sets
 * TTL on first write (fixed-window semantics).
 */
const TRANSCRIPT_APPEND_LUA = `
  local key = KEYS[1]
  local new_entries_json = ARGV[1]
  local max_messages = tonumber(ARGV[2])
  local max_chars = tonumber(ARGV[3])
  local window_seconds = tonumber(ARGV[4])

  -- Load existing transcript
  local raw = redis.call('GET', key)
  local existing = {}
  if raw then
    existing = cjson.decode(raw)
  end

  -- Append new entries
  local new_entries = cjson.decode(new_entries_json)
  for _, entry in ipairs(new_entries) do
    table.insert(existing, entry)
  end

  -- Trim to max messages (keep most recent)
  while #existing > max_messages do
    table.remove(existing, 1)
  end

  -- Enforce total char cap (walk backwards)
  local total_chars = 0
  local bounded = {}
  for i = #existing, 1, -1 do
    total_chars = total_chars + #existing[i].content
    if total_chars > max_chars and #bounded > 0 then
      break
    end
    table.insert(bounded, 1, existing[i])
  end

  -- Write back with fixed-window TTL
  local serialized = cjson.encode(bounded)
  if redis.call('EXISTS', key) == 0 then
    -- Key is new — anchor TTL
    redis.call('SETEX', key, window_seconds, serialized)
  else
    -- Key exists — overwrite value without touching TTL
    redis.call('SET', key, serialized)
  end

  return #bounded
`;

// Register the transcript Lua command
(redis as any).defineCommand("guestAppendTranscript", {
  numberOfKeys: 1,
  lua: TRANSCRIPT_APPEND_LUA,
});

/**
 * Append entries to the server-side transcript and trim to bounds.
 * Uses a Lua script for atomic append with fixed-window TTL:
 * the 24h window is anchored to the first message, not the last.
 */
async function appendTranscript(guestId: string, entries: TranscriptEntry[]): Promise<void> {
  if (entries.length === 0) return;

  if (useRedis && (await isRedisAvailable())) {
    try {
      const key = transcriptKey(guestId);
      const windowSeconds = Math.floor(WINDOW_MS / 1000);
      await (redis as any).guestAppendTranscript(
        key,
        JSON.stringify(entries),
        MAX_TRANSCRIPT_MESSAGES,
        MAX_TRANSCRIPT_CHARS,
        windowSeconds,
      );
    } catch (err) {
      log.warn("Failed to save guest transcript to Redis", { error: (err as Error)?.message });
    }
  }
  // In-memory fallback: transcript not persisted across requests.
  // When Redis is unavailable, guest conversations have no cross-request history.
  // The LLM receives only the current message (no prior context).
}

// ---------------------------------------------------------------------------
// Guest system prompt — helpful assistant, no tools, gentle sign-in nudge
// ---------------------------------------------------------------------------

const GUEST_SYSTEM_PROMPT = `You are a helpful AI assistant. You are knowledgeable, friendly, and thorough in your responses.

CRITICAL: Always respond in the SAME LANGUAGE the user writes in. If they write in Arabic, respond in Arabic. If they write in English, respond in English. If they write in French, respond in French. Match their language exactly.

IMPORTANT — Guest Mode limitations:
- You do NOT have access to tools like email, calendar, saved documents, course materials, or any external integrations.
- You do NOT have access to the user's personal data, history, or academic records.
- You CAN answer general questions, help with writing, explain concepts, brainstorm ideas, and have conversations on any topic.

When a user asks for something that requires tools or personal data (e.g., "send me my notes", "what's on my calendar", "email my professor", "summarize my course material"):
- Do NOT say you can't do it in a cold or robotic way.
- Instead, warmly acknowledge what they want, explain that this feature is available for signed-in users, and encourage them to create a free account to unlock it.
- Keep it brief, natural, and helpful — like a friendly suggestion, not a hard wall.

Example: "I'd love to help with that! To access your course materials and saved notes, you'll need to sign in — it's quick and free. Once you're in, I can pull up everything for you. Want me to help you get started?"

Otherwise, just be a great assistant. Answer thoroughly and helpfully.`;

// ---------------------------------------------------------------------------
// GET /api/guest/status — Return current guest session status
// Uses a lightweight dedicated limiter (not the chat IP limiter)
// ---------------------------------------------------------------------------

router.get(
  "/status",
  guestStatusLimiter,
  guestCookieMiddleware,
  asyncHandler(async (req, res) => {
    const guestId = (req as any).guestId;
    if (!guestId) {
      res.status(400).json({ error: "Missing guest session" });
      return;
    }

    const { count, limit, retryAfterMs } = await readGuestCount(guestId);

    res.json({
      count,
      limit,
      limitReached: count >= limit,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/guest/chat — stateless guest chat endpoint
// IMPORTANT: Body validation runs BEFORE quota increment to prevent
// malformed requests from consuming quota.
// ---------------------------------------------------------------------------

router.post(
  "/chat",
  guestIpLimiter,
  guestCookieMiddleware,
  // NOTE: guestRateLimitMiddleware is NOT in the middleware chain here.
  // We validate the body first, then increment quota inside the handler.
  asyncHandler(async (req, res) => {
    const guestId: string | undefined = (req as any).guestId;
    if (!guestId) {
      res.status(400).json({ error: "Missing guest session" });
      return;
    }

    // --- FIX 3: Zod validation BEFORE quota increment ---
    const parsed = GuestChatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      // Invalid request — do NOT consume quota
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { message, conversationHistory } = parsed.data;

    // --- Input moderation (fail-OPEN for guest availability) ---
    try {
      // Check if message contains image content
      const hasImage = conversationHistory.some((msg: any) => {
        const content = msg.content;
        if (!content) return false;
        if (typeof content === "string") {
          return (
            content.startsWith("data:image/") ||
            content.includes("<img") ||
            content.includes("image/") ||
            content.includes("![")
          );
        }
        if (Array.isArray(content)) {
          return content.some(
            (p: any) => p.type === "image" || (p.type === "file" && p.name?.includes("image"))
          );
        }
        return false;
      });

      if (hasImage) {
        const locale = resolveLocale(req);
        sendRefusalChunk(
          res,
          REFUSAL_TEXT[locale] ??
            REFUSAL_TEXT.en.replace(
              "I can't help with that request",
              "I can't process images in guest mode. Please sign in to use this feature."
            )
        );
        return;
      }

      const modResult = await withTimeout(
        moderateInput([{ role: "user", content: message.trim() }]),
        { timeoutMs: TIMEOUTS.MODERATION, operationName: "guest_moderation" }
      );
      // Only block if moderation explicitly flagged the content as harmful
      if (
        modResult.blocked &&
        modResult.error &&
        !modResult.error.includes("temporarily unavailable")
      ) {
        const locale = resolveLocale(req);
        sendRefusalChunk(res, REFUSAL_TEXT[locale] ?? REFUSAL_TEXT.en);
        return;
      }
    } catch (err) {
      // Timeout or any error → fail-OPEN, proceed to LLM
      log.warn("Guest moderation unavailable, proceeding without it", {
        error: (err as Error)?.message,
      });
    }

    // --- Increment quota ONLY after validation passes ---
    const { allowed, count, limit, retryAfterMs } = await incrementGuestCount(guestId);

    // Always set these headers so the frontend can read quota state
    res.setHeader("X-Guest-Message-Count", String(count));
    res.setHeader("X-Guest-Message-Limit", String(limit));
    res.setHeader("X-Guest-Retry-After", String(Math.ceil(retryAfterMs / 1000)));

    if (!allowed) {
      res.status(429).json({
        error: "guest_limit_reached",
        limitReached: true,
        message:
          "You've used all your free messages. Sign in to continue chatting — it's quick and free!",
        count,
        limit,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      });
      return;
    }

    // --- Build messages from SERVER-SIDE transcript (not client history) ---
    // Client-provided conversationHistory is IGNORED for LLM context.
    // The server maintains its own transcript to prevent prompt injection.
    const serverTranscript = await loadTranscript(guestId);
    const messages = [
      ...serverTranscript,
      { role: "user" as const, content: message.trim() },
    ];

    // --- Set SSE headers (matching existing chat endpoint) ---
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // --- Stream the response with automatic model fallback ---
    const guestCandidateModels = [
      process.env.GUEST_MODEL || "qwen/qwen3.6-27b",
    ].filter((v, i, a) => a.indexOf(v) === i);

    log.info("Guest chat request", {
      messageLength: message.trim().length,
      transcriptLength: serverTranscript.length,
      candidateModels: guestCandidateModels,
    });

    let streamedAnyChunk = false;
    let fullResponse = "";
    let lastError: Error | null = null;

    for (const currentModelId of guestCandidateModels) {
      try {
        const resolved = getProviderAndModel(currentModelId);
        const providerClient = createProviderClient(resolved.provider);
        const modelName = resolved.modelName;

        log.info("Attempting guest chat stream", {
          modelId: currentModelId,
          modelName,
          provider: resolved.provider,
        });

        const result = streamText({
          model: providerClient.chat(modelName),
          messages,
          system: GUEST_SYSTEM_PROMPT,
          maxOutputTokens: 4096,
          abortSignal: AbortSignal.timeout(120_000),
        });

        for await (const chunk of result.textStream) {
          if (!res.writable) break;
          streamedAnyChunk = true;
          fullResponse += chunk;
          res.write(`0:${JSON.stringify(chunk)}\n`);
        }

        if (streamedAnyChunk) {
          break; // Succeeded!
        }
      } catch (err) {
        lastError = err as Error;
        log.warn(`Guest chat model ${currentModelId} failed`, {
          error: (err as Error)?.message,
        });
        if (streamedAnyChunk) {
          break;
        }
      }
    }

    if (!streamedAnyChunk) {
      log.error("All guest models failed to stream", {
        error: lastError?.message,
      });
      await decrementGuestCount(guestId);
      if (!res.headersSent) {
        res.status(500).json({ error: "AI service temporarily unavailable" });
      } else {
        const fallbackMsg = "عذراً، حدث خطأ أثناء الاتصال بالخادم. يرجى المحاولة مرة أخرى لاحقاً.";
        res.write(`0:${JSON.stringify(fallbackMsg)}\n`);
        res.end();
      }
      return;
    }

    // --- Persist to server-side transcript AFTER successful stream ---
    await appendTranscript(guestId, [
      { role: "user", content: message.trim() },
      { role: "assistant", content: fullResponse },
    ]);

    res.end();
  }),
);

export default router;
