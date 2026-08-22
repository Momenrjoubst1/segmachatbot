import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabase } from '../services/supabase.service.js';
import { createLogger } from '../utils/logger.js';
import redis from '../config/redis/client.js';

interface CachedUser {
  id: string;
  email: string;
  role: 'authenticated';
}

const logger = createLogger('auth-middleware');

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const redisFailures: number[] = [];
let circuitOpenUntil = 0;

// L1 in-memory cache for hot tokens (avoids Redis round-trip)
const L1_CACHE_TTL_MS = 30_000; // 30 seconds
const L1_CACHE_MAX_SIZE = 1000;
const l1Cache = new Map<string, { user: CachedUser; isBanned: boolean; bannedUntil: string | null; expiry: number }>();

function getFromL1Cache(key: string): { user: CachedUser; isBanned: boolean; bannedUntil: string | null; expiry: number } | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    l1Cache.delete(key);
    return null;
  }
  return entry;
}

function setL1Cache(key: string, value: { user: CachedUser; isBanned: boolean; bannedUntil: string | null }): void {
  if (l1Cache.size >= L1_CACHE_MAX_SIZE) {
    const firstKey = l1Cache.keys().next().value;
    if (firstKey) l1Cache.delete(firstKey);
  }
  l1Cache.set(key, { ...value, expiry: Date.now() + L1_CACHE_TTL_MS });
}

function recordRedisFailure(): void {
  const now = Date.now();
  redisFailures.push(now);
  while (redisFailures.length > 0 && redisFailures[0] < now - CIRCUIT_BREAKER_WINDOW_MS) {
    redisFailures.shift();
  }
  if (redisFailures.length >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
    logger.warn('Redis circuit breaker opened', {
      failures: redisFailures.length,
      cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
    });
  }
}

