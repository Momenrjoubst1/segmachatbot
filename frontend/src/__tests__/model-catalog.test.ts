import { describe, it, expect } from 'vitest';

import {
  MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_CONTEXT_WINDOW,
  getContextWindow,
  getModelProvider,
  isAvailableModelId,
  resolveModelId,
} from '@/features/ai-assistant/model-catalog';

describe('model-catalog', () => {
  describe('MODELS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(MODELS)).toBe(true);
      expect(MODELS.length).toBeGreaterThan(0);
    });

    it('each model has required fields', () => {
      MODELS.forEach((model) => {
        expect(typeof model.name).toBe('string');
        expect(typeof model.value).toBe('string');
        expect(typeof model.contextWindow).toBe('number');
        expect(typeof model.disabled).toBe('boolean');
        expect(typeof model.provider).toBe('string');
      });
    });

    it('has Ox-Alpha as first model (app default)', () => {
      expect(MODELS[0].value).toBe('stealth/ox-alpha');
      expect(MODELS[0].provider).toBe('openrouter');
    });
  });

  describe('DEFAULT_MODEL_ID', () => {
    it('is set to stealth/ox-alpha', () => {
      expect(DEFAULT_MODEL_ID).toBe('stealth/ox-alpha');
    });
  });

  describe('DEFAULT_CONTEXT_WINDOW', () => {
    it('is 1,000,000 (unified policy)', () => {
      expect(DEFAULT_CONTEXT_WINDOW).toBe(1_000_000);
    });
  });

  describe('getContextWindow', () => {
    it('returns context window for a known model', () => {
      expect(getContextWindow('glm-4-flash')).toBe(1_000_000);
    });

    it('returns context window for gemini-2.5-flash', () => {
      expect(getContextWindow('gemini-2.5-flash')).toBe(1_000_000);
    });

    it('returns context window for qwen3.8 model', () => {
      expect(getContextWindow('qwen/qwen3.8-27b')).toBe(1_000_000);
    });

    it('returns default context window for unknown model', () => {
      expect(getContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW);
    });
  });

  describe('getModelProvider', () => {
    it('returns provider for a known model', () => {
      expect(getModelProvider('glm-4-flash')).toBe('bigmodel');
    });

    it('returns provider for groq model', () => {
      expect(getModelProvider('qwen/qwen3.6-27b')).toBe('groq');
    });

    it('returns default provider "openrouter" for unknown model', () => {
      expect(getModelProvider('unknown-model')).toBe('openrouter');
    });
  });

  describe('isAvailableModelId', () => {
    it('returns true for available model', () => {
      expect(isAvailableModelId('glm-4-flash')).toBe(true);
    });

    it('returns false for unknown model', () => {
      expect(isAvailableModelId('nonexistent-model')).toBe(false);
    });
  });

  describe('resolveModelId', () => {
    it('returns the input when it is a valid model id', () => {
      expect(resolveModelId('glm-4-flash')).toBe('glm-4-flash');
    });

    it('returns default when input is undefined', () => {
      expect(resolveModelId(undefined)).toBe(DEFAULT_MODEL_ID);
    });

    it('returns default when input is empty string', () => {
      expect(resolveModelId('')).toBe(DEFAULT_MODEL_ID);
    });

    it('returns default when input is unknown', () => {
      expect(resolveModelId('nonexistent')).toBe(DEFAULT_MODEL_ID);
    });

    it('returns default when input is whitespace only', () => {
      expect(resolveModelId('   ')).toBe(DEFAULT_MODEL_ID);
    });
  });
});
