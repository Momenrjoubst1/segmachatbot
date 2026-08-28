/**
 * In-Memory Rate Limit Store
 * مخزن تقييد المعدل في الذاكرة
 *
 * Simple in-memory store for testing or single-instance deployments.
 * Not suitable for multi-instance production (no shared state).
 */

import type { Options, ClientRateLimitInfo } from 'express-rate-limit';
import type { IRateLimitStore, MemoryStoreOptions } from './rate-limit.types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('rate-limit-memory');

interface CounterEntry {
  hits: number;
  resetTimeMs: number;
}

/**
 * Create an in-memory rate limit store.
 *
 * @param options - Prefix and max entries configuration.
 * @returns IRateLimitStore implementation.
 */
export function createMemoryRateLimitStore(options: MemoryStoreOptions): IRateLimitStore {
  const { prefix, maxEntries = 10_000 } = options;
  const counters = new Map<string, CounterEntry>();

  // Periodic cleanup every 5 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of counters) {
      if (entry.resetTimeMs <= now) {
        counters.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug(`Cleaned ${cleaned} expired rate limit entries`);
    }
  }, 5 * 60 * 1000);

  // Allow process to exit without waiting for cleanup
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  let windowMs = 60_000; // default

  return {
    prefix: prefix,

    init(options: Options): void {
      windowMs = options.windowMs;
    },

    async increment(key: string): Promise<ClientRateLimitInfo> {
      const now = Date.now();
      const fullKey = `${prefix}${key}`;
      const entry = counters.get(fullKey);

      if (entry && entry.resetTimeMs > now) {
        entry.hits += 1;
        return {
          totalHits: entry.hits,
          resetTime: new Date(entry.resetTimeMs),
        };
      }

      // Evict oldest if at capacity
      if (counters.size >= maxEntries) {
        let evicted = 0;
        for (const [k, v] of counters) {
          if (v.resetTimeMs <= now) {
            counters.delete(k);
            evicted++;
            if (counters.size < maxEntries * 0.8) break;
          }
        }
        log.debug(`Evicted ${evicted} expired entries`);
      }

      const resetTimeMs = now + windowMs;
      counters.set(fullKey, { hits: 1, resetTimeMs });

      return {
        totalHits: 1,
        resetTime: new Date(resetTimeMs),
      };
    },

    async decrement(_key: string): Promise<void> {
      // Not implemented — not needed for basic rate limiting
    },

    async resetKey(key: string): Promise<void> {
      counters.delete(`${prefix}${key}`);
    },
  };
}
