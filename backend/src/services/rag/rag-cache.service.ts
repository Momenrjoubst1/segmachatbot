/**
 * RAG Query Cache Service — Redis-backed
 * نظام تخزين مؤقت لاستعلامات RAG لتسريع الاستجابات
 * 
 * Caches:
 * 1. Embedding vectors (query -> embedding)  — TTL 3600s
 * 2. Search results (query -> ranked documents) — TTL 1800s
 * 
 * Uses Redis (or MockRedis in dev) so cache survives process restarts
 * and works correctly across multiple PM2 workers.
 * Falls back gracefully if cache is disabled or misses.
 */

import { createLogger } from '../../utils/logger.js';
import crypto from 'crypto';
import redis from '../../config/redis/client.js';

const log = createLogger('rag-cache');

// ==========================================
// Types
// ==========================================

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

interface RankedDocument {
  id: string | number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  rerankScore: number;
}

// ==========================================
// Configuration
// ==========================================

const DEFAULT_CONFIG = {
  enabled: process.env.RAG_CACHE_ENABLED !== 'false',
  embeddingTTL: parseInt(process.env.RAG_EMBEDDING_CACHE_TTL || '3600'), // seconds
  resultsTTL: parseInt(process.env.RAG_RESULTS_CACHE_TTL || '1800'),     // seconds
  minQueryLength: parseInt(process.env.RAG_CACHE_MIN_QUERY_LENGTH || '5'),
};

const KEY_PREFIX = 'rag:';

// ==========================================
// Cache Implementation
// ==========================================

class RAGQueryCache {
  private static instance: RAGQueryCache;
  
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, size: 0 };
  
  private constructor() {
    if (DEFAULT_CONFIG.enabled) {
      log.info('RAG Query Cache initialized (Redis-backed)', { config: DEFAULT_CONFIG });
    }
  }
  
  static getInstance(): RAGQueryCache {
    if (!RAGQueryCache.instance) {
      RAGQueryCache.instance = new RAGQueryCache();
    }
    return RAGQueryCache.instance;
  }
  
  // ==========================================
  // Key Generation
  // ==========================================
  
  private hashQuery(query: string): string {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }
  
  // ==========================================
  // Embedding Cache (async — Redis)
  // ==========================================
  
  async getEmbedding(query: string): Promise<number[] | null> {
    if (!DEFAULT_CONFIG.enabled) return null;
    if (query.length < DEFAULT_CONFIG.minQueryLength) return null;
    
    try {
      const key = `${KEY_PREFIX}embed:${this.hashQuery(query)}`;
      const raw = await redis.get(key);
      
      if (!raw) {
        this.stats.misses++;
        return null;
      }
      
      const value = JSON.parse(raw) as number[];
      this.stats.hits++;
      
      if (process.env.MEMORY_DEBUG === 'true') {
        log.debug('Embedding cache hit (Redis)', { query: query.substring(0, 50) });
      }
      
      return value;
    } catch (err) {
      log.warn('Redis getEmbedding error', { error: (err as Error)?.message });
      this.stats.misses++;
      return null;
    }
  }
  
  async setEmbedding(query: string, embedding: number[]): Promise<void> {
    if (!DEFAULT_CONFIG.enabled) return;
    if (query.length < DEFAULT_CONFIG.minQueryLength) return;
    if (!embedding || embedding.length === 0) return;
    
    try {
      const key = `${KEY_PREFIX}embed:${this.hashQuery(query)}`;
      await redis.set(key, JSON.stringify(embedding), 'EX', DEFAULT_CONFIG.embeddingTTL);
    } catch (err) {
      log.warn('Redis setEmbedding error', { error: (err as Error)?.message });
    }
  }
  
  // ==========================================
  // Search Results Cache (async — Redis)
  // ==========================================
  
  async getResults(query: string, matchCount: number, userId?: string): Promise<RankedDocument[] | null> {
    if (!DEFAULT_CONFIG.enabled) return null;
    if (query.length < DEFAULT_CONFIG.minQueryLength) return null;
    
    try {
      const userScope = userId ? `user:${userId}:` : 'global:';
      const key = `${KEY_PREFIX}results:${userScope}${this.hashQuery(query)}:${matchCount}`;
      const raw = await redis.get(key);
      
      if (!raw) {
        this.stats.misses++;
        return null;
      }
      
      const value = JSON.parse(raw) as RankedDocument[];
      this.stats.hits++;
      
      if (process.env.MEMORY_DEBUG === 'true') {
        log.debug('Results cache hit (Redis)', { 
          query: query.substring(0, 50), 
          docCount: value.length,
          userId,
        });
      }
      
      return value;
    } catch (err) {
      log.warn('Redis getResults error', { error: (err as Error)?.message });
      this.stats.misses++;
      return null;
    }
  }
  
  async setResults(query: string, matchCount: number, results: RankedDocument[], userId?: string): Promise<void> {
    if (!DEFAULT_CONFIG.enabled) return;
    if (query.length < DEFAULT_CONFIG.minQueryLength) return;
    if (!results || results.length === 0) return;
    
    try {
      const userScope = userId ? `user:${userId}:` : 'global:';
      const key = `${KEY_PREFIX}results:${userScope}${this.hashQuery(query)}:${matchCount}`;
      await redis.set(key, JSON.stringify(results), 'EX', DEFAULT_CONFIG.resultsTTL);
    } catch (err) {
      log.warn('Redis setResults error', { error: (err as Error)?.message });
    }
  }
  
  // ==========================================
  // Stats & Control
  // ==========================================
  
  getStats(): CacheStats {
    return { ...this.stats };
  }
  
  async clear(): Promise<void> {
    try {
      // Scan and delete all rag:* keys
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
      
      this.stats = { hits: 0, misses: 0, evictions: 0, size: 0 };
      log.info('Cache cleared (Redis keys deleted)');
    } catch (err) {
      log.warn('Redis clear error', { error: (err as Error)?.message });
    }
  }
  
  stop(): void {
    // No-op for Redis (connection managed by redis-client)
  }
}

// Export singleton
export const ragCache = RAGQueryCache.getInstance();
export { RAGQueryCache };
