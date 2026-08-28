/**
 * Auth Middleware — Provider-Agnostic Implementation
 * middleware المصادقة — تنفيذ مستقل عن المزوّدين
 *
 * This middleware verifies JWT tokens, rejects banned users, and attaches
 * req.user. It uses IAuthProvider and ICacheProvider interfaces, making
 * it easy to swap infrastructure (Supabase → Firebase, Redis → Memcached).
 *
 * Architecture:
 *   L1 (in-memory LRU) → L2 (ICacheProvider) → L3 (IAuthProvider)
 *
 * Usage:
 *   import { createAuthMiddleware } from './middleware/auth/auth.middleware.js';
 *   import { createSupabaseAuthProvider } from './middleware/auth/providers/supabase-auth.provider.js';
 *   import { createRedisCacheProvider } from './middleware/auth/providers/redis-cache.provider.js';
 *
 *   const auth = createAuthMiddleware({
 *     authProvider: createSupabaseAuthProvider(),
 *     cacheProvider: createRedisCacheProvider(),
 *   });
 *   app.use('/api', auth);
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';
import type { AuthMiddlewareConfig, IAuthProvider, ICacheProvider, AuthUserWithBan } from './auth.types.js';

const logger = createLogger('auth-middleware');

// ==========================================
// Defaults
// ==========================================

const DEFAULT_L1_CACHE_TTL_MS = 30_000;
const DEFAULT_L1_CACHE_MAX_SIZE = 1000;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
const DEFAULT_CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

// ==========================================
// Express Request augmentation
// ==========================================

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
    };
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create an auth middleware with injected dependencies.
 *
 * @param config - Providers and optional tuning parameters.
 * @returns Express middleware function.
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const {
    authProvider,
    cacheProvider,
    l1CacheTtlMs = DEFAULT_L1_CACHE_TTL_MS,
    l1CacheMaxSize = DEFAULT_L1_CACHE_MAX_SIZE,
    circuitBreakerThreshold = DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
    circuitBreakerWindowMs = DEFAULT_CIRCUIT_BREAKER_WINDOW_MS,
    circuitBreakerCooldownMs = DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS,
  } = config;

  // ==========================================
  // L1 in-memory LRU cache
  // ==========================================

  type L1Entry = { user: AuthUserWithBan; isBanned: boolean; bannedUntil: string | null; expiry: number };
  const l1Cache = new Map<string, L1Entry>();

  function getFromL1(key: string): L1Entry | null {
    const entry = l1Cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      l1Cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    l1Cache.delete(key);
    l1Cache.set(key, entry);
    return entry;
  }

  function setL1(key: string, value: Omit<L1Entry, 'expiry'>): void {
    l1Cache.delete(key);
    if (l1Cache.size >= l1CacheMaxSize) {
      const lruKey = l1Cache.keys().next().value;
      if (lruKey) l1Cache.delete(lruKey);
    }
    l1Cache.set(key, { ...value, expiry: Date.now() + l1CacheTtlMs });
  }

  // ==========================================
  // Circuit Breaker
  // ==========================================

  const redisFailures: number[] = [];
  let circuitOpenUntil = 0;

  function recordRedisFailure(): void {
    const now = Date.now();
    redisFailures.push(now);
    while (redisFailures.length > 0 && redisFailures[0] < now - circuitBreakerWindowMs) {
      redisFailures.shift();
    }
    if (redisFailures.length >= circuitBreakerThreshold) {
      circuitOpenUntil = now + circuitBreakerCooldownMs;
      logger.warn('Redis circuit breaker opened', {
        failures: redisFailures.length,
        cooldownMs: circuitBreakerCooldownMs,
      });
    }
  }

  function recordRedisSuccess(): void {
    if (redisFailures.length > 0) {
      redisFailures.length = 0;
    }
  }

  function isCircuitOpen(): boolean {
    if (Date.now() < circuitOpenUntil) return true;
    if (circuitOpenUntil > 0) {
      circuitOpenUntil = 0;
      logger.info('Redis circuit breaker closed, retrying Redis');
    }
    return false;
  }

  // ==========================================
  // Helpers
  // ==========================================

  function getTokenRemainingSeconds(token: string | undefined): number {
    try {
      if (!token) return Number.POSITIVE_INFINITY;
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf-8')
      ) as { exp?: number };
      if (typeof payload.exp !== 'number') return Number.POSITIVE_INFINITY;
      return payload.exp - Math.floor(Date.now() / 1000);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function isBanActive(ban: { expires_at: string | null } | null): boolean {
    if (!ban) return false;
    if (!ban.expires_at) return true;
    return new Date(ban.expires_at) > new Date();
  }

  // ==========================================
  // Middleware
  // ==========================================

  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Valid Bearer token required' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'Valid Bearer token required' });
      return;
    }

    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const cacheKey = `auth:session:${tokenHash}`;

      // ---- L1 cache check ----
      const l1Cached = getFromL1(cacheKey);
      if (l1Cached) {
        logger.debug('L1 cache hit for auth session');
        const { user, isBanned, bannedUntil } = l1Cached;

        if (isBanned) {
          logger.warn('Banned user attempted access (L1 cache)', { userId: user.id, bannedUntil });
          res.status(403).json({ error: 'Account suspended' });
          return;
        }

        // Background ban recheck at mid-TTL
        if (l1Cached.expiry - l1CacheTtlMs + 15_000 < Date.now()) {
          authProvider.checkBanStatus(user.id).then((ban) => {
            if (isBanActive(ban)) {
              l1Cache.delete(cacheKey);
              cacheProvider.del(cacheKey).catch(() => {});
              logger.warn('Background ban check found active ban, invalidating L1 cache', { userId: user.id });
            }
          }).catch(() => {}); // non-fatal
        }

        req.user = { id: user.id, email: user.email };
        return next();
      }

      // ---- L2 cache check (Redis, etc.) ----
      let cachedSessionStr: string | null = null;
      if (!isCircuitOpen()) {
        cachedSessionStr = await cacheProvider.get(cacheKey).catch((err: unknown) => {
          recordRedisFailure();
          logger.warn('Cache read failed, falling back to auth provider', { err, cacheKey });
          return null;
        });
        if (cachedSessionStr !== null) {
          recordRedisSuccess();
        }
      }

      let user: AuthUserWithBan | null = null;
      let isBanned = false;
      let bannedUntil: string | null = null;

      if (cachedSessionStr) {
        const cached = JSON.parse(cachedSessionStr);
        if (
          cached &&
          typeof cached === 'object' &&
          cached.user &&
          typeof cached.user === 'object' &&
          typeof cached.user.id === 'string' &&
          typeof cached.user.email === 'string' &&
          cached.user.id.length > 0 &&
          cached.user.email.length > 0
        ) {
          user = cached.user;
          isBanned = cached.isBanned;
          bannedUntil = cached.bannedUntil;

          // Verify token expiry even when using cached session
          const tokenPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          if (tokenPayload.exp && tokenPayload.exp < Date.now() / 1000) {
            cachedSessionStr = null;
            user = null;
          }

          // Re-verify ban status if cache is stale (>60s old)
          const cacheAge = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;
          if (cacheAge > 60_000 && user) {
            const ban = await authProvider.checkBanStatus(user.id);
            if (isBanActive(ban)) {
              isBanned = true;
              bannedUntil = ban!.expires_at ?? null;
            }
          }
        } else {
          const deleted = await cacheProvider.del(cacheKey).catch((err: unknown) => {
            logger.warn('Cache delete failed during session cleanup', { err, cacheKey });
            return false;
          });
          if (deleted) {
            recordRedisSuccess();
          }
        }
      }

      // ---- L3: Auth provider verification ----
      if (!user) {
        try {
          user = await authProvider.verifyToken(token);
        } catch (err) {
          const tokenPrefix = crypto.createHash('sha256').update(token ?? '').digest('hex').slice(0, 16);
          logger.warn('Auth failed (Invalid token)', {
            ip: req.ip,
            userAgent: req.get('User-Agent')?.substring(0, 100),
            tokenPrefix,
            reason: (err as Error).message || 'invalid_token',
            timestamp: new Date().toISOString(),
          });
          res.status(401).json({ error: 'Invalid or expired token' });
          return;
        }

        // Check ban status
        const ban = await authProvider.checkBanStatus(user.id);
        const isAuthBanned = !!(user.banned_until && new Date(user.banned_until) > new Date());
        isBanned = isAuthBanned || isBanActive(ban);
        bannedUntil = isAuthBanned ? (user.banned_until ?? null) : (ban?.expires_at ?? null);

        // Cache the session
        const cacheTtl = Math.min(300, getTokenRemainingSeconds(token) - 30);
        if (cacheTtl > 0) {
          const setResult = await cacheProvider.set(
            cacheKey,
            JSON.stringify({ user, isBanned, bannedUntil, cachedAt: Date.now() }),
            Math.ceil(cacheTtl),
          ).catch((err: unknown) => logger.error('Cache set error', { err }));
          if (setResult) {
            recordRedisSuccess();
            setL1(cacheKey, { user, isBanned, bannedUntil });
          }
        }
      }

      if (!user) {
        res.status(401).json({ error: 'No user found' });
        return;
      }

      if (isBanned) {
        logger.warn('Banned user attempted access', { userId: user.id, bannedUntil });
        await cacheProvider.del(cacheKey).catch((err: unknown) => logger.error('Cache delete error', { err }));
        l1Cache.delete(cacheKey);
        res.status(403).json({ error: 'Account suspended' });
        return;
      }

      req.user = { id: user.id, email: user.email ?? '' };
      next();
    } catch (err) {
      logger.error('Auth middleware error', { err });
      res.status(401).json({ error: 'Authentication failed' });
    }
  };
}

// ==========================================
// Default export (backward compatibility)
// ==========================================

/**
 * Default auth middleware instance using Supabase + Redis.
 *
 * For backward compatibility — existing code that imports
 * `authMiddleware` from this file will continue to work.
 *
 * For new code, prefer createAuthMiddleware() with explicit providers.
 */
let _defaultMiddleware: ReturnType<typeof createAuthMiddleware> | null = null;

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!_defaultMiddleware) {
    // Lazy-load providers to avoid circular dependencies at import time.
    // We use ESM dynamic import() here.
    throw new Error(
      'Default auth middleware not initialized. ' +
      'Import and call createAuthMiddleware() explicitly, or ensure providers are loaded.'
    );
  }
  return _defaultMiddleware(req, res, next);
}

/**
 * Initialize the default auth middleware with Supabase + Redis providers.
 * Call this once at startup before using authMiddleware.
 */
export async function initDefaultAuthMiddleware(): Promise<void> {
  if (_defaultMiddleware) return;

  const { createSupabaseAuthProvider } = await import('./providers/supabase-auth.provider.js');
  const { createRedisCacheProvider } = await import('./providers/redis-cache.provider.js');

  _defaultMiddleware = createAuthMiddleware({
    authProvider: createSupabaseAuthProvider(),
    cacheProvider: createRedisCacheProvider(),
  });
}
