import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { createOpenAI } from "@ai-sdk/openai";
import { createLogger } from "../../utils/logger.js";

// Note: `Request.user` is declared globally by `middleware/auth.middleware.ts`
// — no need to redeclare it here.

// Re-export modelRouter for access from route files
// إعادة تصدير موجه النماذج للوصول من ملفات المسار
export { modelRouter, CircuitBreakerState, getGracefulDegradationMessage } from "../../services/chat/model-router.js";

// Re-export multi-agent prompts from their canonical location.
// (Previously duplicated here — kept as a re-export to avoid breaking imports
//  in code that still pulls them from chat-shared.)
export {
  MAIN_AGENT_SYSTEM_PROMPT,
  CRITIC_AGENT_SYSTEM_PROMPT,
} from "../../prompts/multi-agent.js";

export const log = createLogger("chat-api");
export const ragLog = createLogger("rag");
export const memLog = createLogger("memory");
export const trLog = createLogger("translate");

/** Minimal message shape used for log summaries (keeps logs light). */
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
  // FIX-12: Always use userId for per-user rate limiting — no IP fallback.
  // Unauthenticated requests skip the limiter and are handled by auth middleware (401).
  skip: (req: Request) => !req.user?.id,
  keyGenerator: (req: Request) => {
    const userId = req.user?.id;
    if (userId) return userId;
    return 'unauthenticated';
  },
});

// Stricter rate limit for new chats (prevents abuse)
export const newChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // Only 10 new conversations per minute
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

export const DEFAULT_MODEL =
  process.env.ASSISTANT_DEFAULT_MODEL?.trim() ||
  "gpt-5.4";

export const ALLOWED_MODELS = [
  "gpt-5.4",
  "gpt-4o",
  "gpt-4o-mini",
  "llama-3.3-70b-versatile",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "anthropic/claude-3.5-haiku",
  "accounts/fireworks/models/gemma-4-31b-it",
  "inclusionai/ling-3.0-tiny",
];

export type ProviderName = "openrouter" | "github" | "groq" | "fireworks" | "azure" | "novita";

function pickFirstAvailableProvider(
  preferred: Array<{ provider: ProviderName; envKey: string }>,
): { provider: ProviderName; reason: string } | null {
  for (const p of preferred) {
    if (process.env[p.envKey]) {
      return { provider: p.provider, reason: `${p.envKey} is set` };
    }
  }
  return null;
}

export function getProviderAndModel(modelId: string): { provider: ProviderName; modelName: string } {
  if (modelId === "gpt-5.4") {
    const azureConfigured = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (azureConfigured) {
      return { provider: "azure", modelName: process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4" };
    }
    const fallback = pickFirstAvailableProvider([
      { provider: "github", envKey: "GITHUB_TOKEN" },
      { provider: "groq", envKey: "GROQ_API_KEY" },
      { provider: "openrouter", envKey: "OPENROUTER_API_KEY" },
    ]);
    if (fallback) {
      log.warn(`gpt-5.4 requested but Azure not configured; falling back to ${fallback.provider} (${fallback.reason})`);
      return { provider: fallback.provider, modelName: "gpt-4o-mini" };
    }
    return { provider: "azure", modelName: process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4" };
  }
  if (modelId === "gpt-4o") {
    return { provider: "openrouter", modelName: "openai/gpt-4o" };
  }
  if (modelId === "gpt-4o-mini") {
    return { provider: "github", modelName: "openai/gpt-4o-mini" };
  }
  if (modelId.includes("llama-") || modelId.includes("mixtral") || modelId.includes("gemma2")) {
    return { provider: "groq", modelName: modelId };
  }
  if (modelId.startsWith("accounts/fireworks/models/")) {
    return { provider: "fireworks", modelName: modelId };
  }
  if (modelId.includes("ling-3.0-tiny") || modelId.startsWith("inclusionai/")) {
    return { provider: "novita", modelName: modelId };
  }
  return { provider: "openrouter", modelName: modelId };
}

export function createProviderClient(provider: ProviderName) {
  if (provider === "azure") {
    const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    if (!azureKey) throw new Error("Missing AZURE_API_KEY / AZURE_OPENAI_API_KEY in environment");
    
    const cleanEndpoint = azureEndpoint ? azureEndpoint.replace(/\/$/, '') : undefined;
    return createOpenAI({
      baseURL: cleanEndpoint || "https://msalrjoub25-2561-resource.openai.azure.com/openai/v1",
      apiKey: azureKey,
      headers: {
        "api-key": azureKey,
      },
    });
  }

  if (provider === "github") {
    if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN in environment");
    return createOpenAI({
      baseURL: "https://models.github.ai/inference",
      apiKey: process.env.GITHUB_TOKEN,
    });
  }

  if (provider === "groq") {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error("Missing GROQ_API_KEY in environment");
    return createOpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
    });
  }

  if (provider === "fireworks") {
    if (!process.env.FIREWORKS_API_KEY) throw new Error("Missing FIREWORKS_API_KEY in environment");
    return createOpenAI({
      baseURL: "https://api.fireworks.ai/inference/v1",
      apiKey: process.env.FIREWORKS_API_KEY,
    });
  }

  if (provider === "novita") {
    if (!process.env.NOVITA_API_KEY) throw new Error("Missing NOVITA_API_KEY in environment");
    return createOpenAI({
      baseURL: "https://api.novita.ai/openai",
      apiKey: process.env.NOVITA_API_KEY,
    });
  }

  if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY in environment");
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: {
      "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Sigma AI Chatbot",
    },
  });
}

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

// MAIN_AGENT_SYSTEM_PROMPT and CRITIC_AGENT_SYSTEM_PROMPT were removed
// from this file. They now live (and are exported) in
// `prompts/multi-agent.ts` to avoid duplication. Existing imports continue
// to work via the re-export at the top of this file.

export function createSecondModelClient() {
  const apiKey = process.env.SECOND_MODEL_API_KEY;
  const baseURL = process.env.SECOND_MODEL_BASE_URL;

  if (!apiKey) {
    return null;
  }

  return createOpenAI({
    apiKey,
    baseURL: baseURL || "https://api.openai.com/v1",
  });
}

