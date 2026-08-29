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

    it('has GLM-4 Flash as first model (app default)', () => {
      expect(MODELS[0].value).toBe('glm-4-flash');
      expect(MODELS[0].provider).toBe('bigmodel');
    });

    it('contains no retired model ids', () => {
      const retired = [
        'stealth/ox-alpha', 'glm-5.2', 'gemini-2.5-pro', 'gemini-3-flash',
        'gpt-5.4', 'gpt-4o', 'gpt-4o-mini', 'qwen/qwen3-32b',
        'inclusionai/ling-3.0-tiny', 'accounts/fireworks/models/gemma-4-31b-it',
        'nvidia/llama-3.3-70b-instruct', 'llama-3.3-70b', 'llama-3.1-8b',
      ];
      const values = MODELS.map((m) => m.value);
      for (const id of retired) expect(values).not.toContain(id);
    });
  });

  describe('DEFAULT_MODEL_ID', () => {
    it('is set to glm-4-flash', () => {
      expect(DEFAULT_MODEL_ID).toBe('glm-4-flash');
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

    it('returns default provider "bigmodel" for unknown model', () => {
      expect(getModelProvider('unknown-model')).toBe('bigmodel');
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
