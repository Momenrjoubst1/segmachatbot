/**
 * Prompt Metrics — تتبع مقاييس البرومبت
 *
 * Lightweight structured logging for prompt A/B testing.
 * Every request logs: variant, prompt length, token estimate, build time.
 * Ready for aggregation in Datadog / Grafana / Supabase analytics.
 */

import { createLogger } from '../../utils/logger.js';
import { PROMPT_CONFIG } from '../../config/constants.js';
import type { PersonaVariant } from '../../prompts/index.js';

const log = createLogger('prompt-metrics');

export interface PromptMetricsPayload {
  variant: PersonaVariant;
  promptLength: number;
  promptTokensEstimate: number;
  buildTimeMs: number;
  userId: string;
  hasRag: boolean;
  hasMemory: boolean;
  hasCourses: boolean;
  toolCount: number;
  multiAgent: boolean;
}

/**
 * In-memory counters for quick health checks (resets on restart).
 * For persistent analytics, query logs or Supabase.
 */
const counters: Record<PersonaVariant, number> = {
  default: 0,
  concise: 0,
  detailed: 0,
  motivational: 0,
};

let totalPrompts = 0;
let totalTokensEstimate = 0;

export function recordPromptMetrics(payload: PromptMetricsPayload): void {
  if (!PROMPT_CONFIG.METRICS_ENABLED) return;

  counters[payload.variant] = (counters[payload.variant] ?? 0) + 1;
  totalPrompts++;
  totalTokensEstimate += payload.promptTokensEstimate;

  log.info('prompt.metrics', {
    variant: payload.variant,
    promptLength: payload.promptLength,
    promptTokensEstimate: payload.promptTokensEstimate,
    buildTimeMs: payload.buildTimeMs,
    hasRag: payload.hasRag,
    hasMemory: payload.hasMemory,
    hasCourses: payload.hasCourses,
    toolCount: payload.toolCount,
    multiAgent: payload.multiAgent,
    avgTokensEstimate: Math.round(totalTokensEstimate / totalPrompts),
  });
}

export function getPromptMetricsSnapshot(): {
  total: number;
  byVariant: Record<PersonaVariant, number>;
  avgTokensEstimate: number;
} {
  return {
    total: totalPrompts,
    byVariant: { ...counters },
    avgTokensEstimate: totalPrompts > 0 ? Math.round(totalTokensEstimate / totalPrompts) : 0,
  };
}

export function resetPromptMetrics(): void {
  for (const k of Object.keys(counters) as PersonaVariant[]) counters[k] = 0;
  totalPrompts = 0;
  totalTokensEstimate = 0;
}
