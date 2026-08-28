/**
 * Auth Provider Interfaces
 * واجهات مزوّد المصادقة
 *
 * These interfaces abstract the auth infrastructure so the middleware
 * can work with any provider (Supabase, Firebase, custom, etc.).
 *
 * Usage:
 *   import { authMiddleware } from './auth.middleware.js';
 *   import { createSupabaseAuthProvider } from './providers/supabase-auth.provider.js';
 *   import { createRedisCacheProvider } from './providers/redis-cache.provider.js';
 *
 *   const auth = authMiddleware({
 *     authProvider: createSupabaseAuthProvider(),
 *     cacheProvider: createRedisCacheProvider(),
 *   });
 *   app.use('/api', auth);
 */

// ==========================================
// Core Types
// ==========================================

/** Authenticated user shape — kept minimal for security. */
export interface AuthUser {
  id: string;
  email: string;
}

/** User with ban information (internal use only). */
export interface AuthUserWithBan extends AuthUser {
  banned_until?: string | null;
}

/** Cached session stored in L2 (Redis) or L1 (in-memory). */
export interface CachedSession {
  user: AuthUserWithBan;
  isBanned: boolean;
  bannedUntil: string | null;
  cachedAt: number;
}

/** Ban record from the banned_users table. */
export interface BanRecord {
  expires_at: string | null;
}

// ==========================================
// Auth Provider Interface
// ==========================================

/**
 * IAuthProvider — abstracts the authentication backend.
 *
 * Implement this interface to support a different auth system
 * (e.g., Firebase Auth, Auth0, custom JWT verification).
 */
export interface IAuthProvider {
  /**
   * Verify a JWT token and return the user.
   * Throws if the token is invalid or expired.
   */
  verifyToken(token: string): Promise<AuthUserWithBan>;

  /**
   * Check if a user is banned from the banned_users table.
   * Returns null if no active ban found, otherwise the ban record.
   */
  checkBanStatus(userId: string): Promise<BanRecord | null>;
}

// ==========================================
// Cache Provider Interface
// ==========================================

/**
 * ICacheProvider — abstracts the session cache (L2).
 *
 * Implement this interface to use a different cache backend
 * (e.g., Memcached, DynamoDB, in-memory for testing).
 */
export interface ICacheProvider {
  /** Get a cached value by key. Returns null if not found or expired. */
  get(key: string): Promise<string | null>;

  /** Set a cached value with TTL in seconds. Returns true on success. */
  set(key: string, value: string, ttlSeconds: number): Promise<boolean>;

  /** Delete a cached value by key. Returns true if the key existed. */
  del(key: string): Promise<boolean>;
}

// ==========================================
// Middleware Configuration
// ==========================================

/**
 * Configuration for the auth middleware.
 * All providers are required — the middleware will not start without them.
 */
export interface AuthMiddlewareConfig {
  /** Authentication provider (Supabase, Firebase, etc.) */
  authProvider: IAuthProvider;

  /** Cache provider (Redis, Memcached, etc.) */
  cacheProvider: ICacheProvider;

  /** L1 in-memory cache TTL in milliseconds (default: 30000) */
  l1CacheTtlMs?: number;

  /** L1 in-memory cache max entries (default: 1000) */
  l1CacheMaxSize?: number;

  /** Circuit breaker: failures before opening (default: 5) */
  circuitBreakerThreshold?: number;

  /** Circuit breaker: window in ms to count failures (default: 60000) */
  circuitBreakerWindowMs?: number;

  /** Circuit breaker: cooldown in ms after opening (default: 30000) */
  circuitBreakerCooldownMs?: number;
}
