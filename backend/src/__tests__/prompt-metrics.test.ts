import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../config/constants.js', () => ({
  PROMPT_CONFIG: {
    AB_ENABLED: false,
    AB_VARIANT: 'auto',
    AB_FORCE_VARIANT: undefined,
    MAX_SYSTEM_TOKENS: undefined,
    METRICS_ENABLED: true,
  },
}));

vi.mock('../prompts/index.js', () => ({}));

import {
  recordPromptMetrics,
  getPromptMetricsSnapshot,
  resetPromptMetrics,
} from '../services/metrics/prompt-metrics.js';
import type { PromptMetricsPayload } from '../services/metrics/prompt-metrics.js';

function makePayload(overrides: Partial<PromptMetricsPayload> = {}): PromptMetricsPayload {
  return {
    variant: 'default',
    promptLength: 500,
    promptTokensEstimate: 125,
    buildTimeMs: 10,
    userId: 'user-1',
    hasRag: false,
    hasMemory: false,
    hasCourses: false,
    toolCount: 0,
    multiAgent: false,
    ...overrides,
  };
}

describe('recordPromptMetrics', () => {
  beforeEach(() => {
    resetPromptMetrics();
  });

  it('increments total count on each call', () => {
    recordPromptMetrics(makePayload());
    recordPromptMetrics(makePayload());
    const snapshot = getPromptMetricsSnapshot();
    expect(snapshot.total).toBe(2);
  });

  it('increments variant counter', () => {
    recordPromptMetrics(makePayload({ variant: 'concise' }));
    recordPromptMetrics(makePayload({ variant: 'concise' }));
    recordPromptMetrics(makePayload({ variant: 'detailed' }));
    const snapshot = getPromptMetricsSnapshot();
    expect(snapshot.byVariant.concise).toBe(2);
    expect(snapshot.byVariant.detailed).toBe(1);
    expect(snapshot.byVariant.default).toBe(0);
  });

  it('accumulates token estimates', () => {
    recordPromptMetrics(makePayload({ promptTokensEstimate: 100 }));
    recordPromptMetrics(makePayload({ promptTokensEstimate: 200 }));
    const snapshot = getPromptMetricsSnapshot();
    expect(snapshot.avgTokensEstimate).toBe(150);
  });

  it('rounds average tokens estimate', () => {
    recordPromptMetrics(makePayload({ promptTokensEstimate: 100 }));
    recordPromptMetrics(makePayload({ promptTokensEstimate: 150 }));
    const snapshot = getPromptMetricsSnapshot();
    expect(snapshot.avgTokensEstimate).toBe(125);
  });
});

describe('getPromptMetricsSnapshot', () => {
  beforeEach(() => {
    resetPromptMetrics();
  });

  it('returns zeroed snapshot after reset', () => {
    const snapshot = getPromptMetricsSnapshot();
    expect(snapshot.total).toBe(0);
    expect(snapshot.avgTokensEstimate).toBe(0);
    expect(snapshot.byVariant).toEqual({
      default: 0,
      concise: 0,
      detailed: 0,
      motivational: 0,
    });
  });

  it('returns a copy of byVariant (not a reference)', () => {
    recordPromptMetrics(makePayload({ variant: 'default' }));
    const snap1 = getPromptMetricsSnapshot();
    const snap2 = getPromptMetricsSnapshot();
    expect(snap1.byVariant).not.toBe(snap2.byVariant);
    expect(snap1.byVariant).toEqual(snap2.byVariant);
  });
});

describe('resetPromptMetrics', () => {
  it('resets all counters to zero', () => {
    recordPromptMetrics(makePayload({ variant: 'default', promptTokensEstimate: 100 }));
    recordPromptMetrics(makePayload({ variant: 'concise', promptTokensEstimate: 200 }));
    recordPromptMetrics(makePayload({ variant: 'detailed', promptTokensEstimate: 300 }));

    resetPromptMetrics();

    const snapshot = getPromptMetricsSnapshot();
    expect(snapshot.total).toBe(0);
    expect(snapshot.avgTokensEstimate).toBe(0);
    expect(snapshot.byVariant.default).toBe(0);
    expect(snapshot.byVariant.concise).toBe(0);
    expect(snapshot.byVariant.detailed).toBe(0);
    expect(snapshot.byVariant.motivational).toBe(0);
  });
});
