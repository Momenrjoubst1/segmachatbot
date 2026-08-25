// Unified policy: every supported model runs a 1,000,000-token context window.
// Keep in sync with backend/src/services/memory/model-context.ts
export const MODELS = [
  // ==========================================
  // 0. OpenRouter (primary — app default)
  // ==========================================
  {
    name: "Ox-Alpha (OpenRouter - Primary)",
    value: "stealth/ox-alpha",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 0b. Baichat (B.AI platform)
  // ==========================================
  {
    name: "DeepSeek V4 Flash (B.AI)",
    value: "deepseek-v4-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "baichat" as const,
  },

  // ==========================================
  // 1. BigModel (ZhipuAI) - GLM Models
  // ==========================================
  {
    name: "GLM-4 Flash (BigModel - Fast)",
    value: "glm-4-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "bigmodel" as const,
  },
  {
    name: "GLM-5.2 (BigModel)",
    value: "glm-5.2",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "bigmodel" as const,
  },

  // ==========================================
  // 1. Google Gemini (Direct API - Free Tier)
  // ==========================================
  {
    name: "Gemini 3.7 Flash (Google - Free)",
    value: "gemini-3.7-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 2.5 Flash (Google - Free)",
    value: "gemini-2.5-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 2.5 Pro (Google)",
    value: "gemini-2.5-pro",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 3 Flash (Google - Latest)",
    value: "gemini-3-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 3.1 Flash-Lite (Google)",
    value: "gemini-3.1-flash-lite",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },

  // ==========================================
  // 2. Azure OpenAI Models (ChatGPT 5.4)
  // ==========================================
  {
    name: "ChatGPT 5.4 (Azure OpenAI)",
    value: "gpt-5.4",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "azure" as const,
  },

  // ==========================================
  // 3. GitHub Models (Free via GITHUB_TOKEN)
  // ==========================================
  {
    name: "GPT-4o Mini (GitHub)",
    value: "gpt-4o-mini",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "github" as const,
  },
  {
    name: "GPT-4o (OpenRouter)",
    value: "gpt-4o",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 4. Groq Models (Free & Fast via GROQ_API_KEY)
  // ==========================================
  {
    name: "Llama 3.3 70B (Groq - Fast)",
    value: "llama-3.3-70b-versatile",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Llama 3.1 8B (Groq - Fastest)",
    value: "llama-3.1-8b-instant",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Qwen 3.6 27B (Groq)",
    value: "qwen/qwen3.6-27b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "GPT-OSS 120B (Groq)",
    value: "openai/gpt-oss-120b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "GPT-OSS 20B (Groq)",
    value: "openai/gpt-oss-20b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Qwen 3 32B (Groq)",
    value: "qwen/qwen3-32b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Llama 4 Scout 17B (Groq)",
    value: "meta-llama/llama-4-scout-17b-16e-instruct",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Mixtral 8x7B (Groq)",
    value: "mixtral-8x7b-32768",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },

  // ==========================================
  // 5. OpenRouter Models (Free Tier via OPENROUTER_API_KEY)
  // ==========================================
  {
    name: "Nemotron 3.5 Lightning (Free)",
    value: "nvidia/nemotron-3.5-lightning:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Gemma 4 31B (Free)",
    value: "google/gemma-4-31b-it:free",
    disabled: false,
    contextWindow: 262_144,
    provider: "openrouter" as const,
  },
  {
    name: "Gemma 4 26B A4B (Free)",
    value: "google/gemma-4-26b-a4b-it:free",
    disabled: false,
    contextWindow: 262_144,
    provider: "openrouter" as const,
  },
  {
    name: "Claude 3.5 Haiku",
    value: "anthropic/claude-3.5-haiku",
    disabled: true,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3 Ultra 550B (Free)",
    value: "nvidia/nemotron-3-ultra-550b-a55b:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3 Super 49B (Free)",
    value: "nvidia/nemotron-3-super-49b-a49b:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron 3 Nano 30B (Free)",
    value: "nvidia/nemotron-3-nano-30b-a3b:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron Nano 9B V2 (Free)",
    value: "nvidia/nemotron-nano-9b-v2:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Nemotron Nano 12B VL (Free)",
    value: "nvidia/nemotron-nano-12b-2-vl:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "GPT-OSS 20B (Free)",
    value: "openai/gpt-oss-20b:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Laguna S 2.1 (Free)",
    value: "poolside/laguna-s-2.1:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Laguna XS 2.1 (Free)",
    value: "poolside/laguna-xs-2.1:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "Dots3 Note Preview (Free)",
    value: "dots-studio/dots3-note-preview:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },
  {
    name: "LFM2.5 2.6B (Free)",
    value: "liquid/lfm2.5-2.6b:free",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "openrouter" as const,
  },

  // ==========================================
  // 6. Fireworks Models (via FIREWORKS_API_KEY)
  // ==========================================
  {
    name: "Gemma 4 31B IT (Fireworks)",
    value: "accounts/fireworks/models/gemma-4-31b-it",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "fireworks" as const,
  },

  // ==========================================
  // 7. Novita.ai Models (via NOVITA_API_KEY)
  // ==========================================
  {
    name: "Ling 3.0 Tiny (Novita)",
    value: "inclusionai/ling-3.0-tiny",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "novita" as const,
  },

  // ==========================================
  // 8. NVIDIA NIM Models (via NVIDIA_API_KEY)
  // ==========================================
  {
    name: "Nemotron 70B (NVIDIA NIM)",
    value: "nvidia/llama-3.1-nemotron-70b-instruct",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Llama 3.3 70B (NVIDIA NIM)",
    value: "nvidia/llama-3.3-70b-instruct",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "DeepSeek R1 (NVIDIA NIM)",
    value: "nvidia/deepseek-r1",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Llama 3.1 8B (NVIDIA NIM)",
    value: "meta/llama-3.1-8b-instruct",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Llama 3.1 70B (NVIDIA NIM)",
    value: "meta/llama-3.1-70b-instruct",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Qwen 2.5 72B (NVIDIA NIM)",
    value: "qwen/qwen2.5-72b-instruct",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },

  // ==========================================
  // 9. Cerebras Models (via CEREBRAS_API_KEY)
  // ==========================================
  {
    name: "Llama 3.3 70B (Cerebras)",
    value: "llama-3.3-70b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "cerebras" as const,
  },
  {
    name: "Llama 3.1 8B (Cerebras - Fast)",
    value: "llama-3.1-8b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "cerebras" as const,
  },
] as const;

export type Model = (typeof MODELS)[number];
export type KnownModelId = Model["value"];
export type ModelProvider = Model["provider"];

/** Effort levels a model can expose in the selector (Claude-style). */
export type ModelEffortLevel = "Low" | "Medium" | "High" | "Extra" | "Max";

/**
 * Wire value sent to the backend for each UI level (OpenAI-style effort
 * vocabulary — the backend maps it further per provider).
 */
export const MODEL_EFFORT_WIRE: Record<
  ModelEffortLevel,
  "low" | "medium" | "high" | "xhigh" | "max"
> = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Extra: "xhigh",
  Max: "max",
};

/**
 * Real reasoning-effort availability per model, based on each provider's
 * documented API (researched Aug 2026):
 *
 * - OpenRouter: unified `reasoning.effort`, mapped to the nearest level the
 *   target model supports → safe Low/Medium/High for its models.
 * - DeepSeek (B.AI): `reasoning_effort` accepts low | high | max
 *   (medium & xhigh are mapped up to high).
 * - BigModel GLM: `reasoning_effort` only on GLM-5.2+ (low/medium→high,
 *   xhigh→max). GLM-4.x has no effort parameter.
 * - Google Gemini: `thinkingLevel` (Gemini 3) / `thinkingBudget` (2.5) —
 *   low | medium | high across the catalog's Gemini models.
 * - Azure OpenAI GPT-5.4: `reasoning_effort` none/low/medium/high/xhigh.
 * - Groq: `reasoning_effort` only for the GPT-OSS family (low/medium/high);
 *   Qwen 3 accepts only none/default → no effort UI. Llama/Mixtral: none.
 *
 * Models not listed here have no effort support — the selector hides the
 * Effort row for them entirely.
 */
export const MODEL_EFFORT_LEVELS: Partial<
  Record<KnownModelId, ModelEffortLevel[]>
> = {
  // OpenRouter
  "stealth/ox-alpha": ["Low", "Medium", "High"],
  "google/gemma-4-31b-it:free": ["Low", "Medium", "High"],
  "openai/gpt-oss-20b:free": ["Low", "Medium", "High"],

  // Baichat (DeepSeek)
  "deepseek-v4-flash": ["Low", "High", "Max"],

  // BigModel (ZhipuAI)
  "glm-5.2": ["Low", "Medium", "High", "Max"],

  // Google Gemini (direct)
  "gemini-3.7-flash": ["Low", "Medium", "High"],
  "gemini-2.5-flash": ["Low", "Medium", "High"],
  "gemini-2.5-pro": ["Low", "Medium", "High"],
  "gemini-3-flash": ["Low", "Medium", "High"],
  "gemini-3.1-flash-lite": ["Low", "Medium", "High"],

  // Azure OpenAI
  "gpt-5.4": ["Low", "Medium", "High", "Extra"],

  // Groq (GPT-OSS family only)
  "openai/gpt-oss-120b": ["Low", "Medium", "High"],
  "openai/gpt-oss-20b": ["Low", "Medium", "High"],
};

/** Fallback effort levels offered for models without documented support. */
export const DEFAULT_EFFORT_LEVELS: ModelEffortLevel[] = [
  "Low",
  "Medium",
  "High",
];

/**
 * Effort levels for a model — documented levels when available, otherwise
 * the generic Low/Medium/High scale. The backend only forwards the effort
 * parameter to providers that safely accept it (silently skipping others),
 * so exposing levels for every model is always safe.
 */
export function getModelEffortLevels(modelId: string): ModelEffortLevel[] {
  return MODEL_EFFORT_LEVELS[modelId as KnownModelId] ?? DEFAULT_EFFORT_LEVELS;
}

/**
 * Claude-style taglines shown under each model name in the selector
 * (featured models only — others fall back to their provider label).
 */
export const MODEL_TAGLINES: Partial<Record<KnownModelId, string>> = {
  "stealth/ox-alpha": "Primary model — best overall quality",
  "deepseek-v4-flash": "Fast reasoning for everyday tasks",
  "glm-4-flash": "Fastest for quick answers",
  "glm-5.2": "Balanced speed and quality",
  "gemini-3.7-flash": "Free — great for daily use",
  "gemini-2.5-flash": "Free — fast responses",
  "gemini-2.5-pro": "For complex tasks",
  "gemini-3-flash": "Latest Google model",
  "gpt-5.4": "For your toughest challenges",
};

const DEFAULT_MODEL = MODELS[0]; // GLM-4 Flash (BigModel - Fast)
export const DEFAULT_MODEL_ID: KnownModelId = DEFAULT_MODEL.value;
export const DEFAULT_CONTEXT_WINDOW = DEFAULT_MODEL.contextWindow;

export function getContextWindow(modelId: string): number {
  const model = MODELS.find((m) => m.value === modelId);
  return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function getModelProvider(modelId: string): ModelProvider {
  const model = MODELS.find((m) => m.value === modelId);
  return model?.provider ?? "openrouter";
}

const ACTIVE_MODELS = MODELS.filter((m) => !m.disabled);
const AVAILABLE_MODEL_IDS = new Set<KnownModelId>(
  ACTIVE_MODELS.map((m) => m.value),
);

export function isAvailableModelId(id: string): id is KnownModelId {
  return AVAILABLE_MODEL_IDS.has(id as KnownModelId);
}

export function resolveModelId(input: string | undefined): KnownModelId {
  const raw = typeof input === "string" ? input.trim() : "";
  return raw && isAvailableModelId(raw) ? raw : DEFAULT_MODEL_ID;
}
