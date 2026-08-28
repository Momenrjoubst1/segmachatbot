/**
 * Fallback chain definitions for model routing
 * تعريفات سلسلة الاحتياطي لتوجيه النماذج
 *
 * Every referenced id must exist in services/memory/model-context.ts
 * MODEL_CONTEXT_WINDOWS. Retired provider ids (verified dead against the
 * Groq / OpenRouter live catalogs) are pruned — see the catalog comment.
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("fallback-chains");

export const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  "stealth/ox-alpha": ["nvidia/llama-3.3-70b-instruct", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "deepseek-v4-flash": ["gemini-3.7-flash", "gemini-2.5-flash", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "gemini-3.7-flash": ["gemini-2.5-flash", "gemini-2.5-pro", "glm-5.2", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "gemini-2.5-flash": ["gemini-2.5-pro", "gemini-3.7-flash", "glm-5.2", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "gemini-2.5-pro": ["gemini-2.5-flash", "gemini-3.7-flash", "gpt-4o-mini"],
  "gemini-3-flash": ["gemini-2.5-flash", "gemini-3.7-flash", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "gemini-3.1-flash-lite": ["gemini-2.5-flash", "gemini-3.7-flash", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "glm-5.2": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "glm-4-flash": ["glm-5.2", "qwen/qwen3.6-27b"],
  "gpt-5.4": ["gpt-4o", "gpt-4o-mini"],
  "gpt-4o": ["gpt-4o-mini", "qwen/qwen3.6-27b"],
  "gpt-4o-mini": ["qwen/qwen3.6-27b", "nvidia/nemotron-3.5-lightning:free"],
  "qwen/qwen3.6-27b": ["qwen/qwen3.8-27b", "gpt-4o-mini", "glm-5.2"],
  "qwen/qwen3.8-27b": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "qwen/qwen3-32b": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "openai/gpt-oss-120b": ["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "openai/gpt-oss-20b": ["openai/gpt-oss-120b", "gpt-4o-mini"],
  "google/gemma-4-31b-it:free": ["google/gemma-4-26b-a4b-it:free", "gpt-4o-mini"],
  "google/gemma-4-26b-a4b-it:free": ["nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "nvidia/nemotron-3-ultra-550b-a55b:free": ["nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "nvidia/nemotron-3.5-lightning:free": ["poolside/laguna-s-2.1:free", "gpt-4o-mini"],
  "poolside/laguna-s-2.1:free": ["nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "poolside/laguna-xs-2.1:free": ["nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "accounts/fireworks/models/gemma-4-31b-it": ["gpt-4o-mini", "nvidia/nemotron-3.5-lightning:free"],
  "inclusionai/ling-3.0-tiny": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "nvidia/llama-3.1-nemotron-70b-instruct": ["nvidia/llama-3.3-70b-instruct", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "nvidia/llama-3.3-70b-instruct": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "nvidia/deepseek-r1": ["deepseek-v4-flash", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "meta/llama-3.1-8b-instruct": ["meta/llama-3.1-70b-instruct", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
  "meta/llama-3.1-70b-instruct": ["nvidia/llama-3.3-70b-instruct", "qwen/qwen3.6-27b", "gpt-4o-mini"],
  "qwen/qwen2.5-72b-instruct": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "llama-3.3-70b": ["qwen/qwen3.6-27b", "gpt-4o-mini"],
  "llama-3.1-8b": ["llama-3.3-70b", "nvidia/nemotron-3.5-lightning:free", "gpt-4o-mini"],
};

export function loadFallbackChains(): Record<string, string[]> {
  const envChains = process.env.MODEL_FALLBACK_CHAINS;
  if (envChains) {
    try {
      const parsed = JSON.parse(envChains) as Record<string, string[]>;
      log.info("Loaded custom model fallback chains from env", { count: Object.keys(parsed).length });
      return { ...DEFAULT_FALLBACK_CHAINS, ...parsed };
    } catch (e) {
      log.warn("Failed to parse MODEL_FALLBACK_CHAINS, using defaults", { error: (e as Error).message });
    }
  }
  return DEFAULT_FALLBACK_CHAINS;
}
