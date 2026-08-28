import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerState, ModelRouter, getGracefulDegradationMessage } from '../services/chat/model-router.js';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../routes/chat/chat-shared.js', () => ({
  getProviderAndModel: vi.fn((modelId: string) => {
    if (modelId === 'deepseek-v4-flash') return { provider: 'baichat', modelName: modelId };
    if (modelId === 'gemini-3.7-flash') return { provider: 'google', modelName: modelId };
    if (modelId === 'glm-5.2') return { provider: 'bigmodel', modelName: modelId };
    if (modelId === 'gpt-5.4') return { provider: 'azure', modelName: modelId };
    if (modelId === 'gpt-4o') return { provider: 'openrouter', modelName: modelId };
    if (modelId === 'gpt-4o-mini') return { provider: 'github', modelName: modelId };
    return { provider: 'groq', modelName: modelId };
  }),
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(3, 1000); // 3 failures, 1s reset
  });

  describe('Initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should have 0 failure count', () => {
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should have no last failure time', () => {
      expect(breaker.getLastFailureTime()).toBeNull();
    });

    it('should allow execution when closed', () => {
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('Failure tracking', () => {
    it('should increment failure count on failure', () => {
      breaker.recordFailure();
      expect(breaker.getFailureCount()).toBe(1);
      expect(breaker.getLastFailureTime()).toBeDefined();
    });

    it('should transition to OPEN after threshold failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(breaker.canExecute()).toBe(false);
    });

    it('should block execution when OPEN', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.canExecute()).toBe(false);
    });
  });

  describe('Recovery (HALF_OPEN)', () => {
    it('should transition to HALF_OPEN after reset timeout', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should transition to CLOSED on successful probe', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      await new Promise(resolve => setTimeout(resolve, 1100));
      breaker.canExecute(); // Triggers HALF_OPEN

      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should transition back to OPEN on failed probe', async () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      await new Promise(resolve => setTimeout(resolve, 1100));
      breaker.canExecute(); // Triggers HALF_OPEN

      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Success recording', () => {
    it('should reset failure count on success', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getFailureCount()).toBe(2);

      breaker.recordSuccess();
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should reset to CLOSED on success from any state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

      // After timeout + canExecute → HALF_OPEN, then success → CLOSED
      breaker.recordSuccess();
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('Custom thresholds', () => {
    it('should respect custom failure threshold', () => {
      const customBreaker = new CircuitBreaker(5, 60000);
      for (let i = 0; i < 4; i++) {
        customBreaker.recordFailure();
      }
      expect(customBreaker.getState()).toBe(CircuitBreakerState.CLOSED);

      customBreaker.recordFailure();
      expect(customBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });
});

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('Fallback chain', () => {
    it('should return fallback chain for known models', () => {
      const chain = router.getFallbackChain('deepseek-v4-flash');
      expect(chain).toContain('gemini-3.7-flash');
      expect(chain).toContain('gpt-4o-mini');
      expect(chain).toContain('gemini-2.5-flash');
    });

    it('should always include gpt-4o-mini as last resort', () => {
      const chain = router.getFallbackChain('some-unknown-model');
      expect(chain).toContain('gpt-4o-mini');
    });

    it('should not duplicate gpt-4o-mini if already in chain', () => {
      // gpt-4o chain: ["gpt-4o-mini", "qwen/qwen3.6-27b"]
      const chain = router.getFallbackChain('gpt-4o');
      const occurrences = chain.filter(m => m === 'gpt-4o-mini');
      expect(occurrences.length).toBe(1);
    });
  });

  describe('Model selection', () => {
    it('should return requested model when circuit is closed', () => {
      const result = router.getAvailableModel('deepseek-v4-flash');
      expect(result.model).toBe('deepseek-v4-flash');
      expect(result.isFallback).toBe(false);
    });

    it('should fallback when primary model circuit opens', () => {
      // Trip the breaker for deepseek-v4-flash
      for (let i = 0; i < 3; i++) {
        router.reportFailure('deepseek-v4-flash');
      }

      const result = router.getAvailableModel('deepseek-v4-flash');
      expect(result.model).not.toBe('deepseek-v4-flash');
      expect(result.isFallback).toBe(true);
    });

    it('should force gpt-4o-mini when all fallbacks are open', () => {
      // Trip breakers for deepseek-v4-flash and every model in its fallback chain
      const modelsToTrip = [
        'deepseek-v4-flash',
        'gemini-3.7-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'nvidia/nemotron-3.5-lightning:free',
        'nvidia/nemotron-3-super-49b-a49b:free',
        'qwen/qwen3.6-27b',
        'glm-5.2',
        'gpt-4o-mini',
      ];
      for (const model of modelsToTrip) {
        for (let i = 0; i < 3; i++) {
          router.reportFailure(model);
        }
      }

      const result = router.getAvailableModel('deepseek-v4-flash');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.isFallback).toBe(true);
    });
  });

  describe('Health status', () => {
    it('should return empty health status initially', () => {
      const status = router.getHealthStatus();
      expect(Object.keys(status)).toHaveLength(0);
    });

    it('should track model health after failures', () => {
      router.reportFailure('gpt-4o');
      const status = router.getHealthStatus();
      expect(status['gpt-4o']).toBeDefined();
      expect(status['gpt-4o'].failures).toBe(1);
    });

    it('should reflect state changes in health status', () => {
      for (let i = 0; i < 3; i++) {
        router.reportFailure('gpt-4o');
      }
      const status = router.getHealthStatus();
      expect(status['gpt-4o'].state).toBe(CircuitBreakerState.OPEN);
    });
  });
});

describe('Graceful Degradation Message', () => {
  it('should generate Arabic message with model names', () => {
    const msg = getGracefulDegradationMessage('gpt-5.4', 'gpt-4o-mini');
    expect(msg).toContain('gpt-5.4');
    expect(msg).toContain('gpt-4o-mini');
  });

  it('should be in Arabic', () => {
    const msg = getGracefulDegradationMessage('gpt-5.4', 'gpt-4o-mini');
    // Check for Arabic characters
    expect(/[\u0600-\u06FF]/.test(msg)).toBe(true);
  });
});
