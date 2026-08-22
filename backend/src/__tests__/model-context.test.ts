import { describe, it, expect } from 'vitest';
import {
  MODEL_CONTEXT_WINDOWS,
  DEFAULT_CONTEXT_WINDOW,
  getModelContextWindow,
  getModelInfo,
  getKnownModelIds,
  isKnownModel,
} from '../services/memory/model-context.js';

describe('MODEL_CONTEXT_WINDOWS', () => {
  it('is a non-empty record', () => {
    expect(Object.keys(MODEL_CONTEXT_WINDOWS).length).toBeGreaterThan(0);
  });

  it('each entry has value, contextWindow, and provider', () => {
    for (const [id, info] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      expect(info.value).toBe(id);
      expect(typeof info.contextWindow).toBe('number');
      expect(info.contextWindow).toBeGreaterThan(0);
      expect(typeof info.provider).toBe('string');
    }
  });
});

describe('DEFAULT_CONTEXT_WINDOW', () => {
  it('is 8000', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(8000);
  });
});

describe('getModelContextWindow', () => {
  it('returns context window for known model', () => {
    expect(getModelContextWindow('glm-4-flash')).toBe(128_000);
  });

  it('returns DEFAULT_CONTEXT_WINDOW for unknown model', () => {
    expect(getModelContextWindow('nonexistent-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('returns 1,000,000 for gemini model', () => {
    expect(getModelContextWindow('google/gemini-2.0-flash-exp:free')).toBe(1_000_000);
  });
});

describe('getModelInfo', () => {
  it('returns full info for known model', () => {
    const info = getModelInfo('gpt-4o');
    expect(info).toBeDefined();
    expect(info!.value).toBe('gpt-4o');
    expect(info!.contextWindow).toBe(128_000);
    expect(info!.provider).toBe('openrouter');
  });

  it('returns undefined for unknown model', () => {
    expect(getModelInfo('unknown')).toBeUndefined();
  });
});

describe('getKnownModelIds', () => {
  it('returns an array of model IDs', () => {
    const ids = getKnownModelIds();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBe(Object.keys(MODEL_CONTEXT_WINDOWS).length);
  });

  it('includes known models', () => {
    const ids = getKnownModelIds();
    expect(ids).toContain('glm-4-flash');
    expect(ids).toContain('gpt-4o');
  });
});

describe('isKnownModel', () => {
  it('returns true for known model', () => {
    expect(isKnownModel('glm-4-flash')).toBe(true);
  });

  it('returns false for unknown model', () => {
    expect(isKnownModel('not-a-model')).toBe(false);
  });
});
