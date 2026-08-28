// Email rate limiting: Redis-based with in-memory fallback.

import redis from "../../../config/redis/client.js";
import { logger } from "../../../utils/logger.js";

const EMAIL_RATE_LIMIT = 5;
const EMAIL_RATE_WINDOW = 60_000;

const rateLimitCache = new Map<string, { timestamps: number[]; lastUpdate: number }>();

export async function checkRedisRateLimit(userId: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  try {
    const key = `email:ratelimit:${userId}`;
    const now = Date.now();
    const windowStart = now - EMAIL_RATE_WINDOW;

    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    if (count >= EMAIL_RATE_LIMIT) {
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTime = oldest.length >= 2 ? parseInt(oldest[1]) : now;
      return { allowed: false, retryAfterMs: EMAIL_RATE_WINDOW - (now - oldestTime) };
    }

    await redis.zadd(key, now, now.toString());
    await redis.expire(key, Math.ceil(EMAIL_RATE_WINDOW / 1000));

    return { allowed: true };
  } catch (error) {
    logger.error('[Email] Redis rate limit error, falling back to in-memory cache', { error });
    return checkInMemoryRateLimit(userId);
  }
}

function checkInMemoryRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowStart = now - EMAIL_RATE_WINDOW;
  const cached = rateLimitCache.get(userId);

  if (!cached) {
    rateLimitCache.set(userId, { timestamps: [now], lastUpdate: now });
    return { allowed: true };
  }

  cached.timestamps = cached.timestamps.filter(t => t > windowStart);

  if (cached.timestamps.length >= EMAIL_RATE_LIMIT) {
    const oldest = Math.min(...cached.timestamps);
    return { allowed: false, retryAfterMs: EMAIL_RATE_WINDOW - (now - oldest) };
  }

  cached.timestamps.push(now);
  cached.lastUpdate = now;
  rateLimitCache.set(userId, cached);

  return { allowed: true };
}
