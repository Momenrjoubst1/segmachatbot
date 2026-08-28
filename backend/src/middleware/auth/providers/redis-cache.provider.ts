/**
 * Redis Cache Provider
 * مزوّد التخزين المؤقت عبر Redis
 *
 * Implements ICacheProvider using ioredis.
 * This is the default provider for production deployments.
 */

import redis from '../../../config/redis/client.js';
import type { ICacheProvider } from '../auth.types.js';

/**
 * Create a Redis cache provider.
 *
 * Uses the existing ioredis client singleton — no new connections.
 */
export function createRedisCacheProvider(): ICacheProvider {
  return {
    async get(key: string): Promise<string | null> {
      return redis.get(key);
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
      const result = await redis.set(key, value, 'EX', Math.ceil(ttlSeconds));
      return result === 'OK';
    },

    async del(key: string): Promise<boolean> {
      const result = await redis.del(key);
      return result === 1;
    },
  };
}

/**
 * Create an in-memory cache provider for testing.
 * Not suitable for production — data is lost on process restart.
 */
export function createMemoryCacheProvider(): ICacheProvider {
  const store = new Map<string, { value: string; expiresAt: number }>();

  // Cleanup expired entries every 5 minutes
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Allow the process to exit without waiting for cleanup
  if (cleanup.unref) {
    cleanup.unref();
  }

  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
      store.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return true;
    },

    async del(key: string): Promise<boolean> {
      return store.delete(key);
    },
  };
}
