import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock memory-repository functions
vi.mock('../services/memory/memory-repository.js', () => ({
  getMemory: vi.fn().mockResolvedValue([]),
  setMemory: vi.fn().mockResolvedValue(undefined),
  getCustomInstructions: vi.fn().mockResolvedValue(''),
}));

vi.mock('../services/memory/memory-fact-extractor.js', () => ({
  extractFacts: vi.fn().mockResolvedValue([{ key: 'test_fact', value: 'test_value', category: 'fact' }]),
}));

vi.mock('../services/memory/reliable-memory-extraction.service.js', () => ({
  reliableMemoryExtraction: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/logger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    createLogger: vi.fn(() => mockLogger),
  };
});

import { buildMemoryContext, tryExtractAndStore, resetExtractionCounter } from '../services/memory/memory-context-builder.js';

describe('Memory Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtractionCounter('test-user');
  });

  describe('buildMemoryContext', () => {
    it('should return empty context for new user', async () => {
      const context = await buildMemoryContext('test-user');
      expect(context.facts).toBe('');
      expect(context.customInstructions).toBe('');
    });

    it('should return custom instructions if set', async () => {
      const { getCustomInstructions } = await import('../services/memory/memory-repository.js');
      (getCustomInstructions as any).mockResolvedValue('Always respond in Arabic');

      const context = await buildMemoryContext('test-user');
      expect(context.customInstructions).toBe('Always respond in Arabic');
    });
  });

  describe('tryExtractAndStore', () => {
    it('should not extract from short conversations', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      await tryExtractAndStore('test-user', messages);

      const { extractFacts } = await import('../services/memory/memory-fact-extractor.js');
      expect(extractFacts).not.toHaveBeenCalled();
    });

    it('should extract from conversations with 6+ messages', async () => {
      const messages = Array(6).fill({ role: 'user', content: 'Test message' });

      await tryExtractAndStore('test-user', messages);

      const { extractFacts } = await import('../services/memory/memory-fact-extractor.js');
      expect(extractFacts).toHaveBeenCalled();
    });

    it('should respect extraction limit per user', async () => {
      const messages = Array(6).fill({ role: 'user', content: 'Test message' });

      // First 3 extractions should work
      await tryExtractAndStore('test-user', messages);
      await tryExtractAndStore('test-user', messages);
      await tryExtractAndStore('test-user', messages);

      // 4th should be skipped due to limit
      await tryExtractAndStore('test-user', messages);

      const { extractFacts } = await import('../services/memory/memory-fact-extractor.js');
      expect(extractFacts).toHaveBeenCalledTimes(3);
    });

    it('should reset extraction counter', async () => {
      const messages = Array(6).fill({ role: 'user', content: 'Test message' });

      await tryExtractAndStore('test-user', messages);
      await tryExtractAndStore('test-user', messages);

      resetExtractionCounter('test-user');

      await tryExtractAndStore('test-user', messages);

      const { extractFacts } = await import('../services/memory/memory-fact-extractor.js');
      expect(extractFacts).toHaveBeenCalledTimes(3);
    });
  });
});
