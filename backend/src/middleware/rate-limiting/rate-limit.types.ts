/**
 * Rate Limiting Types
 * أنماط تقييد المعدل
 *
 * Interfaces for rate limit store abstraction.
 * Allows swapping Redis for in-memory, Memcached, or any other store.
 */

import type { Store, Options, ClientRateLimitInfo } from 'express-rate-limit';

// ==========================================
// Store Provider Interface
// ==========================================

/**
 * IRateLimitStore — abstracts the rate limit storage backend.
 *
 * Extends express-rate-limit's Store interface for compatibility.
 * Implement this interface to support different backends.
 */
export interface IRateLimitStore extends Store {
  /** Unique prefix for this store instance (used for key namespacing). */
  readonly prefix: string;

  /** Initialize the store with rate limit options. */
  init(options: Options): void;

  /** Increment the counter for a key. Returns current hit count and reset time. */
  increment(key: string): Promise<ClientRateLimitInfo>;

  /** Decrement the counter for a key (optional). */
  decrement(key: string): Promise<void>;

  /** Reset the counter for a key. */
  resetKey(key: string): Promise<void>;
}

// ==========================================
// Configuration
// ==========================================

/**
 * Configuration for rate limiters.
 */
export interface RateLimitConfig {
  /** Store provider (Redis, in-memory, etc.) */
  store?: IRateLimitStore;

  /** Whether to use Redis store (default: false) */
  useRedis?: boolean;
}

// ==========================================
// Store Factory Types
// ==========================================

/**
 * Redis client interface — minimal interface for the Redis client.
 * This avoids tight coupling to ioredis.
 */
export interface IRedisClient {
  /** Execute a custom Lua script. */
  slidingWindowRateLimit(
    key: string,
    now: number,
    windowMs: number,
    member: string,
  ): Promise<[number, number]>;

  /** Delete a key. */
  del(key: string): Promise<number>;
}

/**
 * Options for creating a Redis rate limit store.
 */
export interface RedisStoreOptions {
  /** Redis client instance. */
  client: IRedisClient;

  /** Key prefix for namespacing. */
  prefix: string;
}

/**
 * Options for creating an in-memory rate limit store.
 */
export interface MemoryStoreOptions {
  /** Key prefix for namespacing. */
  prefix: string;

  /** Maximum number of entries (default: 10000). */
  maxEntries?: number;
}
