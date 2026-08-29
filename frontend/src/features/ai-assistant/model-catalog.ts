// Unified policy: every supported model runs a 1,000,000-token context window.
// Keep in sync with backend/src/services/memory/model-context.ts
//
// Catalog policy (verified live against provider APIs on 2026-08-29):
// an id is listed here ONLY if a real request succeeded, or it appeared in the
// provider's live model list with free-tier access. Dead ids are pruned, not
// disabled — old threads referencing them resolve to DEFAULT_MODEL_ID.
export const MODELS = [
  // ==========================================
  // 0. BigModel (ZhipuAI) — app default (free, verified live)
  // ==========================================
  {
    name: "GLM-4 Flash (BigModel - Fast)",
    value: "glm-4-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "bigmodel" as const,
  },

  // ==========================================
  // 0b. DeepSeek V4 Flash — served via NVIDIA NIM
  // (id kept stable for existing threads; backend maps it to
  // deepseek-ai/deepseek-v4-flash-0731)
  // ==========================================
  {
    name: "DeepSeek V4 Flash (NVIDIA)",
    value: "deepseek-v4-flash",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
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
    name: "Gemini 3.5 Flash (Google - Free)",
    value: "gemini-3.5-flash",
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
    name: "Gemini 3.1 Flash-Lite (Google)",
    value: "gemini-3.1-flash-lite",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },
  {
    name: "Gemini 3.5 Flash-Lite (Google)",
    value: "gemini-3.5-flash-lite",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "google" as const,
  },

  // ==========================================
  // 2. Groq Models (Free & Fast via GROQ_API_KEY)
  // ==========================================
  {
    name: "Qwen 3.6 27B (Groq)",
    value: "qwen/qwen3.6-27b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "groq" as const,
  },
  {
    name: "Qwen 3.8 27B (Groq)",
    value: "qwen/qwen3.8-27b",
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

  // ==========================================
  // 3. NVIDIA NIM Models (via NVIDIA_API_KEY)
  // ==========================================
  {
    name: "Nemotron 3 Super 120B (NVIDIA NIM)",
    value: "nvidia/nemotron-3-super-120b-a12b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Nemotron 3.5 Lightning 30B (NVIDIA NIM)",
    value: "nvidia/nemotron-3.5-lightning-30b-a3b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },
  {
    name: "Nemotron 3 Ultra 550B (NVIDIA NIM)",
    value: "nvidia/nemotron-3-ultra-550b-a55b",
    disabled: false,
    contextWindow: 1_000_000,
    provider: "nvidia" as const,
  },

  // ==========================================
  // 4. OpenRouter Models (Free Tier via OPENROUTER_API_KEY)
  // ==========================================
  {
    name: "Nemotron 3.5 Lightning (Free)",
    value: "nvidia/nemotron-3.5-lightning:free",
    disabled: false,
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
 * documented API (re-verified Aug 2026):
 *
 * - OpenRouter: unified `reasoning.effort`, mapped to the nearest level the
 *   target model supports → safe Low/Medium/High for its models.
 * - DeepSeek (NVIDIA NIM): `reasoning_effort` accepts low | high | max
 *   (medium & xhigh are mapped up to high).
 * - BigModel GLM: GLM-4.x has no effort parameter.
 * - Google Gemini: `thinkingLevel` (Gemini 3) / `thinkingBudget` (2.5) —
 *   low | medium | high across the catalog's Gemini models.
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
  "google/gemma-4-31b-it:free": ["Low", "Medium", "High"],

  // DeepSeek (via NVIDIA NIM)
  "deepseek-v4-flash": ["Low", "High", "Max"],

  // Google Gemini (direct)
  "gemini-3.7-flash": ["Low", "Medium", "High"],
  "gemini-3.5-flash": ["Low", "Medium", "High"],
  "gemini-2.5-flash": ["Low", "Medium", "High"],
  "gemini-3.1-flash-lite": ["Low", "Medium", "High"],
  "gemini-3.5-flash-lite": ["Low", "Medium", "High"],

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
  "deepseek-v4-flash": "Fast reasoning for everyday tasks",
  "glm-4-flash": "Fastest for quick answers",
  "gemini-3.7-flash": "Free — great for daily use",
  "gemini-3.5-flash": "Free — newest Google flash",
  "gemini-2.5-flash": "Free — fast responses",
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
  return model?.provider ?? "bigmodel";
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
