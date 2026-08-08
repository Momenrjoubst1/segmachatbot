import { describe, it, expect } from 'vitest';
import {
  MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_CONTEXT_WINDOW,
  getContextWindow,
  getModelProvider,
  isAvailableModelId,
  resolveModelId,
} from '../features/ai-assistant/model-catalog.js';

describe('Constants', () => {
  describe('MODELS', () => {
    it('should have at least one model', () => {
      expect(MODELS.length).toBeGreaterThan(0);
    });

    it('should have required fields for each model', () => {
      for (const model of MODELS) {
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('value');
        expect(model).toHaveProperty('icon');
        expect(model).toHaveProperty('disabled');
        expect(model).toHaveProperty('contextWindow');
        expect(model).toHaveProperty('provider');
      }
    });

    it('should have unique model values', () => {
      const values = MODELS.map(m => m.value);
      const uniqueValues = new Set(values);
      expect(values.length).toBe(uniqueValues.size);
    });
  });

  describe('DEFAULT_MODEL_ID', () => {
    it('should be defined', () => {
      expect(DEFAULT_MODEL_ID).toBeDefined();
    });

    it('should be a valid model ID', () => {
      expect(isAvailableModelId(DEFAULT_MODEL_ID)).toBe(true);
    });
  });

  describe('DEFAULT_CONTEXT_WINDOW', () => {
    it('should be a positive number', () => {
      expect(DEFAULT_CONTEXT_WINDOW).toBeGreaterThan(0);
    });
  });

  describe('getContextWindow', () => {
    it('should return context window for existing model', () => {
      const model = MODELS[0];
      const contextWindow = getContextWindow(model.value);
      expect(contextWindow).toBe(model.contextWindow);
    });

    it('should return default for unknown model', () => {
      const contextWindow = getContextWindow('unknown-model');
      expect(contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    });
  });

  describe('getModelProvider', () => {
    it('should return provider for existing model', () => {
      const model = MODELS[0];
      const provider = getModelProvider(model.value);
      expect(provider).toBe(model.provider);
    });

    it('should return default provider for unknown model', () => {
      const provider = getModelProvider('unknown-model');
      expect(provider).toBe('openrouter');
    });
  });

  describe('isAvailableModelId', () => {
    it('should return true for enabled models', () => {
      const enabledModels = MODELS.filter(m => !m.disabled);
      for (const model of enabledModels) {
        expect(isAvailableModelId(model.value)).toBe(true);
      }
    });

    it('should return false for disabled models', () => {
      const disabledModels = MODELS.filter(m => m.disabled);
      for (const model of disabledModels) {
        expect(isAvailableModelId(model.value)).toBe(false);
      }
    });

    it('should return false for unknown models', () => {
      expect(isAvailableModelId('unknown-model')).toBe(false);
    });
  });

  describe('resolveModelId', () => {
    it('should return valid model ID for existing model', () => {
      const model = MODELS[0];
      const resolved = resolveModelId(model.value);
      expect(resolved).toBe(model.value);
    });

    it('should return default for undefined input', () => {
      const resolved = resolveModelId(undefined);
      expect(resolved).toBe(DEFAULT_MODEL_ID);
    });

    it('should return default for empty string', () => {
      const resolved = resolveModelId('');
      expect(resolved).toBe(DEFAULT_MODEL_ID);
    });

    it('should return default for unknown model', () => {
      const resolved = resolveModelId('unknown-model');
      expect(resolved).toBe(DEFAULT_MODEL_ID);
    });

    it('should trim whitespace', () => {
      const model = MODELS[0];
      const resolved = resolveModelId(`  ${model.value}  `);
      expect(resolved).toBe(model.value);
    });
  });
});
