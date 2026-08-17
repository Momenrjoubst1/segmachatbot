import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/redis/client.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
  },
}));

vi.mock('../rag/rag-supabase-client.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    lt: vi.fn().mockResolvedValue({ data: [], error: null }),
    select: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../config/memory.config.js', () => ({
  MemoryConfig: {
    memoryBank: { enabled: true, maxFactsPerUser: 100 },
    crossSession: { enabled: true, maxPreviousChats: 5 },
    contextWindow: { maxTokens: 8000, keepFirstMessages: 5, keepLastMessages: 40 },
    summarization: { enabled: true },
    caching: { enabled: true, ttl: 300 },
    debug: { enabled: false },
  },
}));

vi.mock('../rag/bm25-search.js', () => ({
  getBM25Search: vi.fn().mockResolvedValue({
    getDocCount: vi.fn().mockReturnValue(0),
    search: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ totalDocs: 0, avgDocLen: 0, vocabSize: 0 }),
  }),
}));

describe('Memory Cleanup', () => {
  it('should have cleanupOldMemories method', async () => {
    const { unifiedMemory } = await import('../services/memory/unified-memory.js');
    expect(typeof unifiedMemory.cleanupOldMemories).toBe('function');
  });

  it('cleanupOldMemories should return cleaned count', async () => {
    const { unifiedMemory } = await import('../services/memory/unified-memory.js');
    const result = await unifiedMemory.cleanupOldMemories();
    expect(result).toHaveProperty('cleaned');
    expect(typeof result.cleaned).toBe('number');
  });
});
