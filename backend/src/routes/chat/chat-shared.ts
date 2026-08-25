import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createLogger } from "../../utils/logger.js";
import { mediaAwareFetch } from "../../services/chat/media-wire.js";

/**
 * Every OpenAI-compatible client routes its outbound request through the
 * media wire patch, which rewrites âŸ¦MEDIA:â€¦âŸ§ sentinels into provider-native
 * video_url / input_audio blocks. Bodies without media pass through untouched.
 */
const MEDIA_AWARE_FETCH = mediaAwareFetch();

// Note: `Request.user` is declared globally by `middleware/auth.middleware.ts`
// â€” no need to redeclare it here.

// Re-export modelRouter for access from route files
// Ø¥Ø¹Ø§Ø¯Ø© ØªØµØ¯ÙŠØ± Ù…ÙˆØ¬Ù‡ Ø§Ù„Ù†Ù…Ø§Ø°Ø¬ Ù„Ù„ÙˆØµÙˆÙ„ Ù…Ù† Ù…Ù„ÙØ§Øª Ø§Ù„Ù…Ø³Ø§Ø±
export { modelRouter, CircuitBreakerState, getGracefulDegradationMessage } from "../../services/chat/model-router.js";

// Re-export multi-agent prompts from their canonical location.
// (Previously duplicated here â€” kept as a re-export to avoid breaking imports
//  in code that still pulls them from chat-shared.)
export {
  MAIN_AGENT_SYSTEM_PROMPT,
  CRITIC_AGENT_SYSTEM_PROMPT,
} from "../../prompts/multi-agent.js";

export const log = createLogger("chat-api");
export const ragLog = createLogger("rag");
export const memLog = createLogger("memory");
export const trLog = createLogger("translate");

// â”€â”€â”€ Reasoning tap (DeepSeek-style `reasoning_content`) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * The AI SDK's OpenAI-compatible chat provider only maps `delta.content`,
 * `delta.tool_calls`, and `delta.annotations` â€” reasoning deltas
 * (`delta.reasoning_content` / `delta.reasoning`) are silently dropped.
 *
 * `reasoningTapFetch` sits under the SDK's fetch, parses the SSE stream,
 * moves any reasoning delta into the beginning of `delta.content` wrapped in
 * <think>â€¦</think> tags, and re-serializes the chunk. The frontend splits the
 * tags back out into a collapsible "Thinking" block; the backend strips them
 * before moderation/persistence via `stripThinkTags`.
 *
 * Opt-in per client via `createProviderClient(provider, { reasoningTap: true })`
 * so non-chat consumers (voice/TTS) never receive tagged content.
 */

/** Providers whose models commonly stream DeepSeek-style reasoning deltas. */
const REASONING_TAP_DEFAULT_PROVIDERS = new Set<ProviderName>([
  "baichat",
  "nvidia",
  "openrouter",
  "bigmodel",
  "novita",
]);

/** Extract the reasoning text from an OpenAI-compatible chat delta, if any. */
function extractDeltaReasoning(delta: Record<string, unknown> | undefined | null): string | null {
  if (!delta || typeof delta !== "object") return null;
  const rc = (delta as { reasoning_content?: unknown }).reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return rc;
  const r = (delta as { reasoning?: unknown }).reasoning;
  if (typeof r === "string" && r.length > 0) return r;
  return null;
}