function recordRedisSuccess(): void {
  // Clear failures on success to prevent memory leak
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

/**
 * Seconds remaining until the JWT's `exp` (Infinity when undecodable —
 * callers fall back to the default TTL in that case).
 */
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

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      email: string;
    };
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Auth Middleware — Full Supabase JWT Verification
 *
 * Validates the Bearer token against Supabase Auth (via service role key).
 * Rejects requests with missing, invalid, or expired tokens.
 * Checks if the user is banned (Auth metadata or banned_users.expires_at).
 * Attaches req.user = { id, email } on success.
 * ════════════════════════════════════════════════════════════════════════════════
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Valid Bearer token required',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({
      error: 'Valid Bearer token required',
    });
    return;
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const cacheKey = `auth:session:${tokenHash}`;

    // L1 cache check first (no network round-trip)
    const l1Cached = getFromL1Cache(cacheKey);
    if (l1Cached) {
      logger.debug('L1 cache hit for auth session');
      const user = l1Cached.user;
      const isBanned = l1Cached.isBanned;
      const bannedUntil = l1Cached.bannedUntil;
      // Attach to request and continue
      if (isBanned) {
        logger.warn('Banned user attempted access (L1 cache)', { userId: user.id, bannedUntil });
        res.status(403).json({ error: 'Account suspended' });
        return;
      }
      // Re-verify ban status periodically (every 30s) even from L1 cache
      // to catch bans applied during the L1 TTL window
      if (l1Cached.expiry - L1_CACHE_TTL_MS + 15_000 < Date.now()) {
        // Background ban check — don't block the request, just invalidate cache if banned
        Promise.resolve(
          supabase
            .from('banned_users')
            .select('expires_at')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .limit(10)
        ).then(({ data: banRows }) => {
            const activeBan = (banRows ?? []).find((row) => {
              if (!row.expires_at) return true;
              return new Date(row.expires_at) > new Date();
            });
            if (activeBan) {
              l1Cache.delete(cacheKey);
              redis.del(cacheKey).catch(() => {});
              logger.warn('Background ban check found active ban, invalidating L1 cache', { userId: user.id });
            }
          })
          .catch(() => {}); // non-fatal
      }
      req.user = { id: user.id, email: user.email };
      return next();
    }

    let cachedSessionStr: string | null = null;
    if (!isCircuitOpen()) {
      cachedSessionStr = await redis.get(cacheKey).catch((err: unknown) => {
        recordRedisFailure();
        logger.warn('Redis cache read failed, falling back to Supabase', {
          err,
          cacheKey,
        });
        return null;
      });
      if (cachedSessionStr !== null) {
        recordRedisSuccess();
      }
    }

    let user: { id: string; email: string; banned_until?: string | null } | null = null;
    let isBanned = false;
    let bannedUntil = null;

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
          // Token expired, force Supabase re-verification
          cachedSessionStr = null;
          user = null;
        }

        // Re-verify ban status if cache is stale (>60s old)
        const cacheAge = cached.cachedAt ? Date.now() - cached.cachedAt : Infinity;
        if (cacheAge > 60_000) {
          const { data: banRows } = await supabase
            .from('banned_users')
            .select('expires_at')
            .eq('user_id', user!.id)
            .eq('is_active', true)
            .limit(10);

          const activeBan = (banRows ?? []).find((row) => {
            if (!row.expires_at) return true;
            return new Date(row.expires_at) > new Date();
          });

          if (activeBan) {
            isBanned = true;
            bannedUntil = activeBan.expires_at ?? null;
          }
        }
      } else {
        const delResult = await redis.del(cacheKey).catch((err: unknown) => {
          logger.warn('Redis cache delete failed during session cleanup', { err, cacheKey });
        });
        if (delResult === 1) {
          recordRedisSuccess();
        }
      }
    }

    if (!user) {
      const { data: authData, error } = await supabase.auth.getUser(token);

      if (error || !authData?.user) {
        // Secure Audit Logging: hash the token prefix to avoid PII leakage
        const tokenPrefix = crypto.createHash('sha256').update(token ?? '').digest('hex').slice(0, 16);
        logger.warn('Auth failed (Invalid token)', {
          ip: req.ip,
          userAgent: req.get('User-Agent')?.substring(0, 100),
          tokenPrefix,
          reason: error?.message || 'invalid_token',
          timestamp: new Date().toISOString(),
        });

        res.status(401).json({
          error: 'Invalid or expired token',
        });
        return;
      }

      user = {
        id: authData.user.id,
        email: authData.user.email ?? '',
        banned_until: authData.user.banned_until,
      };

      // Check both Auth metadata and banned_users rows in a single query
      const isAuthBanned = user.banned_until && new Date(user.banned_until) > new Date();

      // Single query to check banned_users table
      const { data: banRows } = await supabase
        .from('banned_users')
        .select('expires_at')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(10);

      const activeBan = (banRows ?? []).find((row) => {
        if (!row.expires_at) {
          return true;
        }
        return new Date(row.expires_at) > new Date();
      });

      isBanned = isAuthBanned || !!activeBan;
      bannedUntil = isAuthBanned ? user.banned_until : activeBan?.expires_at ?? null;

      // Cache validation result in Redis — but never longer than the token's
      // own remaining lifetime, so an expired token's session can never be
      // served from cache past its real expiry.
      const cacheTtl = Math.min(300, getTokenRemainingSeconds(token) - 30);
      if (cacheTtl > 0) {
        const setResult = await redis.set(
          cacheKey,
          JSON.stringify({ user, isBanned, bannedUntil, cachedAt: Date.now() }),
          'EX',
          Math.ceil(cacheTtl)
        ).catch((err: unknown) => logger.error('Redis cache set error', { err }));
        if (setResult === 'OK') {
          recordRedisSuccess();
          // Populate L1 cache for fast subsequent lookups
          setL1Cache(cacheKey, { user: { ...user, role: 'authenticated' as const }, isBanned, bannedUntil });
        }
      }
    }

    if (!user) {
      res.status(401).json({ error: 'No user found' });
      return;
    }

    if (isBanned) {
      logger.warn('Banned user attempted access', { userId: user.id, bannedUntil });
      // Immediately invalidate cached session so ban is enforced instantly
      await redis.del(cacheKey).catch((err: unknown) => logger.error('Redis cache delete error', { err }));
      // Also invalidate L1 cache
      l1Cache.delete(cacheKey);
      res.status(403).json({
        error: 'Account suspended',
      });
      return;
    }

    // Attach authenticated user to request
    req.user = {
      id: user.id,
      email: user.email ?? '',
    };

    next();
  } catch (err) {
    logger.error('Auth middleware error', { err });
    res.status(401).json({ error: 'Authentication failed' });
  }
}
