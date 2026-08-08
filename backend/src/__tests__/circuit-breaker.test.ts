import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerState } from '../services/chat/model-router.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 1000); // 3 failures, 1s reset
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should allow execution when CLOSED', () => {
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('Failure Handling', () => {
    it('should stay CLOSED after less than threshold failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition to OPEN after threshold failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should reject execution when OPEN', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.canExecute()).toBe(false);
    });
  });

  describe('Recovery', () => {
    it('should transition to HALF_OPEN after reset timeout', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // canExecute() should transition to HALF_OPEN and return true
      expect(breaker.canExecute()).toBe(true);
    });

    it('should transition to CLOSED on successful probe', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition back to OPEN on failed probe', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Success Handling', () => {
    it('should reset failure count on success', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();
      
      // Should be able to handle 3 more failures before opening
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });
});
