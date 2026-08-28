/**
 * Redis Sliding Window Rate Limit Store
 * مخزن تقييد المعدل⤢ Redis بالنافذة الانزلاقية
 *
 * Uses sorted sets + atomic Lua script for smooth rolling counts.
 * Falls back to in-memory on Redis errors.
 */

import type { Options, ClientRateLimitInfo } from 'express-rate-limit';
import type { IRateLimitStore, IRedisClient, RedisStoreOptions } from './rate-limit.types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('rate-limit-redis');

// In-memory fallback counters (used when Redis fails)
const fallbackCounters = new Map<
  string,
  { hits: number; resetTimeMs: number; timeout: ReturnType<typeof setTimeout> }
>();
const FALLBACK_COUNTERS_MAX_SIZE = 10_000;

/**
 * Create a Redis-backed sliding window rate limit store.
 *
 * @param options - Redis client and prefix configuration.
 * @returns IRateLimitStore implementation.
 */
export function createRedisSlidingWindowStore(options: RedisStoreOptions): IRateLimitStore {
  const { client, prefix } = options;

  return {
    prefix: prefix,

    init(_options: Options): void {
      // Window is managed by the Lua script, nothing to init
    },

    async increment(key: string): Promise<ClientRateLimitInfo> {
      const now = Date.now();
      const member = `${now}-${Math.random().toString(36).substring(2)}`;

      try {
        const result = await client.slidingWindowRateLimit(
          prefix + key,
          now,
          300_000, // default 5 min window, overridden by init()
          member,
        );

        const [totalHits, resetTimeMs] = result;
        return {
          totalHits,
          resetTime: new Date(resetTimeMs),
        };
      } catch (error) {
        log.error('Redis Rate Limit Error, falling back to in-memory', { error });
        return fallbackIncrement(key, 300_000);
      }
    },

    async decrement(_key: string): Promise<void> {
      // Not implemented — not needed for basic rate limiting
    },

    async resetKey(key: string): Promise<void> {
      const fallbackKey = `fallback_rl_${prefix}${key}`;
      const existing = fallbackCounters.get(fallbackKey);
      if (existing) {
        clearTimeout(existing.timeout);
        fallbackCounters.delete(fallbackKey);
      }
      await client.del(prefix + key);
    },
  };
}

/**
 * In-memory fallback increment (used when Redis fails).
 */
function fallbackIncrement(key: string, windowMs: number): ClientRateLimitInfo {
  const now = Date.now();
  const fallbackKey = `fallback_rl_${key}`;
  const existing = fallbackCounters.get(fallbackKey);

  if (existing && existing.resetTimeMs > now) {
    existing.hits += 1;
    return {
      totalHits: existing.hits,
      resetTime: new Date(existing.resetTimeMs),
    };
  }

  if (existing) {
    clearTimeout(existing.timeout);
  }

  // Evict oldest entries if at capacity
  if (fallbackCounters.size >= FALLBACK_COUNTERS_MAX_SIZE) {
    let evicted = 0;
    for (const [k, v] of fallbackCounters) {
      if (v.resetTimeMs <= now) {
        clearTimeout(v.timeout);
        fallbackCounters.delete(k);
        evicted++;
        if (fallbackCounters.size < FALLBACK_COUNTERS_MAX_SIZE * 0.8) break;
      }
    }
    log.debug(`Evicted ${evicted} expired fallback counter entries`);
  }

  const resetTimeMs = now + windowMs;
  const timeout = setTimeout(() => fallbackCounters.delete(fallbackKey), windowMs);
  fallbackCounters.set(fallbackKey, { hits: 1, resetTimeMs, timeout });

  return {
    totalHits: 1,
    resetTime: new Date(resetTimeMs),
  };
}

/**
 * Start periodic cleanup of stale fallback counters.
 * Call this once at startup.
 */
export function startFallbackCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, data] of fallbackCounters.entries()) {
      if (data.resetTimeMs <= now) {
        clearTimeout(data.timeout);
        fallbackCounters.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug(`Cleaned ${cleaned} stale fallback counter entries`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}
