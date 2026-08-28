import { randomUUID } from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { streamText } from "ai";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { createLogger } from "../utils/logger.js";
import { moderateInput } from "../services/chat/moderation.service.js";
import { createProviderClient, getProviderAndModel, stripThinkTags } from "./chat/chat-shared.js";
import { getModelMaxOutputTokens } from "../services/memory/model-context.js";
import { guestIpLimiter, guestStatusLimiter } from "../middleware/rate-limiters.js";
import { withTimeout, TIMEOUTS } from "../utils/timeout-wrapper.js";
import redis from "../config/redis/client.js";
import { GUEST_SYSTEM_PROMPT } from "../prompts/guest-system-prompt.js";

const log = createLogger("guest-chat");

/** Express Request with guest session ID attached by guestCookieMiddleware. */
interface GuestRequest extends Request {
  guestId?: string;
}

// Locale-aware refusal messages and detection.

const REFUSAL_TEXT: Record<string, string> = {
  en: "I can't help with that request. Could you try rephrasing?",
  ar: "لا أستطيع المساعدة في هذا الطلب. هل يمكنك إعادة صياغته؟",
};

function resolveLocale(req: Request): string {
  const accept = req.headers["accept-language"] ?? "";
  return accept.includes("ar") ? "ar" : "en";
}

/** Send a refusal text as a single AI SDK SSE chunk and close the response. */
function sendRefusalChunk(res: Response, text: string): void {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.write(`0:${JSON.stringify(text)}\n`);
  res.end();
}

const router = Router();

// Server-controlled model pinning — clients cannot override.

// Zod validation of the guest chat body.

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

// Sanitize conversation history to blunt prompt injection and token abuse.
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

// Guest cookie and rate-limiting setup.

const GUEST_COOKIE = "guest_id";
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_GUEST_MESSAGES = 4;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h fixed window (matches cookie lifetime)

// Server-side transcript constants
const TRANSCRIPT_KEY_PREFIX = "guest:transcript:";
const MAX_TRANSCRIPT_MESSAGES = 20; // Keep last 20 turns (user+assistant pairs)
const MAX_TRANSCRIPT_CHARS = 40_000; // Total chars cap for transcript

// Parse a raw Cookie header into a key→value map without dependencies.
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const [rawKey, ...rest] = pair.split("=");
    const key = rawKey?.trim();
    if (key) {
      const rawValue = rest.join("=").trim();
      try {
        cookies[key] = decodeURIComponent(rawValue);
      } catch {
        cookies[key] = rawValue;
      }
    }
  }
  return cookies;
}

// Fixed-window guest counters: Redis-backed with in-memory fallback; TTL anchors on first INCR.

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

// Probe Redis availability with a briefly cached ping result.
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

// Lua script for the fixed-window guest quota: INCR, anchor EXPIRE once.
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
redis.defineCommand("guestFixedWindowIncr", {
  numberOfKeys: 1,
  lua: FIXED_WINDOW_LUA,
});

// Increment the guest counter in Redis with fixed-window semantics.
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
    const result = await redis.guestFixedWindowIncr(key, windowSeconds);
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

// Read the guest count without incrementing (used by GET /status).
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

// Roll back the Redis guest counter, never below zero.
async function decrementGuestCountRedis(guestId: string): Promise<void> {
  const key = `guest:count:${guestId}`;
  try {
    // Use Lua script for atomic check-and-decrement
    const result = await redis.eval(
      `
      local current = redis.call('GET', KEYS[1])
      if current then
        local count = tonumber(current)
        if count > 0 then
          redis.call('DECR', KEYS[1])
          return count - 1
        end
      end
      return 0
      `,
      1,
      key
    );
  } catch (err) {
    log.warn("Redis guest quota rollback failed", { error: (err as Error)?.message });
  }
}

// Increment the guest counter in the in-memory Map.
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

// Read the guest count without incrementing (in-memory).
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

// Roll back the in-memory guest counter, never below zero.
function decrementGuestCountMemory(guestId: string): void {
  const existing = guestWindows.get(guestId);
  if (existing && existing.count > 0) {
    existing.count = Math.max(0, existing.count - 1);
  }
}

// Increment the guest counter via Redis or the in-memory fallback.
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

// Read the guest count without incrementing.
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

// Roll back the guest counter after a failed request.
async function decrementGuestCount(guestId: string): Promise<void> {
  if (useRedis && (await isRedisAvailable())) {
    await decrementGuestCountRedis(guestId);
  } else {
    decrementGuestCountMemory(guestId);
  }
}

// Guest ID middleware: reads or generates the anonymous cookie for the request.

function guestCookieMiddleware(req: Request, res: Response, next: NextFunction): void {
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

  (req as GuestRequest).guestId = guestId;
  next();
}

// Guest rate-limit middleware answering 429 with a structured body.

async function guestRateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const guestId: string | undefined = (req as GuestRequest).guestId;
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

// Server-side guest transcript in Redis; degraded fallback uses sanitized client history.

function transcriptKey(guestId: string): string {
  return `${TRANSCRIPT_KEY_PREFIX}${guestId}`;
}

interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
}

// Load the server-side transcript for a guest.
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

