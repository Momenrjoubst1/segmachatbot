// Timeout wrapper tests for withTimeout and withTimeoutFallback helpers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, withTimeoutFallback } from '../utils/timeout-wrapper.js';

describe('Timeout Wrapper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('withTimeout', () => {
    it('should resolve when operation completes before timeout', async () => {
      const operation = Promise.resolve('success');
      const result = await withTimeout(operation, {
        timeoutMs: 1000,
        operationName: 'test-operation',
      });
      expect(result).toBe('success');
    });

    it('should timeout when operation takes too long', async () => {
      const operation = new Promise(resolve => setTimeout(() => resolve('slow'), 200));
      await expect(withTimeout(operation, {
        timeoutMs: 50,
        operationName: 'test-operation',
      })).rejects.toThrow('timed out');
    });

    it('should propagate non-timeout errors', async () => {
      const operation = Promise.reject(new Error('Operation failed'));
      await expect(withTimeout(operation, {
        timeoutMs: 1000,
        operationName: 'test-operation',
      })).rejects.toThrow('Operation failed');
    });
  });

  describe('withTimeoutFallback', () => {
    it('should return fallback on timeout', async () => {
      const operation = new Promise(resolve => setTimeout(() => resolve('slow'), 200));
      const fallback = 'fallback';
      const result = await withTimeoutFallback(operation, fallback, {
        timeoutMs: 50,
        operationName: 'test-operation',
      });
      expect(result).toBe('fallback');
    });

    it('should not use fallback for non-timeout errors', async () => {
      const operation = Promise.reject(new Error('Operation failed'));
      const fallback = 'fallback';
      await expect(withTimeoutFallback(operation, fallback, {
        timeoutMs: 1000,
        operationName: 'test-operation',
      })).rejects.toThrow('Operation failed');
    });
  });
});