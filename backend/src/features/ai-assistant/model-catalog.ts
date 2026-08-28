// Model catalog — backend re-export of model context windows for stable import paths.

export {
  MODEL_CONTEXT_WINDOWS,
  getModelContextWindow,
  getModelInfo,
  getKnownModelIds,
  isKnownModel,
  DEFAULT_CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
  getModelMaxOutputTokens,
  type ModelContextInfo,
} from '../../services/memory/model-context.js';

import { MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from '../../services/memory/model-context.js';
import type { ModelContextInfo } from '../../services/memory/model-context.js';

export type KnownModelId = keyof typeof MODEL_CONTEXT_WINDOWS;

// Re-exported alias matching the frontend `getContextWindow` signature.
export function getContextWindow(modelId: string): number {
  const model = MODEL_CONTEXT_WINDOWS[modelId] as ModelContextInfo | undefined;
  return model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

/** Flat array of all known models (mirrors frontend MODELS constant) */
export const MODELS: Array<{ value: string; contextWindow: number; label: string }> =
  Object.values(MODEL_CONTEXT_WINDOWS).map((m) => ({
    value: m.value,
    contextWindow: m.contextWindow,
    label: m.value,
  }));
