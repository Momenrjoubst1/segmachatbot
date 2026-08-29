/**
 * Model Context Definitions (Backend Copy)
 * تعريف نوافذ السياق والحد الأقصى للمخرجات للنماذج - نسخة الباك إند
 *
 * This mirrors the frontend model-catalog.ts for backend use
 * without requiring cross-project imports.
 *
 * Policy: every supported model runs with a 1,000,000-token context
 * window (the base model — deepseek-v4-flash — natively supports 1M)
 * and a Claude-class max output of 64,000 tokens (override with the
 * MAX_OUTPUT_TOKENS env var).
 */

export interface ModelContextInfo {
  value: string;
  contextWindow: number;
  provider: string;
  /**
   * Provider-enforced completion cap. Strict providers return HTTP 400
   * (instead of clamping) when max_tokens exceeds it, so requests must
   * never ask for more than this. Optional — models without an entry
   * get the full MAX_OUTPUT_TOKENS ceiling.
   */
  maxOutputTokens?: number;
}

/** Unified context window applied to every registered model */
export const UNIFIED_CONTEXT_WINDOW = 1_000_000;

/**
 * Max output tokens for assistant responses (Claude-flagship class).
 * Per-model provider caps (see maxOutputTokens in MODEL_CONTEXT_WINDOWS)
 * are applied on top via getModelMaxOutputTokens. Override the ceiling
 * with the MAX_OUTPUT_TOKENS env var.
 */
export const MAX_OUTPUT_TOKENS = (() => {
  const parsed = parseInt(process.env.MAX_OUTPUT_TOKENS || '64000', 10);
  return Number.isFinite(parsed) ? Math.max(256, parsed) : 64_000;
})();

/** Default context window for unknown models */
export const DEFAULT_CONTEXT_WINDOW = UNIFIED_CONTEXT_WINDOW;

/** Model context window mapping - keep in sync with frontend model-catalog.ts
 *  and routes/chat/chat-shared.ts ALLOWED_MODELS.
 *  maxOutputTokens = provider-enforced completion cap (requests above it get
 *  HTTP 400 on strict providers). Models without it can use the full
 *  MAX_OUTPUT_TOKENS ceiling (64k).
 *
 *  Catalog policy (verified live against provider APIs on 2026-08-29):
 *  every id below answered a real request or appears in the provider's live
 *  list with free-tier access. Dead ids (ox-alpha, glm-5.2, qwen3-32b,
 *  gemini-2.5-pro, gemini-3-flash, the gpt-4o family, fireworks, novita
 *  ling, 6 old NIM ids, cerebras) were pruned — they now fall back to
 *  DEFAULT_MODEL via the router. */
export const MODEL_CONTEXT_WINDOWS: Record<string, ModelContextInfo> = {
  // DeepSeek V4 Flash — served by NVIDIA NIM (deepseek-ai/deepseek-v4-flash-0731).
  // The public id stays 'deepseek-v4-flash' for thread/UX stability; the
  // provider resolver in chat-providers.ts maps it to the NIM id.
  'deepseek-v4-flash': { value: 'deepseek-v4-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },

  // BigModel (ZhipuAI)
  'glm-4-flash': { value: 'glm-4-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'bigmodel', maxOutputTokens: 4_096 },

  // Google Gemini (direct API — 65k completions supported)
  'gemini-3.7-flash': { value: 'gemini-3.7-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-3.5-flash': { value: 'gemini-3.5-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-2.5-flash': { value: 'gemini-2.5-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-3.1-flash-lite': { value: 'gemini-3.1-flash-lite', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-3.5-flash-lite': { value: 'gemini-3.5-flash-lite', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },

  // Groq (caps verified live via /api/v1/models max_completion_tokens — Groq
  // hard-rejects requests whose max_tokens exceeds these)
  'qwen/qwen3.6-27b': { value: 'qwen/qwen3.6-27b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 16_384 },
  'qwen/qwen3.8-27b': { value: 'qwen/qwen3.8-27b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 16_384 },
  'openai/gpt-oss-120b': { value: 'openai/gpt-oss-120b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 65_536 },
  'openai/gpt-oss-20b': { value: 'openai/gpt-oss-20b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 65_536 },

  // OpenRouter (free tier — tight completion caps). Ids verified live
  // against openrouter.ai/api/v1/models with the free-tier key.
  'google/gemma-4-31b-it:free': { value: 'google/gemma-4-31b-it:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'google/gemma-4-26b-a4b-it:free': { value: 'google/gemma-4-26b-a4b-it:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3-ultra-550b-a55b:free': { value: 'nvidia/nemotron-3-ultra-550b-a55b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3.5-lightning:free': { value: 'nvidia/nemotron-3.5-lightning:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'poolside/laguna-s-2.1:free': { value: 'poolside/laguna-s-2.1:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'poolside/laguna-xs-2.1:free': { value: 'poolside/laguna-xs-2.1:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },

  // NVIDIA NIM (direct — conservative completion cap). Ids verified live
  // against integrate.api.nvidia.com/v1/models with the current key.
  'nvidia/nemotron-3-super-120b-a12b': { value: 'nvidia/nemotron-3-super-120b-a12b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3.5-lightning-30b-a3b': { value: 'nvidia/nemotron-3.5-lightning-30b-a3b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3-ultra-550b-a55b': { value: 'nvidia/nemotron-3-ultra-550b-a55b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'deepseek-ai/deepseek-v4-flash-0731': { value: 'deepseek-ai/deepseek-v4-flash-0731', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
};

/**
 * Default assistant model when the client does not request one
 * (and the canonical source of truth for the model allowlist).
 */
export const DEFAULT_MODEL =
  process.env.ASSISTANT_DEFAULT_MODEL?.trim() || 'glm-4-flash';

/** Models the pipeline is allowed to run — every id in the catalog. */
export const ALLOWED_MODELS: string[] = Object.keys(MODEL_CONTEXT_WINDOWS);

/**
 * Get context window for a model ID
 */
export function getModelContextWindow(modelId: string): number {
  const model = MODEL_CONTEXT_WINDOWS[modelId];
  return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * Get max output tokens for a model ID: the configured ceiling clamped by
 * the provider's hard completion cap (strict providers 400 above it).
 */
export function getModelMaxOutputTokens(modelId: string): number {
  const model = MODEL_CONTEXT_WINDOWS[modelId];
  return Math.min(MAX_OUTPUT_TOKENS, model?.maxOutputTokens ?? MAX_OUTPUT_TOKENS);
}

/**
 * Get full model info
 */
export function getModelInfo(modelId: string): ModelContextInfo | undefined {
  return MODEL_CONTEXT_WINDOWS[modelId];
}

/**
 * Get all known model IDs
 */
export function getKnownModelIds(): string[] {
  return Object.keys(MODEL_CONTEXT_WINDOWS);
}

/**
 * Check if model is known
 */
export function isKnownModel(modelId: string): boolean {
  return modelId in MODEL_CONTEXT_WINDOWS;
}
