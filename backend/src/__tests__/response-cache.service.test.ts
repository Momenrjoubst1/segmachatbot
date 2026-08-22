import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../config/redis/client.js', () => {
  const store = new Map<string, string>();
  return {
    default: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, val: string, ...args: any[]) => { store.set(key, val); return 'OK'; }),
      del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
      _store: store,
    },
  };
});

import { responseCache } from '../services/chat/response-cache.service.js';
import redis from '../config/redis/client.js';

const mockRedis = vi.mocked(redis);

beforeEach(() => {
  mockRedis._store.clear();
  mockRedis.get.mockImplementation(async (key: string) => mockRedis._store.get(key) ?? null);
  mockRedis.set.mockImplementation(async (key: string, val: string, ...args: any[]) => { mockRedis._store.set(key, val); return 'OK'; });
  mockRedis.del.mockImplementation(async (key: string) => { mockRedis._store.delete(key); return 1; });
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockRedis.del.mockClear();
});

describe('ResponseCache', () => {
  describe('shouldBypassCache', () => {
    it('bypasses when hasPersonalContext is true', () => {
      const result = responseCache.shouldBypassCache({
        hasPersonalContext: true,
        hasToolRequest: false,
        isFollowUp: false,
        ragEnabled: true,
      });
      expect(result).toEqual({ bypass: true, reason: 'personal_context' });
    });

    it('bypasses when hasTextbookChunks is true', () => {
      const result = responseCache.shouldBypassCache({
        hasPersonalContext: false,
        hasToolRequest: false,
        isFollowUp: false,
        ragEnabled: true,
        hasTextbookChunks: true,
      });
      expect(result).toEqual({ bypass: true, reason: 'textbook_chunks' });
    });

    it('bypasses when hasToolRequest is true', () => {
      const result = responseCache.shouldBypassCache({
        hasPersonalContext: false,
        hasToolRequest: true,
        isFollowUp: false,
        ragEnabled: true,
      });
      expect(result).toEqual({ bypass: true, reason: 'tool_request' });
    });

    it('bypasses when isFollowUp is true', () => {
      const result = responseCache.shouldBypassCache({
        hasPersonalContext: false,
        hasToolRequest: false,
        isFollowUp: true,
        ragEnabled: true,
      });
      expect(result).toEqual({ bypass: true, reason: 'follow_up' });
    });

    it('returns null when no bypass conditions met', () => {
      const result = responseCache.shouldBypassCache({
        hasPersonalContext: false,
        hasToolRequest: false,
        isFollowUp: false,
        ragEnabled: true,
      });
      expect(result).toBeNull();
    });
  });

  describe('checkCache', () => {
    it('returns miss when cache is empty', async () => {
      const result = await responseCache.checkCache([1, 2, 3], 'test query');
      expect(result.hit).toBe(false);
    });

    it('returns hit for similar cached query', async () => {
      const embedding = [0.1, 0.2, 0.3];
      await responseCache.cacheResponse(
        'What is calculus?',
        embedding,
        'Calculus is a branch of mathematics...',
        { model: 'gpt-4o', ragSources: ['wiki'] },
      );

      const result = await responseCache.checkCache(
        [0.1, 0.2, 0.3],
        'What is calculus?',
      );
      expect(result.hit).toBe(true);
      expect(result.cachedResponse).toBe('Calculus is a branch of mathematics...');
      expect(result.similarity).toBe(1);
    });

    it('returns miss for dissimilar embeddings', async () => {
      await responseCache.cacheResponse(
        'What is calculus?',
        [1, 0, 0],
        'Response about calculus',
        { model: 'gpt-4o', ragSources: [] },
      );

      const result = await responseCache.checkCache(
        [0, 0, 1],
        'What is physics?',
      );
      expect(result.hit).toBe(false);
    });
  });

  describe('cacheResponse', () => {
    it('stores response in cache', async () => {
      await responseCache.cacheResponse(
        'What is calculus about?',
        [1, 2, 3],
        'Calculus is a branch of mathematics that studies continuous change and rates.',
        { model: 'gpt-4o', ragSources: [] },
      );

      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('does not store responses shorter than min length', async () => {
      await responseCache.cacheResponse(
        'Hi',
        [1, 2, 3],
        'short',
        { model: 'gpt-4o', ragSources: [] },
      );

      const indexKey = 'resp_cache:global:index';
      expect(mockRedis._store.has(indexKey)).toBe(false);
    });

    it('stores user-scoped cache entries', async () => {
      await responseCache.cacheResponse(
        'What is the meaning of life?',
        [0.5, 0.5],
        'The meaning of life is a philosophical question.',
        { model: 'gpt-4o', ragSources: [] },
        'user-123',
      );

      const indexKey = 'resp_cache:user:user-123:index';
      expect(mockRedis._store.has(indexKey)).toBe(true);
    });
  });

  describe('invalidateByPattern', () => {
    it('removes matching entries', async () => {
      await responseCache.cacheResponse(
        'What is calculus?',
        [1, 2, 3],
        'Calculus response that is long enough to pass validation',
        { model: 'gpt-4o', ragSources: [] },
      );
      await responseCache.cacheResponse(
        'What is physics?',
        [4, 5, 6],
        'Physics response that is long enough to pass validation check',
        { model: 'gpt-4o', ragSources: [] },
      );

      const removed = await responseCache.invalidateByPattern('calculus');
      expect(removed).toBe(1);
    });

    it('returns 0 for empty pattern', async () => {
      const removed = await responseCache.invalidateByPattern('');
      expect(removed).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns empty stats when cache is empty', async () => {
      const stats = await responseCache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(500);
      expect(stats.oldestEntry).toBeNull();
    });

    it('returns correct size', async () => {
      await responseCache.cacheResponse(
        'Question one?',
        [1, 2, 3],
        'Answer one that is long enough to pass min validation',
        { model: 'gpt-4o', ragSources: [] },
      );

      const stats = await responseCache.getStats();
      expect(stats.size).toBe(1);
    });
  });
});
