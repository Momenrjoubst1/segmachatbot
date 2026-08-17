/**
 * Timeout Wrapper Utility
 * أداة تغليف المهلة الزمنية
 * 
 * Provides consistent timeout handling for async operations
 * with proper error handling and logging
 */

import { createLogger } from './logger.js';

const log = createLogger('timeout-wrapper');

export interface TimeoutOptions {
  timeoutMs: number;
  operationName: string;
  onTimeout?: () => void;
  errorMessage?: string;
}

/**
 * Wraps an async operation with a timeout
 * Throws an error if the operation doesn't complete within the specified time
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, operationName, onTimeout, errorMessage } = options;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error(
        errorMessage || `Operation "${operationName}" timed out after ${timeoutMs}ms`
      );
      (error as any).code = 'TIMEOUT';
      (error as any).operationName = operationName;
      
      log.error(`Operation timeout: ${operationName}`, { timeoutMs });
      
      if (onTimeout) {
        try {
          onTimeout();
        } catch (cleanupError) {
          log.error(`Error in timeout cleanup for ${operationName}`, { error: cleanupError });
        }
      }
      
      reject(error);
    }, timeoutMs);
    
    // Don't keep the timeout reference alive if the operation completes
    timeout.unref?.();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } catch (error) {
    // Re-throw timeout errors
    if ((error as any)?.code === 'TIMEOUT') {
      throw error;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Wraps an operation with a timeout but returns a fallback value on timeout
 * instead of throwing an error
 */
export async function withTimeoutFallback<T>(
  operation: Promise<T>,
  fallback: T,
  options: TimeoutOptions
): Promise<T> {
  try {
    return await withTimeout(operation, options);
  } catch (error) {
    if ((error as any)?.code === 'TIMEOUT') {
      log.warn(`Operation timed out, using fallback: ${options.operationName}`, { fallback });
      return fallback;
    }
    throw error;
  }
}

/**
 * Creates a timeout wrapper with default settings for common operations
 */
export function createTimeoutWrapper(defaultTimeoutMs: number) {
  return <T>(
    operation: Promise<T>,
    operationName: string,
    customTimeout?: number
  ) => withTimeout(operation, {
    timeoutMs: customTimeout ?? defaultTimeoutMs,
    operationName,
  });
}

// Common timeout configurations
export const TIMEOUTS = {
  // AI operations
  LLM_RESPONSE: 120_000,      // 2 minutes for LLM response
  EMBEDDING: 60_000,          // 60 seconds for embedding generation
  MODERATION: 15_000,         // 15 seconds for content moderation
  
  // Database operations
  DB_QUERY: 10_000,           // 10 seconds for database queries
  DB_WRITE: 15_000,           // 15 seconds for database writes
  
  // External API calls
  EXTERNAL_API: 30_000,       // 30 seconds for external APIs
  WEB_SEARCH: 15_000,         // 15 seconds for web search
  
  // Memory operations
  MEMORY_RETRIEVAL: 8_000,    // 8 seconds for memory retrieval
  MEMORY_EXTRACTION: 10_000,  // 10 seconds for memory extraction
  
  // RAG operations
  RAG_RETRIEVAL: 30_000,      // 30 seconds for RAG retrieval
  RAG_RERANKING: 10_000,      // 10 seconds for document reranking
  
  // Pipeline steps
  PIPELINE_STEP: 10_000,     // 10 seconds for individual pipeline steps
  VALIDATION: 2_000,        // 2 seconds for input validation
  INTENT_DETECTION: 3_000,   // 3 seconds for intent detection
} as const;

/**
 * Circuit breaker pattern for operations that repeatedly timeout
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private cooldownMs: number = 60_000,
    private operationName: string = 'operation'
  ) {}
  
  async execute<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure < this.cooldownMs) {
        throw new Error(`Circuit breaker open for ${this.operationName}. Try again later.`);
      } else {
        // Transition to half-open
        this.state = 'half-open';
        log.info(`Circuit breaker half-open for ${this.operationName}`);
      }
    }
    
    try {
      const result = await withTimeout(operation(), {
        timeoutMs,
        operationName: this.operationName,
      });
      
      // Success - reset circuit if in half-open state
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
        log.info(`Circuit breaker closed for ${this.operationName}`);
      }
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'open';
        log.error(`Circuit breaker opened for ${this.operationName}`, { 
          failures: this.failures,
          threshold: this.threshold 
        });
      }
      
      throw error;
    }
  }
  
  getState(): { state: string; failures: number; lastFailureTime: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
  
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
    log.info(`Circuit breaker reset for ${this.operationName}`);
  }
}