// Lua script appending transcript entries atomically with an anchored TTL.
const TRANSCRIPT_APPEND_LUA = `
  local key = KEYS[1]
  local new_entries_json = ARGV[1]
  local max_messages = tonumber(ARGV[2])
  local max_chars = tonumber(ARGV[3])
  local window_seconds = tonumber(ARGV[4])

  -- Load existing transcript (single atomic GET)
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

  -- Write back with fixed-window TTL (atomic SET/SETEX)
  local serialized = cjson.encode(bounded)
  local exists = redis.call('EXISTS', key)
  if exists == 0 then
    -- Key is new — anchor TTL (fixed window starts now)
    redis.call('SETEX', key, window_seconds, serialized)
  else
    -- Key exists — overwrite value WITHOUT touching TTL
    redis.call('SET', key, serialized)
  end

  return #bounded
`;

// Register the transcript Lua command
redis.defineCommand("guestAppendTranscript", {
  numberOfKeys: 1,
  lua: TRANSCRIPT_APPEND_LUA,
});

// Append transcript entries atomically, trimmed with a first-write-anchored TTL.
async function appendTranscript(guestId: string, entries: TranscriptEntry[]): Promise<void> {
  if (entries.length === 0) return;

  if (useRedis && (await isRedisAvailable())) {
    try {
      const key = transcriptKey(guestId);
      const windowSeconds = Math.floor(WINDOW_MS / 1000);
      await redis.guestAppendTranscript(
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
  // In-memory fallback: no transcript persists across requests.
}

// Guest system prompt (imported from prompts/guest-system-prompt.ts).

// GET /api/guest/status — quota status via a lightweight dedicated limiter.

router.get(
  "/status",
  guestStatusLimiter,
  guestCookieMiddleware,
  asyncHandler(async (req, res) => {
    const guestId = (req as GuestRequest).guestId;
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

// POST /api/guest/chat — validates the body before any quota is consumed.

router.post(
  "/chat",
  guestIpLimiter,
  guestCookieMiddleware,
  // Quota is incremented inside the handler, after body validation.
  asyncHandler(async (req, res) => {
    const guestId: string | undefined = (req as GuestRequest).guestId;
    if (!guestId) {
      res.status(400).json({ error: "Missing guest session" });
      return;
    }

    // Zod validation before quota increment.
    const parsed = GuestChatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      // Invalid request — do NOT consume quota
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const { message, conversationHistory } = parsed.data;

    // Input moderation, failing open for guest availability.
    try {
      // Check if message contains image content
      const hasImage = conversationHistory.some((msg: { role: string; content: string | Array<{ type?: string; name?: string }> }) => {
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
            (p) => p.type === "image" || (p.type === "file" && p.name?.includes("image"))
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

    // Increment quota only after validation passes.
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

    // Build LLM context from the server-side transcript, not client history.
    const serverTranscript = await loadTranscript(guestId);
    const messages = [
      ...serverTranscript,
      { role: "user" as const, content: message.trim() },
    ];

    // Set SSE streaming headers.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Stream the response with automatic model fallback.
    // Groq direct cannot serve as the guest pin: the free-tier key admits at
    // most 8k tokens/min, so pinned requests above that are rejected at the
    // gate. These OpenRouter :free ids are verified-live but individually
    // flap under load (streams can end with zero text), so the chain spans
    // several upstreams and skips any candidate that yields no text.
    const guestCandidateModels = [
      process.env.GUEST_MODEL || "nvidia/nemotron-3.5-lightning:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "qwen/qwen3.6-27b",
    ].filter((v, i, a) => a.indexOf(v) === i);

    log.info("Guest chat request", {
      messageLength: message.trim().length,
      transcriptLength: serverTranscript.length,
      candidateModels: guestCandidateModels,
    });

    let streamedAnyChunk = false;
    let fullResponse = "";
    let lastError: Error | null = null;
    const MAX_RESPONSE_CHARS = 50_000;

    for (const currentModelId of guestCandidateModels) {
      try {
        const resolved = getProviderAndModel(currentModelId);
        const providerClient = createProviderClient(resolved.provider, { reasoningTap: true });
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
          maxOutputTokens: getModelMaxOutputTokens(currentModelId),
          abortSignal: AbortSignal.timeout(120_000),
          // Surface Gemini thoughts when the guest model supports them.
          providerOptions: {
            google: { thinkingConfig: { includeThoughts: true } },
          },
        });

        for await (const chunk of result.textStream) {
          if (!res.writable) break;
          streamedAnyChunk = true;
          fullResponse += chunk;
          res.write(`0:${JSON.stringify(chunk)}\n`);
          // Cap response to prevent memory exhaustion from pathological LLM output
          if (fullResponse.length > MAX_RESPONSE_CHARS) {
            log.warn("Guest response exceeded max length, aborting stream", {
              length: fullResponse.length,
              max: MAX_RESPONSE_CHARS,
            });
            // Mark the truncation visibly and persist it in the transcript.
            const truncationMarker = "\n\n_[تم اختصار الرد لأنه تجاوز الحد الأقصى للطول]_";
            fullResponse += truncationMarker;
            res.write(`0:${JSON.stringify(truncationMarker)}\n`);
            break;
          }
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

    // Persist post-stream, stripping UI-only <think> tags from the reply.
    await appendTranscript(guestId, [
      { role: "user", content: message.trim() },
      { role: "assistant", content: stripThinkTags(fullResponse) },
    ]);

    res.end();
  }),
);

export default router;
