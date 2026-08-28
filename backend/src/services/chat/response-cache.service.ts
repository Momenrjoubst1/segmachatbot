// Redis-backed semantic response cache: replays answers to similar questions, bypassed when personalized.

import { createLogger } from '../../utils/logger.js';
import redis from '../../config/redis/client.js';
import { createHash } from 'crypto';

const log = createLogger('response-cache');

// Cache entry and result types

export interface CachedResponse {
  question: string;
  response: string;
  embedding: number[];
  model: string;
  ragSources: string[];
  createdAt: number;
  hitCount: number;
}

export interface CacheCheckResult {
  hit: boolean;
  cachedResponse?: string;
  similarity?: number;
  cacheKey?: string;
}

export interface CacheBypassReason {
  bypass: true;
  reason: string;
}

export interface CacheBypassOptions {
  hasPersonalContext: boolean; // User courses, memory
  hasToolRequest: boolean;     // Intent requires tools
  isFollowUp: boolean;        // References previous messages
  ragEnabled: boolean;
  hasTextbookChunks?: boolean;
}

export interface CacheMetadata {
  queryText: string;
  queryEmbedding: number[];
  model: string;
  ragSources: string[];
  bypassed: boolean;
  userId?: string;
}

// Cache configuration and key helpers

const DEFAULT_CONFIG = {
  enabled: process.env.RESPONSE_CACHE_ENABLED !== 'false',
  ttl: parseInt(process.env.RESPONSE_CACHE_TTL || '3600'),          // 1 hour
  indexTtl: parseInt(process.env.RESPONSE_CACHE_INDEX_TTL || '86400'), // 24 hours
  similarityThreshold: parseFloat(process.env.RESPONSE_CACHE_SIMILARITY || '0.92'),
  maxCacheSize: parseInt(process.env.RESPONSE_CACHE_MAX_SIZE || '500'),
  minResponseLength: 20,
  maxResponseLength: 10000,
};

const CACHE_PREFIX = 'resp_cache:';

function getIndexKey(userId?: string): string {
  return userId ? `${CACHE_PREFIX}user:${userId}:index` : `${CACHE_PREFIX}global:index`;
}

function getItemKey(key: string, userId?: string): string {
  return userId ? `${CACHE_PREFIX}user:${userId}:${key}` : `${CACHE_PREFIX}global:${key}`;
}

// Serialised write-lock: chains writes so concurrent index updates never interleave at awaits.
let _writeLock: Promise<unknown> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeLock.then(fn, fn);
  _writeLock = next.then(() => {}, () => {});
  return next;
}

// Cache implementation

class ResponseCacheService {
  // Checks whether the request is personalized enough to bypass the cache.
  shouldBypassCache(options: CacheBypassOptions): CacheBypassReason | null {
    if (options.hasPersonalContext) return { bypass: true, reason: 'personal_context' };
    if (options.hasTextbookChunks) return { bypass: true, reason: 'textbook_chunks' };
    if (options.hasToolRequest) return { bypass: true, reason: 'tool_request' };
    if (options.isFollowUp) return { bypass: true, reason: 'follow_up' };
    return null;
  }

  // Checks Redis for a similar question using cosine similarity on embeddings.
  async checkCache(
    queryEmbedding: number[],
    queryText: string,
    userId?: string,
  ): Promise<CacheCheckResult> {
    if (!DEFAULT_CONFIG.enabled) return { hit: false };

    try {
      // Get cached embeddings index from Redis scoped to user/global
      const indexKey = getIndexKey(userId);
      const indexData = await redis.get(indexKey);
      if (!indexData) return { hit: false };

      const index: Array<{ key: string; embedding: number[]; question: string }> =
        JSON.parse(indexData);

      let bestMatch: { key: string; similarity: number; question: string } | null = null;

      for (const entry of index) {
        const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity >= DEFAULT_CONFIG.similarityThreshold) {
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { key: entry.key, similarity, question: entry.question };
          }
        }
      }

      if (bestMatch) {
        const itemKey = getItemKey(bestMatch.key, userId);
        const cachedData = await redis.get(itemKey);
        if (cachedData) {
          const cached: CachedResponse = JSON.parse(cachedData);
          // Increment hit count
          cached.hitCount++;
          await redis.set(
            itemKey,
            JSON.stringify(cached),
            'EX',
            DEFAULT_CONFIG.ttl,
          );

          log.info('Cache HIT', {
            query: queryText.substring(0, 50),
            similarity: bestMatch.similarity.toFixed(3),
            hitCount: cached.hitCount,
            userId,
          });

          return {
            hit: true,
            cachedResponse: cached.response,
            similarity: bestMatch.similarity,
            cacheKey: bestMatch.key,
          };
        }
      }

