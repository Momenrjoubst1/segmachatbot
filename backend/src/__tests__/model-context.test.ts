import { describe, it, expect } from 'vitest';
import {
  MODEL_CONTEXT_WINDOWS,
  DEFAULT_CONTEXT_WINDOW,
  MAX_OUTPUT_TOKENS,
  getModelContextWindow,
  getModelMaxOutputTokens,
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

  it('covers the production default model deepseek-v4-flash', () => {
    // The live chat pipeline defaults to deepseek-v4-flash; if this entry
    // disappears the whole pipeline silently budgets against the fallback.
    expect(isKnownModel('deepseek-v4-flash')).toBe(true);
  });
});

describe('DEFAULT_CONTEXT_WINDOW', () => {
  it('is 1,000,000 (unified million-token policy)', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(1_000_000);
  });
});

describe('MAX_OUTPUT_TOKENS', () => {
  it('is Claude-class (64k default)', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(64_000);
  });

  it('returns the full ceiling for models without a provider cap', () => {
    expect(getModelMaxOutputTokens('deepseek-v4-flash')).toBe(MAX_OUTPUT_TOKENS);
    expect(getModelMaxOutputTokens('gemini-2.5-flash')).toBe(MAX_OUTPUT_TOKENS);
    expect(getModelMaxOutputTokens('unknown-model')).toBe(MAX_OUTPUT_TOKENS);
  });

  it('clamps to the provider completion cap for strict providers', () => {
    // Groq caps max_completion_tokens at 32,768
    expect(getModelMaxOutputTokens('qwen/qwen3.6-27b')).toBe(32_768);
    // GitHub Models gpt-4o-mini caps at 16,384
    expect(getModelMaxOutputTokens('gpt-4o-mini')).toBe(16_384);
    // OpenRouter free tier is tighter still
    expect(getModelMaxOutputTokens('google/gemini-2.0-flash-exp:free')).toBe(8_192);
  });
});

describe('getModelContextWindow', () => {
  it('returns context window for known model', () => {
    expect(getModelContextWindow('glm-4-flash')).toBe(1_000_000);
  });

  it('returns context window for the default chat model', () => {
    expect(getModelContextWindow('deepseek-v4-flash')).toBe(1_000_000);
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
    expect(info!.contextWindow).toBe(1_000_000);
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