/** Transform one parsed SSE data payload; returns null when nothing changed. */
function tapChatChunk(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { choices?: Array<{ delta?: Record<string, unknown>; message?: Record<string, unknown> }> };
  const choice = obj.choices?.[0];
  if (!choice) return null;

  // Streaming: move delta.reasoning(_content) into delta.content inside <think>.
  if (choice.delta && typeof choice.delta === "object") {
    const reasoning = extractDeltaReasoning(choice.delta);
    if (reasoning == null) return null;
    delete choice.delta.reasoning_content;
    delete choice.delta.reasoning;
    const existing = typeof choice.delta.content === "string" ? choice.delta.content : "";
    choice.delta.content = `<think>${reasoning}</think>${existing}`;
    return JSON.stringify(obj);
  }

  // Non-streaming JSON responses: same treatment for message.reasoning_content.
  if (choice.message && typeof choice.message === "object") {
    const reasoning = extractDeltaReasoning(choice.message);
    if (reasoning == null) return null;
    delete choice.message.reasoning_content;
    delete choice.message.reasoning;
    const existing = typeof choice.message.content === "string" ? choice.message.content : "";
    choice.message.content = `<think>${reasoning}</think>${existing}`;
    return JSON.stringify(obj);
  }
  return null;
}

/**
 * Wrap a fetch implementation so chat-completions SSE bodies get their
 * reasoning deltas folded into content as <think>â€¦</think>. All other
 * responses pass through untouched.
 */
