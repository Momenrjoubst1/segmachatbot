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

// Module augmentation: ioredis addCustomCommand returns `this` typed as Redis,
// but our sites call the custom commands via dot-access. Declaring them on
// the Redis interface lets us drop every `(redis as any).customCmd(...)` cast.
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

  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: tlsEnabled ? {} : undefined,
    enableOfflineQueue: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
    lazyConnect: false,
  });

  redis.on('connect', () => log.info('Redis connected'));
  redis.on('error', (err: Error) => log.error('Redis error: ' + err.message));
} else {
  redis = new MockRedis();
}

export default redis;