      return { hit: false };
    } catch (err) {
      log.warn('Cache check failed', { error: (err as Error)?.message });
      return { hit: false };
    }
  }

  // Stores a response under the write lock so index updates can't overwrite each other.
  async cacheResponse(
    queryText: string,
    queryEmbedding: number[],
    response: string,
    metadata: { model: string; ragSources: string[] },
    userId?: string,
  ): Promise<void> {
    if (!DEFAULT_CONFIG.enabled) return;

    // Boundary guards — skip before acquiring the lock
    if (
      response.length < DEFAULT_CONFIG.minResponseLength ||
      response.length > DEFAULT_CONFIG.maxResponseLength
    )
      return;

    return withWriteLock(async () => {
      try {
        const cacheKey = this.generateKey(queryText);
        const cached: CachedResponse = {
          question: queryText,
          response,
          embedding: queryEmbedding,
          model: metadata.model,
          ragSources: metadata.ragSources,
          createdAt: Date.now(),
          hitCount: 0,
        };

        // Save the full response object scoped by user
        const itemKey = getItemKey(cacheKey, userId);
        await redis.set(
          itemKey,
          JSON.stringify(cached),
          'EX',
          DEFAULT_CONFIG.ttl,
        );

        // Read the latest index inside the lock to see prior chained writes.
        let index: Array<{ key: string; embedding: number[]; question: string }> = [];
        const indexKey = getIndexKey(userId);
        const indexData = await redis.get(indexKey);
        if (indexData) {
          try {
            index = JSON.parse(indexData);
          } catch (parseErr) {
            log.warn('Corrupted cache index, starting fresh', { error: (parseErr as Error)?.message });
            index = [];
          }
        }

        // Avoid duplicate entries for the same cache key
        if (!index.some((e) => e.key === cacheKey)) {
          index.push({ key: cacheKey, embedding: queryEmbedding, question: queryText });
        }

        // Evict oldest entries when over the size limit
        if (index.length > DEFAULT_CONFIG.maxCacheSize) {
          const toRemove = index.splice(0, index.length - DEFAULT_CONFIG.maxCacheSize);
          for (const entry of toRemove) {
            await redis.del(getItemKey(entry.key, userId));
          }
        }

        await redis.set(indexKey, JSON.stringify(index), 'EX', DEFAULT_CONFIG.indexTtl);

        log.info('Response cached', {
          query: queryText.substring(0, 50),
          key: cacheKey,
          indexSize: index.length,
          userId,
        });
      } catch (err) {
        log.warn('Cache store failed', { error: (err as Error)?.message });
      }
    });
  }

  // Invalidates all cache entries whose question text contains the given pattern.
  async invalidateByPattern(pattern: string, userId?: string): Promise<number> {
    if (!pattern) return 0;
    return withWriteLock(async () => {
      try {
        const indexKey = getIndexKey(userId);
        const indexData = await redis.get(indexKey);
        if (!indexData) return 0;

        const index: Array<{ key: string; embedding: number[]; question: string }> =
          JSON.parse(indexData);

        const lowerPattern = pattern.toLowerCase();
        const toRemove = index.filter((e) =>
          e.question.toLowerCase().includes(lowerPattern),
        );

        if (toRemove.length === 0) return 0;

        // Delete matching Redis keys
        for (const entry of toRemove) {
          await redis.del(getItemKey(entry.key, userId));
        }

        // Rebuild index without removed entries
        const remaining = index.filter((e) =>
          !e.question.toLowerCase().includes(lowerPattern),
        );
        await redis.set(indexKey, JSON.stringify(remaining), 'EX', DEFAULT_CONFIG.indexTtl);

        log.info('Cache invalidated by pattern', { pattern, removed: toRemove.length, userId });
        return toRemove.length;
      } catch (err) {
        log.warn('Cache invalidation failed', { error: (err as Error)?.message });
        return 0;
      }
    });
  }

  // Gets cache size, limit, and oldest entry timestamp.
  async getStats(userId?: string): Promise<{ size: number; maxSize: number; oldestEntry: number | null }> {
    try {
      const indexKey = getIndexKey(userId);
      const indexData = await redis.get(indexKey);
      if (!indexData) return { size: 0, maxSize: DEFAULT_CONFIG.maxCacheSize, oldestEntry: null };

      const index = JSON.parse(indexData) as Array<{
        key: string;
        embedding: number[];
        question: string;
      }>;

      let oldestEntry: number | null = null;
      if (index.length > 0) {
        try {
          const firstData = await redis.get(getItemKey(index[0].key, userId));
          if (firstData) {
            const first: CachedResponse = JSON.parse(firstData);
            oldestEntry = first.createdAt ?? null;
          }
        } catch (entryErr) {
          log.warn('Failed to read oldest cache entry for stats', { error: (entryErr as Error)?.message });
        }
      }

      return { size: index.length, maxSize: DEFAULT_CONFIG.maxCacheSize, oldestEntry };
    } catch (statsErr) {
      log.warn('Failed to get cache stats', { error: (statsErr as Error)?.message });
      return { size: 0, maxSize: DEFAULT_CONFIG.maxCacheSize, oldestEntry: null };
    }
  }

  // Private helpers

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    // Clamp to [-1, 1] to absorb floating-point rounding errors
    return Math.max(-1, Math.min(1, dotProduct / denominator));
  }

  private generateKey(text: string): string {
    // Use SHA-256 for collision-free cache keys
    return createHash('sha256').update(text).digest('hex').substring(0, 32);
  }
}

// Export singleton
export const responseCache = new ResponseCacheService();
