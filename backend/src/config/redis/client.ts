import Redis from 'ioredis';
import MockRedis from './mock.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('redis');
const useRealRedis = process.env.USE_REAL_REDIS === 'true';

if (process.env.NODE_ENV === 'production' && !useRealRedis) {
  throw new Error('USE_REAL_REDIS must be set to "true" in production');
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
