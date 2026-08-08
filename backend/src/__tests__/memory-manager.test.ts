import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildMemoryContext, tryExtractAndStore, resetExtractionCounter } from '../services/memory/memory-context-builder.js';

// Mock memory-repository functions
vi.mock('../services/memory/memory-repository.js', () => ({
  getMemory: vi.fn().mockResolvedValue([]),
  setMemory: vi.fn().mockResolvedValue(undefined),
  getCustomInstructions: vi.fn().mockResolvedValue(''),
}));

vi.mock('../services/memory/memory-fact-extractor.js', () => ({
  extractFacts: vi.fn().mockResolvedValue([{ key: 'test_fact', value: 'test_value', category: 'fact' }]),
}));

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
      // extractFacts should be called 3 times (once per successful extraction)
      // The 4th call should be skipped before extractFacts is called
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