export function createReasoningTapFetch(inner: typeof fetch): typeof fetch {
  return async function reasoningTapFetch(input, init) {
    const res = await inner(input, init);
    const contentType = res.headers?.get?.("content-type") ?? "";
    if (!res.body || !contentType.includes("text/event-stream")) return res;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffered = "";

    const processLine = (rawLine: string): string => {
      const line = rawLine.replace(/\r$/, "");
      if (!line.startsWith("data:")) return line;
      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") return line;
      try {
        const parsed: unknown = JSON.parse(payloadText);
        const tapped = tapChatChunk(parsed);
        return tapped != null ? `data: ${tapped}` : line;
      } catch {
        return line;
      }
    };

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        controller.enqueue(encoder.encode(lines.map(processLine).join("\n")));
      },
      flush(controller) {
        buffered += decoder.decode();
        if (buffered.length > 0) controller.enqueue(encoder.encode(processLine(buffered)));
      },
    });

    return new Response(res.body.pipeThrough(transform), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

/** Remove <think>â€¦</think> blocks (streamed model reasoning) from text. */
export function stripThinkTags(text: string): string {
  if (!text || !text.includes("<think>")) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trimStart();
}


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
  message: { error: "Ù„Ù‚Ø¯ ØªØ¬Ø§ÙˆØ²Øª Ø§Ù„Ø­Ø¯ Ø§Ù„Ù…Ø³Ù…ÙˆØ­ Ø¨Ù‡ Ù…Ù† Ø§Ù„Ø±Ø³Ø§Ø¦Ù„. ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø± Ù‚Ù„ÙŠÙ„Ø§Ù‹." },
  standardHeaders: true,
  legacyHeaders: false,
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
  message: { error: "Ù„Ù‚Ø¯ ØªØ¬Ø§ÙˆØ²Øª Ø­Ø¯ Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø§Øª. ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø±." },
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
  "stealth/ox-alpha";

export const ALLOWED_MODELS = [
  // Baichat
  "deepseek-v4-flash",
  // OpenRouter (primary chat model)
  "stealth/ox-alpha",
  // Google Gemini (direct) - gemini-3.7-flash is alias for gemini-2.5-flash
  "gemini-3.7-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  // BigModel
  "glm-5.2",
  // Azure/GitHub/OpenRouter
  "gpt-5.4",
  "gpt-4o",
  "gpt-4o-mini",
  // Groq
  "qwen/qwen3.6-27b",
  "qwen/qwen3-32b",
  "mixtral-8x7b-32768",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  // OpenRouter Free
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "anthropic/claude-3.5-haiku",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-49b-a49b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "nvidia/nemotron-nano-12b-2-vl:free",
  "google/gemma-4-26b-a4b-it:free",
  "openai/gpt-oss-20b:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "dots-studio/dots3-note-preview:free",
  "liquid/lfm2.5-2.6b:free",
  // Fireworks
  "accounts/fireworks/models/gemma-4-31b-it",
  // Novita
  "inclusionai/ling-3.0-tiny",
  // NVIDIA NIM (direct)
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "nvidia/llama-3.3-70b-instruct",
  "nvidia/deepseek-r1",
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.1-70b-instruct",
  "qwen/qwen2.5-72b-instruct",
  // Cerebras
  "llama-3.3-70b",
  "llama-3.1-8b",
];

export type ProviderName = "openrouter" | "github" | "groq" | "fireworks" | "azure" | "novita" | "bigmodel" | "google" | "baichat" | "nvidia" | "cerebras";

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
  // OpenRouter ":free" ids are OpenRouter-exclusive — never let an
  // "nvidia/..."-style free id misroute to the NVIDIA NIM direct provider.
  if (modelId.endsWith(":free")) {
    return { provider: "openrouter", modelName: modelId };
  }
  // DeepSeek V4 Flash via B.AI platform
  if (modelId === "deepseek-v4-flash") {
    return { provider: "baichat", modelName: "deepseek-v4-flash" };
  }
  // Google Gemini models (direct API)
  // gemini-3.7-flash is alias for gemini-2.5-flash (backward compatibility)
  const GEMINI_MODELS = new Set([
    "gemini-3.7-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash",
    "gemini-3.1-flash-lite",
  ]);
  if (GEMINI_MODELS.has(modelId)) {
    // Map gemini-3.7-flash to gemini-2.5-flash for actual API call
    const actualModel = modelId === "gemini-3.7-flash" ? "gemini-2.5-flash" : modelId;
    return { provider: "google", modelName: actualModel };
  }
  const GLM_MODELS = new Set(["glm-5.2", "glm-4-flash"]);
  if (GLM_MODELS.has(modelId)) {
    return { provider: "bigmodel", modelName: modelId };
  }
  if (modelId === "gpt-5.4") {
    const azureConfigured = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (azureConfigured) {
      return { provider: "azure", modelName: process.env.AZURE_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.4" };
    }
    const fallback = pickFirstAvailableProvider([
      { provider: "github", envKey: "GITHUB_TOKEN" },
      { provider: "groq", envKey: "GROQ_API_KEY" },
      { provider: "nvidia", envKey: "NVIDIA_API_KEY" },
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
  // Groq models (direct API)
  if (
    modelId.includes("llama-") ||
    modelId.includes("mixtral") ||
    modelId.startsWith("qwen/") ||
    modelId === "qwen/qwen3.6-27b" ||
    modelId === "qwen/qwen3-32b" ||
    modelId.startsWith("openai/gpt-oss") ||
    modelId.startsWith("meta-llama/")
  ) {
    return { provider: "groq", modelName: modelId };
  }
  if (modelId.startsWith("accounts/fireworks/models/")) {
    return { provider: "fireworks", modelName: modelId };
  }
  if (modelId.includes("ling-3.0-tiny") || modelId.startsWith("inclusionai/")) {
    return { provider: "novita", modelName: modelId };
  }
  // NVIDIA NIM models
  if (
    modelId.startsWith("nvidia/") ||
    modelId.startsWith("nvidia-") ||
    modelId === "deepseek-ai/deepseek-r1" ||
    modelId === "meta/llama-3.1-8b-instruct" ||
    modelId === "meta/llama-3.1-70b-instruct" ||
    modelId === "meta/llama-3.3-70b-instruct" ||
    modelId === "qwen/qwen2.5-72b-instruct"
  ) {
    return { provider: "nvidia", modelName: modelId };
  }
  // Cerebras models
  if (
    modelId.startsWith("cerebras/") ||
    modelId === "llama-3.3-70b" ||
    modelId === "llama-3.1-8b"
  ) {
    return { provider: "cerebras", modelName: modelId.replace("cerebras/", "") };
  }
  return { provider: "openrouter", modelName: modelId };
}

/** OpenAI-style reasoning-effort vocabulary accepted from the client. */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Map the unified effort to each provider's documented parameter value.
 * Gated per MODEL (not just provider) so the parameter is only sent where
 * the target model safely accepts it — unsupported combos return undefined
 * and the field is omitted entirely (never a 400):
 *
 * - openrouter: `reasoning.effort` — accepts the full scale for every model,
 *   normalizing to the nearest supported level internally.
 * - azure (OpenAI): `reasoning_effort` low/medium/high/xhigh (no max).
 * - groq: `reasoning_effort` low/medium/high — GPT-OSS family ONLY.
 * - baichat (DeepSeek): `reasoning_effort` low/high/max (medium/xhigh → high).
 * - bigmodel (GLM): `reasoning_effort` on GLM-5.2+ only.
 * - google: handled separately via thinkingConfig (see mapGoogleThinking).
 * - All other providers: no effort support → undefined (field omitted).
 */
export function mapEffortForProvider(
  provider: ProviderName,
  modelName: string,
  effort: ReasoningEffort,
): string | undefined {
  const model = modelName.toLowerCase();
  switch (provider) {
    case "openrouter":
      return effort;
    case "azure":
      return effort === "max" ? "xhigh" : effort;
    case "groq":
      if (!model.includes("gpt-oss")) return undefined;
      return effort === "xhigh" || effort === "max" ? "high" : effort;
    case "baichat":
      return effort === "medium" || effort === "xhigh" ? "high" : effort;
    case "bigmodel":
      if (!model.includes("glm-5.2") && !model.includes("glm-5.3")) {
        return undefined;
      }
      return effort;
    default:
      return undefined;
  }
}

/**
 * Map the unified effort onto Gemini's thinking controls:
 * - Gemini 3+ → `thinkingLevel` (minimal/low/medium/high).
 * - Gemini 2.5 → legacy `thinkingBudget` (token buckets).
 * Returns the keys to spread into providerOptions.google.thinkingConfig,
 * or an empty object when there is nothing safe to send.
 */
export function mapGoogleThinking(
  modelName: string,
  effort: ReasoningEffort,
): { thinkingLevel?: string; thinkingBudget?: number } {
  const model = modelName.toLowerCase();
  if (model.includes("gemini-2.5")) {
    const budget =
      effort === "low" ? 1024 : effort === "medium" ? 8192 : 24576;
    return { thinkingBudget: budget };
  }
  const level =
    effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
  return { thinkingLevel: level };
}

/**
 * Fetch wrapper that injects provider-specific reasoning-effort fields into
 * the outbound JSON body. Only POST requests with string JSON bodies are
 * touched — media uploads and non-JSON payloads pass through untouched.
 */
function createEffortFetch(
  inner: typeof fetch,
  provider: ProviderName,
  effort: ReasoningEffort,
  modelName?: string,
): typeof fetch {
  const mapped = mapEffortForProvider(provider, modelName ?? "", effort);
  // Unsupported provider/model combo → pass-through, never inject anything.
  if (mapped === undefined) return inner;

  return async (input, init) => {
    const method = (
      init?.method ??
      (typeof input === "object" && input !== null && "method" in input
        ? input.method
        : "POST")
    ).toUpperCase();
    if (method !== "POST" || typeof init?.body !== "string") {
      return inner(input, init);
    }
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      if (provider === "openrouter") {
        parsed.reasoning = {
          ...(typeof parsed.reasoning === "object" && parsed.reasoning !== null
            ? parsed.reasoning
            : {}),
          effort: mapped,
        };
      } else {
        parsed.reasoning_effort = mapped;
        // DeepSeek & GLM gate effort behind thinking mode (enabled by
        // default — set explicitly so the effort value always applies).
        if (provider === "baichat" || provider === "bigmodel") {
          parsed.thinking = { type: "enabled" };
        }
      }
      return inner(input, { ...init, body: JSON.stringify(parsed) });
    } catch {
      // Not JSON — pass through.
      return inner(input, init);
    }
  };
}

export function createProviderClient(
  provider: ProviderName,
  opts?: { reasoningTap?: boolean; effort?: ReasoningEffort; modelName?: string },
) {
  // Reasoning-effort injection: rewrite the JSON body per provider before it
  // leaves (sits above the media wire so media rewriting still runs first
  // inside). No-op when no effort was requested or the model doesn't accept it.
  const baseFetch =
    opts?.effort
      ? createEffortFetch(MEDIA_AWARE_FETCH, provider, opts.effort, opts.modelName)
      : MEDIA_AWARE_FETCH;
  // Opt-in SSE tap that folds reasoning deltas into <think>�?"</think> content.
  // Enabled by chat pipelines; voice/translate consumers stay untouched.
  const fetchImpl =
    opts?.reasoningTap && REASONING_TAP_DEFAULT_PROVIDERS.has(provider)
      ? createReasoningTapFetch(baseFetch)
      : baseFetch;

  if (provider === "baichat") {
    const baichatKey = process.env.BAICHAT_API_KEY;
    if (!baichatKey) throw new Error("Missing BAICHAT_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.chat.b.ai/v1",
      apiKey: baichatKey,
    });
  }

  if (provider === "bigmodel") {
    const bigmodelKey = process.env.BIGMODEL_API_KEY;
    if (!bigmodelKey) throw new Error("Missing BIGMODEL_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: bigmodelKey,
    });
  }

  if (provider === "azure") {
    const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
    if (!azureKey) throw new Error("Missing AZURE_API_KEY / AZURE_OPENAI_API_KEY in environment");
    if (!azureEndpoint) throw new Error("Missing AZURE_ENDPOINT / AZURE_OPENAI_ENDPOINT in environment");
    
    const cleanEndpoint = azureEndpoint.replace(/\/$/, '');
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: `${cleanEndpoint}/openai/v1`,
      apiKey: azureKey,
      headers: {
        "api-key": azureKey,
      },
    });
  }

  if (provider === "github") {
    if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://models.github.ai/inference",
      apiKey: process.env.GITHUB_TOKEN,
    });
  }

  if (provider === "groq") {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error("Missing GROQ_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
    });
  }

  if (provider === "fireworks") {
    if (!process.env.FIREWORKS_API_KEY) throw new Error("Missing FIREWORKS_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.fireworks.ai/inference/v1",
      apiKey: process.env.FIREWORKS_API_KEY,
    });
  }

  if (provider === "novita") {
    if (!process.env.NOVITA_API_KEY) throw new Error("Missing NOVITA_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.novita.ai/openai",
      apiKey: process.env.NOVITA_API_KEY,
    });
  }

  if (provider === "nvidia") {
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (!nvidiaKey) throw new Error("Missing NVIDIA_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: nvidiaKey,
    });
  }

  if (provider === "cerebras") {
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (!cerebrasKey) throw new Error("Missing CEREBRAS_API_KEY in environment");
    return createOpenAI({
      fetch: fetchImpl,
      baseURL: "https://api.cerebras.ai/v1",
      apiKey: cerebrasKey,
    });
  }

  if (provider === "google") {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("Missing GEMINI_API_KEY in environment");
    return createGoogleGenerativeAI({
      apiKey: geminiKey,
    });
  }

  if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY in environment");
  return createOpenAI({
    fetch: fetchImpl,
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

const THREAD_OWNER_CACHE_TTL_S = 300; // 5 minutes
const THREAD_OWNER_NEGATIVE_TTL_S = 60; // short TTL for "does not exist"
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cheap ownership check for rate-limit decisions (Redis-cached, 5-min TTL).
 * Returns false for non-UUID / nonexistent / non-owned threadIds. Errors are
 * swallowed and returned as `false` so callers can fail safe.
 */
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

