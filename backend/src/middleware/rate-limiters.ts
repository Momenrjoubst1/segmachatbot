/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Rate Limiters — per-endpoint rate limiting
 *
 * By default, limiters use in-memory storage.
 * Set RATE_LIMIT_STORE=redis to enable RedisStore counters shared
 * across server restarts / instances.
 *
 * ┌──────────────────────────┬────────┬─────────┬──────────────────────────────┐
 * │ Endpoint                 │ Window │ Max     │ Purpose                      │
 * ├──────────────────────────┼────────┼─────────┼──────────────────────────────┤
 * │ /api/livekit-token       │ 15 min │ 10      │ Prevent LiveKit quota drain  │
 * │ /api/agent/start|stop    │ 5 min  │ 3       │ Prevent agent spam           │
 * │ /api/moderation/report   │ 10 min │ 5       │ Prevent fake mass reports    │
 * │ /api/moderation/*-text   │ 1 min  │ 60      │ Prevent Perspective API drain│
 * │ All other routes         │ 1 min  │ 100     │ General DDoS protection      │
 * └──────────────────────────┴────────┴─────────┴──────────────────────────────┘
 * ════════════════════════════════════════════════════════════════════════════════
 */

import rateLimit, { Store, Options, ClientRateLimitInfo, ipKeyGenerator } from 'express-rate-limit';
import redis from '../config/redis/client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rate-limiter');
const useRedisStore = process.env.RATE_LIMIT_STORE === 'redis';
const fallbackCounters = new Map<
  string,
  {
    hits: number;
    resetTimeMs: number;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
const FALLBACK_COUNTERS_MAX_SIZE = 10_000;

// Periodic cleanup interval for fallback counters
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Cleanup stale entries from fallbackCounters
 * Called periodically to prevent memory leaks
 */
function cleanupStaleCounters(): void {
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
}

/**
 * Start periodic cleanup of fallback counters
 */
function startCleanupInterval(): void {
  if (cleanupInterval) return;
  
  // Run cleanup every 5 minutes
  cleanupInterval = setInterval(cleanupStaleCounters, 5 * 60 * 1000);
  log.info('Started fallback counter cleanup interval');
}

/**
 * Stop periodic cleanup
 */
function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('Stopped fallback counter cleanup interval');
  }
}

// Start cleanup interval when module loads
startCleanupInterval();

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    stopCleanupInterval();
    // Clear all timeouts
    for (const [, data] of fallbackCounters.entries()) {
      clearTimeout(data.timeout);
    }
    fallbackCounters.clear();
  });
}

/**
 * Sliding Window Log Redis Store
 * Uses Redis Sorted Sets (ZSET) and a custom Lua script to ensure atomicity.
 * It records the timestamp of every request, enabling a perfectly smooth
 * rolling window and eliminating the start-of-minute bursts allowed by fixed windows.
 */
class SlidingWindowRedisStore implements Store {
  private redisClient: typeof redis;
  public prefix: string;
  public windowMs!: number;

