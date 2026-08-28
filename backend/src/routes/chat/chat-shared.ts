// Chat shared: common utilities for chat routes.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { createLogger } from "../../utils/logger.js";

// Re-export modelRouter for access from route files
export { modelRouter, CircuitBreakerState, getGracefulDegradationMessage } from "../../services/chat/model-router.js";

// Re-export multi-agent prompts from their canonical location.
export {
  MAIN_AGENT_SYSTEM_PROMPT,
  CRITIC_AGENT_SYSTEM_PROMPT,
} from "../../prompts/multi-agent.js";

// Re-export provider utilities
export type { ProviderName, ReasoningEffort } from "./chat-providers.js";
export { getProviderAndModel, createProviderClient, createSecondModelClient, mapEffortForProvider, mapGoogleThinking } from "./chat-providers.js";
export { stripThinkTags } from "./chat-reasoning-tap.js";

export const log = createLogger("chat-api");
export const ragLog = createLogger("rag");
export const memLog = createLogger("memory");
export const trLog = createLogger("translate");

/** Minimal message shape used for log summaries. */
interface LogMessage {
  role?: string;
  content?: unknown;
  parts?: unknown;
}

export function summarizeMessageForLog(m: LogMessage | null | undefined): Record<string, unknown> {
  const partsArray = Array.isArray(m?.content) ? m.content : Array.isArray(m?.parts) ? m.parts : null;
  if (!partsArray) {
    return { role: m?.role ?? "unknown", parts: 0, textLength: typeof m?.content === "string" ? m.content.length : 0 };
  }
  let textLength = 0;
  let imageCount = 0;
  let fileCount = 0;
  for (const p of partsArray as Array<{ type?: string; text?: string }>) {
    if (p?.type === "text") textLength += (p.text || "").length;
    else if (p?.type === "image") imageCount += 1;
    else if (p?.type === "file") fileCount += 1;
  }
  return { role: m?.role ?? "unknown", parts: partsArray.length, textLength, imageCount, fileCount };
}

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "لقد تجاوزت الحد المسموح به من الرسائل. يرجى الانتظار قليلاً." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return userId;
    return 'unauthenticated';
  },
});

export const newChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "لقد تجاوزت حد إنشاء المحادثات. يرجى الانتظار." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return userId;
    const ip = req.ip || req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || 'unknown';
    return ipKeyGenerator(ip);
  },
});

// Model allowlist + default live in the model catalog (single source of
// truth) — services/memory/model-context.ts. Re-exported here for the
// route layer.
export { DEFAULT_MODEL, ALLOWED_MODELS } from "../../services/memory/model-context.js";

export async function ensureThreadOwnership(req: Request, threadId: string) {
  const userId = req.user?.id;
  if (!userId) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const { supabase } = await import("../../services/rag/rag-supabase-client.js");
  const { data: sessionRow, error } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!sessionRow) {
    return { error: "Thread not found", status: 404 as const };
  }

  return { supabase, userId };
}

const THREAD_OWNER_CACHE_TTL_S = 300;
const THREAD_OWNER_NEGATIVE_TTL_S = 60;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isThreadOwnedByUser(userId: string, threadId: string): Promise<boolean> {
  if (!UUID_SHAPE.test(threadId) || !userId) return false;
  const cacheKey = `thread:owner:${threadId}`;
  try {
    const { default: redis } = await import("../../config/redis/client.js");
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached === userId) return true;
    if (cached === "none") return false;
    if (cached && cached !== userId) return false;

    const { supabase } = await import("../../services/rag/rag-supabase-client.js");
    const { data } = await supabase
      .from("chat_sessions")
      .select("user_id")
      .eq("id", threadId)
      .maybeSingle();

    if (!data) {
      await redis.set(cacheKey, "none", "EX", THREAD_OWNER_NEGATIVE_TTL_S).catch(() => {});
      return false;
    }
    await redis.set(cacheKey, data.user_id, "EX", THREAD_OWNER_CACHE_TTL_S).catch(() => {});
    return data.user_id === userId;
  } catch {
    return false;
  }
}
