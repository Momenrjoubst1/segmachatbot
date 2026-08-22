import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('express-rate-limit', () => {
  const fn = Object.assign(
    (...args: any[]) => {
      fn._lastCall = args;
      fn._calls.push(args);
      return (_req: any, _res: any, next: any) => next();
    },
    {
      ipKeyGenerator: (ip: string) => ip,
      _calls: [] as any[][],
      _lastCall: null as any,
    }
  );
  return { default: fn, ipKeyGenerator: fn.ipKeyGenerator };
});

vi.mock('../config/redis/client.js', () => ({
  default: {
    defineCommand: vi.fn(),
    del: vi.fn(),
    slidingWindowRateLimit: vi.fn(),
  },
}));

import rateLimit from 'express-rate-limit';
import {
  globalLimiter,
  healthLimiter,
  proxyLimiter,
  guestIpLimiter,
  guestStatusLimiter,
} from '../middleware/rate-limiters.js';

const mockRateLimit = vi.mocked(rateLimit);

describe('rate-limiters', () => {
  it('exports globalLimiter as a function (middleware)', () => {
    expect(typeof globalLimiter).toBe('function');
  });

  it('exports healthLimiter as a function (middleware)', () => {
    expect(typeof healthLimiter).toBe('function');
  });

  it('exports proxyLimiter as a function (middleware)', () => {
    expect(typeof proxyLimiter).toBe('function');
  });

  it('exports guestIpLimiter as a function (middleware)', () => {
    expect(typeof guestIpLimiter).toBe('function');
  });

  it('exports guestStatusLimiter as a function (middleware)', () => {
    expect(typeof guestStatusLimiter).toBe('function');
  });

  it('calls next() when globalLimiter is invoked as middleware', () => {
    const req = { ip: '127.0.0.1', user: undefined } as any;
    const res = {} as any;
    const next = vi.fn();

    globalLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when healthLimiter is invoked as middleware', () => {
    const req = { ip: '127.0.0.1' } as any;
    const res = {} as any;
    const next = vi.fn();

    healthLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when proxyLimiter is invoked as middleware', () => {
    const req = { ip: '127.0.0.1', user: undefined } as any;
    const res = {} as any;
    const next = vi.fn();

    proxyLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when guestIpLimiter is invoked as middleware', () => {
    const req = { ip: '127.0.0.1' } as any;
    const res = {} as any;
    const next = vi.fn();

    guestIpLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() when guestStatusLimiter is invoked as middleware', () => {
    const req = { ip: '127.0.0.1' } as any;
    const res = {} as any;
    const next = vi.fn();

    guestStatusLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rateLimit was called for each exported limiter', () => {
    expect(mockRateLimit._calls.length).toBeGreaterThanOrEqual(5);
  });

  it('all limiters use standardHeaders and disable legacyHeaders', () => {
    for (const call of mockRateLimit._calls) {
      expect(call[0]?.standardHeaders).toBe(true);
      expect(call[0]?.legacyHeaders).toBe(false);
      expect(call[0]?.passOnStoreError).toBe(true);
    }
  });

  it('globalLimiter uses 1-minute window with 100 max', () => {
    const config = mockRateLimit._calls.find(
      (call: any[]) => call[0]?.windowMs === 60_000 && call[0]?.max === 100
    );
    expect(config).toBeDefined();
  });

  it('healthLimiter uses 30 max per minute', () => {
    const config = mockRateLimit._calls.find(
      (call: any[]) => call[0]?.max === 30
    );
    expect(config).toBeDefined();
  });

  it('proxyLimiter uses 20 max per minute', () => {
    const config = mockRateLimit._calls.find(
      (call: any[]) => call[0]?.max === 20
    );
    expect(config).toBeDefined();
  });

  it('guestIpLimiter uses 1-hour window with 12 max', () => {
    const config = mockRateLimit._calls.find(
      (call: any[]) => call[0]?.windowMs === 3_600_000 && call[0]?.max === 12
    );
    expect(config).toBeDefined();
  });

  it('guestStatusLimiter uses 60 max per minute', () => {
    const config = mockRateLimit._calls.find(
      (call: any[]) => call[0]?.max === 60
    );
    expect(config).toBeDefined();
  });
});
