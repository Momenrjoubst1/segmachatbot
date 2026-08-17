import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabase } from '../services/supabase.service.js';
import { createLogger } from '../utils/logger.js';
import redis from '../config/redis/client.js';

const logger = createLogger('auth-middleware');

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const redisFailures: number[] = [];
let circuitOpenUntil = 0;

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
        await redis.del(cacheKey).catch((err: unknown) => {
          logger.warn('Redis cache delete failed during session cleanup', { err, cacheKey });
        });
      }
    }

    if (!user) {
      const { data: authData, error } = await supabase.auth.getUser(token);

      if (error || !authData?.user) {
        // Secure Audit Logging: Never log the full token!
        const tokenPreview = token?.substring(0, 15) + '...';
        logger.warn('Auth failed (Invalid token)', {
          ip: req.ip,
          userAgent: req.get('User-Agent')?.substring(0, 100),
          tokenPreview,
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
        await redis.set(
          cacheKey,
          JSON.stringify({ user, isBanned, bannedUntil, cachedAt: Date.now() }),
          'EX',
          Math.ceil(cacheTtl)
        ).catch((err: unknown) => logger.error('Redis cache set error', { err }));
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
