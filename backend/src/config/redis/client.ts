import Redis from 'ioredis';
import MockRedis from './mock.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('redis');
// Keep the Redis client and rate-limit stores on one deployment switch. This
// prevents a configuration where guest quotas select Redis while the client
// silently remains the in-memory mock.
const useRealRedis = process.env.RATE_LIMIT_STORE === 'redis';

if (process.env.NODE_ENV === 'production' && !useRealRedis) {
  throw new Error('RATE_LIMIT_STORE must be set to "redis" in production');
}

// Declare custom commands on the ioredis interface so call sites need no casts.
declare module 'ioredis' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface RedisCommander<Context> {
    /** Sliding-window log via ZSET + Lua. Returns [hits, oldestExpiryMs]. */
    slidingWindowRateLimit(
      key: string,
      nowMs: number,
      windowMs: number,
      member: string,
    ): Promise<[number, number]>;
    /** Fixed-window counter for guest chat quota. Returns [count, ttlSeconds]. */
    guestFixedWindowIncr(
      key: string,
      windowSeconds: number,
    ): Promise<[number, number]>;
    /** Append a single JSON line to a transcript list, bounded by MAX_LENGTH. */
    guestAppendTranscript(
      key: string,
      entryJson: string,
      maxLength: number,
      maxChars: number,
    ): Promise<number>;
  }
}

let redis: Redis | MockRedis;

if (useRealRedis) {
  const tlsEnabled = process.env.REDIS_TLS === 'true';

  const commonOptions = {
    password: process.env.REDIS_PASSWORD || undefined,
    tls: tlsEnabled ? {} : undefined,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
    lazyConnect: false,
  };

  // REDIS_URL is the canonical wiring — CI's redis service (mapped to a
  // non-default host port) and hosted Redis both expose one. Host/port envs
  // remain as the fallback. Ignoring REDIS_URL here used to point the client
  // at localhost:6379 regardless, so every command failed and rate limiting
  // silently degraded to the in-memory fallback.
  redis = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, commonOptions)
    : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        ...commonOptions,
      });

  redis.on('connect', () => log.info('Redis connected'));
  redis.on('error', (err: Error) => log.error('Redis error: ' + err.message));

  // The rate-limit store (sliding-window-redis.ts) calls this command on every
  // increment. It was previously declared in TypeScript only — without this
  // registration the real client threw on every call and rate limiting
  // silently fell back to in-memory in production. Semantics mirror MockRedis.
  redis.defineCommand('slidingWindowRateLimit', {
    numberOfKeys: 1,
    lua: `
      local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
      redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      local hits = redis.call('ZCARD', KEYS[1])
      local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
      local oldestScore = tonumber(oldest[2]) or tonumber(ARGV[1])
      return { hits, oldestScore + tonumber(ARGV[2]) }
    `,
  });
} else {
  redis = new MockRedis();
}

export default redis;
