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
 *  MAX_OUTPUT_TOKENS ceiling (64k). */
export const MODEL_CONTEXT_WINDOWS: Record<string, ModelContextInfo> = {
  // Baichat (B.AI platform) — base model, full Claude-class output
  'deepseek-v4-flash': { value: 'deepseek-v4-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'baichat' },

  // OpenRouter — primary chat model, full Claude-class output
  'stealth/ox-alpha': { value: 'stealth/ox-alpha', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter' },

  // BigModel (ZhipuAI)
  'glm-4-flash': { value: 'glm-4-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'bigmodel', maxOutputTokens: 4_096 },
  'glm-5.2': { value: 'glm-5.2', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'bigmodel', maxOutputTokens: 16_384 },

  // Google Gemini (direct API — 65k completions supported)
  'gemini-3.7-flash': { value: 'gemini-3.7-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-2.5-flash': { value: 'gemini-2.5-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-2.5-pro': { value: 'gemini-2.5-pro', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-3-flash': { value: 'gemini-3-flash', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },
  'gemini-3.1-flash-lite': { value: 'gemini-3.1-flash-lite', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'google' },

  // Azure OpenAI / GitHub Models / OpenRouter
  'gpt-5.4': { value: 'gpt-5.4', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'azure' },
  'gpt-4o': { value: 'gpt-4o', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 16_384 },
  'gpt-4o-mini': { value: 'gpt-4o-mini', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'github', maxOutputTokens: 16_384 },

  // Groq (max_completion_tokens cap: 32,768)
  'qwen/qwen3.6-27b': { value: 'qwen/qwen3.6-27b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'qwen/qwen3-32b': { value: 'qwen/qwen3-32b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'mixtral-8x7b-32768': { value: 'mixtral-8x7b-32768', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'llama-3.3-70b-versatile': { value: 'llama-3.3-70b-versatile', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'llama-3.1-8b-instant': { value: 'llama-3.1-8b-instant', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'openai/gpt-oss-120b': { value: 'openai/gpt-oss-120b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'openai/gpt-oss-20b': { value: 'openai/gpt-oss-20b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },
  'meta-llama/llama-4-scout-17b-16e-instruct': { value: 'meta-llama/llama-4-scout-17b-16e-instruct', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'groq', maxOutputTokens: 32_768 },

  // OpenRouter (free tier — tight completion caps)
  'google/gemini-2.0-flash-exp:free': { value: 'google/gemini-2.0-flash-exp:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'qwen/qwen-2.5-72b-instruct:free': { value: 'qwen/qwen-2.5-72b-instruct:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'anthropic/claude-3.5-haiku': { value: 'anthropic/claude-3.5-haiku', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3-ultra-550b-a55b:free': { value: 'nvidia/nemotron-3-ultra-550b-a55b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3.5-lightning-30b-a3b:free': { value: 'nvidia/nemotron-3.5-lightning-30b-a3b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3-super-49b-a49b:free': { value: 'nvidia/nemotron-3-super-49b-a49b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-3-nano-30b-a3b:free': { value: 'nvidia/nemotron-3-nano-30b-a3b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-nano-9b-v2:free': { value: 'nvidia/nemotron-nano-9b-v2:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'nvidia/nemotron-nano-12b-2-vl:free': { value: 'nvidia/nemotron-nano-12b-2-vl:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'google/gemma-4-26b-a4b:free': { value: 'google/gemma-4-26b-a4b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'openai/gpt-oss-20b:free': { value: 'openai/gpt-oss-20b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'poolside/laguna-s-2.1:free': { value: 'poolside/laguna-s-2.1:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'poolside/laguna-xs-2.1:free': { value: 'poolside/laguna-xs-2.1:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'dots-studio/dots3-note-preview:free': { value: 'dots-studio/dots3-note-preview:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },
  'liquid/lfm2.5-2.6b:free': { value: 'liquid/lfm2.5-2.6b:free', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'openrouter', maxOutputTokens: 8_192 },

  // Fireworks
  'accounts/fireworks/models/gemma-4-31b-it': { value: 'accounts/fireworks/models/gemma-4-31b-it', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'fireworks', maxOutputTokens: 8_192 },

  // Novita
  'inclusionai/ling-3.0-tiny': { value: 'inclusionai/ling-3.0-tiny', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'novita', maxOutputTokens: 8_192 },

  // NVIDIA NIM (direct — conservative completion cap)
  'nvidia/llama-3.1-nemotron-70b-instruct': { value: 'nvidia/llama-3.1-nemotron-70b-instruct', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'nvidia/llama-3.3-70b-instruct': { value: 'nvidia/llama-3.3-70b-instruct', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'nvidia/deepseek-r1': { value: 'nvidia/deepseek-r1', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'meta/llama-3.1-8b-instruct': { value: 'meta/llama-3.1-8b-instruct', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'meta/llama-3.1-70b-instruct': { value: 'meta/llama-3.1-70b-instruct', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },
  'qwen/qwen2.5-72b-instruct': { value: 'qwen/qwen2.5-72b-instruct', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'nvidia', maxOutputTokens: 8_192 },

  // Cerebras
  'llama-3.3-70b': { value: 'llama-3.3-70b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'cerebras', maxOutputTokens: 8_192 },
  'llama-3.1-8b': { value: 'llama-3.1-8b', contextWindow: UNIFIED_CONTEXT_WINDOW, provider: 'cerebras', maxOutputTokens: 8_192 },
};

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