  constructor(client: typeof redis, prefix: string) {
    this.redisClient = client;
    this.prefix = prefix;
    // Lua script is defined once at module scope (see below the class definition)
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).substring(2)}`;

    try {
      const result = await this.redisClient.slidingWindowRateLimit(
        this.prefix + key,
        now,
        this.windowMs,
        member
      );

      const [totalHits, resetTimeMs] = result as [number, number];
      return {
        totalHits,
        resetTime: new Date(resetTimeMs)
      };
    } catch (error) {
      log.error('Redis Rate Limit Error, falling back to in-memory logic', { error });
      const fallbackKey = `fallback_rl_${this.prefix}${key}`;
      const existing = fallbackCounters.get(fallbackKey);

      if (existing && existing.resetTimeMs > now) {
        existing.hits += 1;
        return {
          totalHits: existing.hits,
          resetTime: new Date(existing.resetTimeMs)
        };
      }

      if (existing) {
        clearTimeout(existing.timeout);
      }

      // Evict oldest entries if at capacity to prevent unbounded memory growth
      if (fallbackCounters.size >= FALLBACK_COUNTERS_MAX_SIZE) {
        const nowMs = Date.now();
        let evicted = 0;
        for (const [k, v] of fallbackCounters) {
          if (v.resetTimeMs <= nowMs) {
            clearTimeout(v.timeout);
            fallbackCounters.delete(k);
            evicted++;
            if (fallbackCounters.size < FALLBACK_COUNTERS_MAX_SIZE * 0.8) break;
          }
        }
        log.debug(`Evicted ${evicted} expired fallback counter entries`);
      }

      const resetTimeMs = now + this.windowMs;
      const timeout = setTimeout(() => fallbackCounters.delete(fallbackKey), this.windowMs);
      fallbackCounters.set(fallbackKey, { hits: 1, resetTimeMs, timeout });

      return {
        totalHits: 1,
        resetTime: new Date(resetTimeMs)
      };
    }
  }

  async decrement(_key: string): Promise<void> {
    // Optionally implement decrement if needed, but usually not strictly required for basic rate limiting
  }

  async resetKey(key: string): Promise<void> {
    const fallbackKey = `fallback_rl_${this.prefix}${key}`;
    const existing = fallbackCounters.get(fallbackKey);
    if (existing) {
      clearTimeout(existing.timeout);
      fallbackCounters.delete(fallbackKey);
    }
    await this.redisClient.del(this.prefix + key);
  }
}

function optionalStore(prefix: string): { store?: Store } {
  if (!useRedisStore) return {};
  return { store: new SlidingWindowRedisStore(redis, prefix) };
}

// Define atomic Lua script on the Redis client once at module load.
// Previously this was inside the SlidingWindowRedisStore constructor, causing
// defineCommand to be called 7+ times (once per rate limiter). ioredis does
// not prevent re-defining a command on the same client.
redis.defineCommand('slidingWindowRateLimit', {
  numberOfKeys: 1,
  lua: `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local member = ARGV[3]

    local clearBefore = now - window
    redis.call('ZREMRANGEBYSCORE', key, "-inf", clearBefore)
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)

    local currentHits = redis.call('ZCARD', key)

    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local oldestScore = now
    if oldest and oldest[2] then
      oldestScore = tonumber(oldest[2])
    end

    return { currentHits, oldestScore + window }
  `
});

// ─── 1. Global fallback — catch-all for unlisted endpoints ──────────────────
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 100,                  // max 100 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  ...optionalStore('rl:global:'),
  passOnStoreError: true,
  message: {
    error: 'too_many_requests',
    message: 'طلبات كثيرة جداً',
    retryAfter: 60,
  },
});

// ─── 6. Health endpoint — prevent abuse of health checks ────────────────
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  ...optionalStore('rl:health:'),
  passOnStoreError: true,
  message: { error: 'Too many health check requests' },
});

// ─── 2. Proxy endpoint — limit image proxy requests ────────────────────
export const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  ...optionalStore('rl:proxy:'),
  passOnStoreError: true,
  message: { error: 'Too many proxy requests' },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
});

// ─── 7. Guest chat — IP-based limit to prevent cookie-reset abuse ─────────
// Caps a single IP to 12 guest chat requests per hour. This closes the
// "delete cookie → reset per-cookie counter" hole: even if a client keeps
// generating new guest IDs, the IP-based limit still applies.
export const guestIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  ...optionalStore('rl:guest-ip:'),
  passOnStoreError: true,
  message: {
    error: 'too_many_requests',
    message: 'Too many guest requests. Please try again later.',
    retryAfter: 3600,
  },
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
});

// ─── 8. Guest status — lightweight limiter for GET /api/guest/status ──────
// The status endpoint is read-only and non-sensitive. A generous limit
// prevents polling abuse while allowing the frontend to poll quota state
// without hitting rate limits.
export const guestStatusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 60,              // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  ...optionalStore('rl:guest-status:'),
  passOnStoreError: true,
  message: {
    error: 'too_many_requests',
    message: 'Too many requests. Please try again later.',
    retryAfter: 60,
  },
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
});
