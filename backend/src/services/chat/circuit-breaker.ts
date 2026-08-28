/**
 * Circuit Breaker implementation
 * تنفيذ قاطع الدائرة
 */

import { createLogger } from "../../utils/logger.js";

const log = createLogger("circuit-breaker");

export enum CircuitBreakerState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;

  constructor(failureThreshold: number = 3, resetTimeout: number = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
  }

  canExecute(): boolean {
    if (this.state === CircuitBreakerState.CLOSED) {
      return true;
    }

    if (this.state === CircuitBreakerState.OPEN) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime.getTime() >= this.resetTimeout
      ) {
        this.state = CircuitBreakerState.HALF_OPEN;
        log.info("Circuit breaker transitioning OPEN → HALF_OPEN (reset timeout elapsed)");
        return true;
      }
      return false;
    }

    return true;
  }

  recordSuccess(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      log.info("Circuit breaker transitioning HALF_OPEN → CLOSED (probe succeeded)");
    }
    this.failureCount = 0;
    this.state = CircuitBreakerState.CLOSED;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      log.warn("Circuit breaker transitioning HALF_OPEN → OPEN (probe failed)");
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      log.warn(
        `Circuit breaker transitioning CLOSED → OPEN (${this.failureCount} consecutive failures, threshold=${this.failureThreshold})`,
      );
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  getLastFailureTime(): Date | null {
    return this.lastFailureTime;
  }
}
