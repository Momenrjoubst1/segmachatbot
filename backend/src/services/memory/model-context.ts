/**
 * Model Context Window Definitions (Backend Copy)
 * تعريف نوافذ السياق للنماذج - نسخة الباك إند
 * 
 * This mirrors the frontend model-catalog.ts for backend use
 * without requiring cross-project imports.
 */

export interface ModelContextInfo {
  value: string;
  contextWindow: number;
  provider: string;
}

/** Model context window mapping - keep in sync with frontend model-catalog.ts */
export const MODEL_CONTEXT_WINDOWS: Record<string, ModelContextInfo> = {
  // BigModel (ZhipuAI)
  'glm-4-flash': { value: 'glm-4-flash', contextWindow: 128_000, provider: 'bigmodel' },
  'glm-5.2': { value: 'glm-5.2', contextWindow: 128_000, provider: 'bigmodel' },
  
  // Azure OpenAI
  'gpt-5.4': { value: 'gpt-5.4', contextWindow: 128_000, provider: 'azure' },
  
  // GitHub Models
  'gpt-4o-mini': { value: 'gpt-4o-mini', contextWindow: 128_000, provider: 'github' },
  'gpt-4o': { value: 'gpt-4o', contextWindow: 128_000, provider: 'openrouter' },
  
  // Groq
  'llama-3.3-70b-versatile': { value: 'llama-3.3-70b-versatile', contextWindow: 128_000, provider: 'groq' },
  'llama-3.1-8b-instant': { value: 'llama-3.1-8b-instant', contextWindow: 128_000, provider: 'groq' },
  
  // OpenRouter
  'google/gemini-2.0-flash-exp:free': { value: 'google/gemini-2.0-flash-exp:free', contextWindow: 1_000_000, provider: 'openrouter' },
  'qwen/qwen-2.5-72b-instruct:free': { value: 'qwen/qwen-2.5-72b-instruct:free', contextWindow: 32_000, provider: 'openrouter' },
  
  // Fireworks
  'accounts/fireworks/models/gemma-4-31b-it': { value: 'accounts/fireworks/models/gemma-4-31b-it', contextWindow: 262_144, provider: 'fireworks' },
  
  // Novita
  'inclusionai/ling-3.0-tiny': { value: 'inclusionai/ling-3.0-tiny', contextWindow: 262_144, provider: 'novita' },
};

/** Default context window for unknown models */
export const DEFAULT_CONTEXT_WINDOW = 8_000;

/**
 * Get context window for a model ID
 */
export function getModelContextWindow(modelId: string): number {
  const model = MODEL_CONTEXT_WINDOWS[modelId];
  return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
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