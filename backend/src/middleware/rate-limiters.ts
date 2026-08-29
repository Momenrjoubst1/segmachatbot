/**
 * Rate Limiters — Provider-Agnostic Implementation
 * محددات المعدل — تنفيذ مستقل عن المزوّدين
 *
 * This module defines all rate limiters using IRateLimitStore interface.
 * Stores can be swapped (Redis → Memory, Memcached, etc.) without changing
 * the limiters themselves.
 *
 * Architecture:
 *   IRateLimitStore (Redis or Memory) → express-rate-limit → Express middleware
 *
 * Usage:
 *   import { globalLimiter, guestIpLimiter } from './middleware/rate-limiters.js';
 *   app.use(globalLimiter);
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { IRateLimitStore } from './rate-limiting/rate-limit.types.js';
import { createRedisSlidingWindowStore } from './rate-limiting/sliding-window-redis.js';
import { createMemoryRateLimitStore } from './rate-limiting/memory-store.js';
import redis from '../config/redis/client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rate-limiter');

// ==========================================
// Store Initialization
// ==========================================

const useRedisStore = process.env.RATE_LIMIT_STORE === 'redis';

/**
 * Create a rate limit store based on environment configuration.
 * This is the only place that knows about Redis/Memory.
 */
function createStore(prefix: string): IRateLimitStore {
  if (useRedisStore) {
    log.debug(`Creating Redis store for prefix: ${prefix}`);
    return createRedisSlidingWindowStore({ client: redis, prefix });
  }
  log.debug(`Creating Memory store for prefix: ${prefix}`);
  return createMemoryRateLimitStore({ prefix });
}

// ==========================================
// Helper: create limiter with store
// ==========================================

interface LimiterConfig {
  windowMs: number;
  max: number;
  prefix: string;
  message: Record<string, unknown>;
  keyGenerator?: (req: { user?: { id?: string }; ip?: string }) => string;
}

function createLimiter(config: LimiterConfig) {
  const { windowMs, max, prefix, message, keyGenerator } = config;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(prefix),
    passOnStoreError: true,
    message,
    ...(keyGenerator ? { keyGenerator } : {}),
  });
}

// ==========================================
// Rate Limiters
// ==========================================

// Global limiter — catch-all for unlisted endpoints.
export const globalLimiter = createLimiter({
  windowMs: 60 * 1000,       // 1 minute window
  max: 100,                  // max 100 requests per IP per minute
  prefix: 'rl:global:',
  message: {
    error: 'too_many_requests',
    message: 'طلبات كثيرة جداً',
    retryAfter: 60,
  },
});

// Health endpoint limiter — prevents abuse of health checks.
export const healthLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  prefix: 'rl:health:',
  message: { error: 'Too many health check requests' },
});

// Proxy endpoint limiter — caps image proxy requests.
export const proxyLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  prefix: 'rl:proxy:',
  message: { error: 'Too many proxy requests' },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
});

// Guest chat limiter — IP-based cap closing the cookie-reset abuse hole.
export const guestIpLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 12,
  prefix: 'rl:guest-ip:',
  message: {
    error: 'too_many_requests',
    message: 'Too many guest requests. Please try again later.',
    retryAfter: 3600,
  },
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
});

// Guest status limiter — generous cap for the read-only /api/guest/status poll.
export const guestStatusLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute window
  max: 60,              // 60 requests per minute per IP
  prefix: 'rl:guest-status:',
  message: {
    error: 'too_many_requests',
    message: 'Too many requests. Please try again later.',
    retryAfter: 60,
  },
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
});

// Feedback limiter — per-user cap on message feedback ratings to stop spam.
export const feedbackLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute window
  max: 30,             // 30 requests per minute per user
  prefix: 'rl:feedback:',
  message: {
    error: 'too_many_requests',
    message: 'Too many feedback submissions. Please slow down.',
    retryAfter: 60,
  },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
});

// Upload limiter — protects R2 storage and bandwidth from attachment spam.
export const uploadLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 30,                  // 30 uploads per user per window
  prefix: 'rl:upload:',
  message: {
    error: 'too_many_requests',
    message: 'Too many file uploads. Please wait a few minutes and try again.',
    retryAfter: 15 * 60,
  },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
});

// Answer grading limiter — each grading call may hit an embedding provider and
// an auxiliary LLM, so cap per-user cost.
export const answerGradingLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 60,                  // 60 graded answers per user per hour
  prefix: 'rl:study-grade:',
  message: {
    error: 'too_many_requests',
    message: 'Too many answer grading requests. Please try again later.',
    retryAfter: 15 * 60,
  },
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || ''),
});

// ==========================================
// Exports for backward compatibility
// ==========================================

export type { IRateLimitStore } from './rate-limiting/rate-limit.types.js';
export { createRedisSlidingWindowStore } from './rate-limiting/sliding-window-redis.js';
export { createMemoryRateLimitStore } from './rate-limiting/memory-store.js';
