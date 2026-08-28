/**
 * Auth Middleware — Re-export from new location
 *
 * This file re-exports everything from the new auth module structure.
 * Existing imports from '../middleware/auth.middleware.js' will continue to work.
 *
 * For new code, prefer importing directly from '../middleware/auth/auth.middleware.js'.
 */

export { createAuthMiddleware, authMiddleware, initDefaultAuthMiddleware } from './auth/auth.middleware.js';
export type {
  AuthUser,
  AuthUserWithBan,
  CachedSession,
  BanRecord,
  IAuthProvider,
  ICacheProvider,
  AuthMiddlewareConfig,
} from './auth/auth.types.js';
export { createSupabaseAuthProvider } from './auth/providers/supabase-auth.provider.js';
export { createRedisCacheProvider, createMemoryCacheProvider } from './auth/providers/redis-cache.provider.js';
