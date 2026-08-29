/**
 * Fallback chain definitions for model routing
 * تعريفات سلسلة الاحتياطي لتوجيه النماذج
 *
 * Every referenced id must exist in services/memory/model-context.ts
 * MODEL_CONTEXT_WINDOWS. The catalog holds only live ids (verified against
 * the provider APIs on 2026-08-29) — dead ids were pruned and dead
 * providers (baichat, azure/github, fireworks, novita, cerebras) are no
 * longer referenced. The universal terminator appended by model-router.ts
 * is qwen/qwen3.6-27b (Groq, live & free), not the retired gpt-4o-mini.
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("fallback-chains");

export const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  "deepseek-v4-flash": ["gemini-3.7-flash", "qwen/qwen3.6-27b", "glm-4-flash"],
  "deepseek-ai/deepseek-v4-flash-0731": ["deepseek-v4-flash", "qwen/qwen3.6-27b"],
  "gemini-3.7-flash": ["gemini-2.5-flash", "gemini-3.5-flash", "qwen/qwen3.6-27b", "glm-4-flash"],
  "gemini-2.5-flash": ["gemini-3.7-flash", "gemini-3.5-flash", "qwen/qwen3.6-27b"],
  "gemini-3.1-flash-lite": ["gemini-2.5-flash", "gemini-3.7-flash", "qwen/qwen3.6-27b"],
  "gemini-3.5-flash": ["gemini-3.7-flash", "gemini-2.5-flash", "qwen/qwen3.6-27b"],
  "gemini-3.5-flash-lite": ["gemini-3.1-flash-lite", "gemini-2.5-flash", "qwen/qwen3.6-27b"],
  "glm-4-flash": ["qwen/qwen3.6-27b", "nvidia/nemotron-3.5-lightning-30b-a3b"],
  "qwen/qwen3.6-27b": ["qwen/qwen3.8-27b", "glm-4-flash", "openai/gpt-oss-20b"],
  "qwen/qwen3.8-27b": ["qwen/qwen3.6-27b", "glm-4-flash"],
  "openai/gpt-oss-120b": ["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "glm-4-flash"],
  "openai/gpt-oss-20b": ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"],
  "google/gemma-4-31b-it:free": ["google/gemma-4-26b-a4b-it:free", "qwen/qwen3.6-27b"],
  "google/gemma-4-26b-a4b-it:free": ["nvidia/nemotron-3.5-lightning:free", "qwen/qwen3.6-27b"],
  "nvidia/nemotron-3-ultra-550b-a55b:free": ["nvidia/nemotron-3.5-lightning:free", "qwen/qwen3.6-27b"],
  "nvidia/nemotron-3.5-lightning:free": ["poolside/laguna-s-2.1:free", "qwen/qwen3.6-27b"],
  "poolside/laguna-s-2.1:free": ["nvidia/nemotron-3.5-lightning:free", "qwen/qwen3.6-27b"],
  "poolside/laguna-xs-2.1:free": ["nvidia/nemotron-3.5-lightning:free", "qwen/qwen3.6-27b"],
  "nvidia/nemotron-3-super-120b-a12b": ["nvidia/nemotron-3.5-lightning-30b-a3b", "qwen/qwen3.6-27b"],
  "nvidia/nemotron-3.5-lightning-30b-a3b": ["qwen/qwen3.6-27b", "glm-4-flash"],
  "nvidia/nemotron-3-ultra-550b-a55b": ["nvidia/nemotron-3-super-120b-a12b", "qwen/qwen3.6-27b"],
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
