import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../services/memory/model-context.js', () => ({
  MODEL_CONTEXT_WINDOWS: {
    'gpt-4o': { value: 'gpt-4o', contextWindow: 128000, provider: 'openrouter' },
    'gpt-4o-mini': { value: 'gpt-4o-mini', contextWindow: 128000, provider: 'github' },
  },
  DEFAULT_CONTEXT_WINDOW: 8000,
  getModelContextWindow: vi.fn((modelId: string) => {
    const windows: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
    };
    return windows[modelId] || 8000;
  }),
  getModelInfo: vi.fn((modelId: string) => {
    const models: Record<string, any> = {
      'gpt-4o': { value: 'gpt-4o', contextWindow: 128000, provider: 'openrouter' },
      'gpt-4o-mini': { value: 'gpt-4o-mini', contextWindow: 128000, provider: 'github' },
    };
    return models[modelId];
  }),
}));

vi.mock('../../../features/ai-assistant/model-catalog.js', () => ({
  getContextWindow: vi.fn((modelId: string) => {
    const windows: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'deepseek-v4-flash': 64000,
    };
    return windows[modelId] || 8192;
  }),
  MODELS: {
    'gpt-4o': { contextWindow: 128000 },
    'gpt-4o-mini': { contextWindow: 128000 },
  },
}));

vi.mock('../config/constants.js', () => ({
  MEMORY_CONFIG: {
    MAX_FACTS_PER_USER: 100,
    MIN_MESSAGES_FOR_EXTRACTION: 6,
    MAX_EXTRACTIONS_PER_SESSION: 5,
    MAX_FACT_AGE_DAYS: 90,
    debug: {
      enabled: false,
    },
  },
}));

import {
  estimateTokens,
  estimateTokensHeuristic,
  estimateMessageTokens,
  estimateConversationTokens,
  getContextWindowStatus,
  calculateTrimPlan,
} from '../services/memory/token-estimator.js';

describe('Token Estimator', () => {
  describe('estimateTokensHeuristic', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokensHeuristic('')).toBe(0);
    });

    it('should estimate English text tokens', () => {
      const tokens = estimateTokensHeuristic('Hello world, this is a test message.');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it('should estimate Arabic text tokens', () => {
      const tokens = estimateTokensHeuristic('مرحبا بالعالم، هذه رسالة اختبار');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate mixed language tokens', () => {
      const tokens = estimateTokensHeuristic('Hello مرحبا world عالم');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate code tokens', () => {
      const code = `function hello() {
        console.log("Hello world");
        return true;
      }`;
      const tokens = estimateTokensHeuristic(code);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000);
      const tokens = estimateTokensHeuristic(longText);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should estimate tokens for English text', () => {
      const tokens = estimateTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for Arabic text', () => {
      const tokens = estimateTokens('مرحبا بالعالم');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateMessageTokens', () => {
    it('should estimate tokens for simple text message', () => {
      const message = {
        role: 'user',
        content: 'Hello, how are you?',
      };
      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for message with array content', () => {
      const message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      };
      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for image message', () => {
      const message = {
        role: 'user',
        content: [
          { type: 'image', url: 'https://example.com/image.jpg' },
        ],
      };
      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for message with tool calls', () => {
      const message = {
        role: 'assistant',
        content: 'Let me help you with that.',
        toolCalls: [{ id: '1', name: 'calculator', args: {} }],
      };
      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateConversationTokens', () => {
    it('should estimate tokens for conversation', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];
      const tokens = estimateConversationTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return base overhead for empty conversation', () => {
      const tokens = estimateConversationTokens([]);
      expect(tokens).toBe(3); // Base overhead
    });
  });

  describe('getContextWindowStatus', () => {
    it('should return status for normal usage', () => {
      const messages = [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const status = getContextWindowStatus(messages, 'gpt-4o');
      expect(status).toHaveProperty('usagePercent');
      expect(status).toHaveProperty('shouldSummarize');
      expect(status).toHaveProperty('urgency');
      expect(status.urgency).toBe('ok');
    });

    it('should flag near limit usage', () => {
      // Use 'gpt-4o' which has 128000 context window. Many messages should trigger critical.
      const messages = Array(5000).fill({ role: 'user', content: 'Hello world, this is a test message with some content that takes up tokens' });
      const status = getContextWindowStatus(messages, 'gpt-4o');
      expect(['critical', 'warning']).toContain(status.urgency);
    });

    it('should flag summarization needed', () => {
      // Use 'gpt-4o' which has 128000 context window. Many messages should trigger summarization.
      const messages = Array(5000).fill({ role: 'user', content: 'Hello world, this is a test message with some content that takes up tokens' });
      const status = getContextWindowStatus(messages, 'gpt-4o');
      expect(status.shouldSummarize).toBe(true);
    });
  });

  describe('calculateTrimPlan', () => {
    it('should return trim plan for over-limit messages', () => {
      const messages = Array(50).fill({ role: 'user', content: 'Hello world, this is a test message with some content' });
      const plan = calculateTrimPlan(messages, 100);
      expect(plan).toHaveProperty('keepFirst');
      expect(plan).toHaveProperty('keepLast');
      expect(plan).toHaveProperty('summarizeMiddle');
      expect(plan).toHaveProperty('estimatedTokensAfter');
    });

    it('should not trim when under limit', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const plan = calculateTrimPlan(messages, 10000);
      expect(plan.summarizeMiddle).toBe(0);
    });
  });
});
