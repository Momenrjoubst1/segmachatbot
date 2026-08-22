import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { asyncHandler } from '../utils/express-async-wrapper.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq() {
  return { body: {}, params: {}, query: {} } as unknown as Request;
}

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

function mockNext() {
  return vi.fn() as unknown as NextFunction;
}

describe('asyncHandler', () => {
  it('calls the handler function with req, res, next', async () => {
    const handler = vi.fn(async (_req, _res, _next) => {});
    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
  });

  it('does not call next on successful execution', async () => {
    const handler = vi.fn(async (_req, res, _next) => {
      (res as any).json({ ok: true });
    });
    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with error when handler rejects', async () => {
    const error = new Error('handler failed');
    const handler = vi.fn(async () => {
      throw error;
    });
    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('calls next with error when async handler throws synchronously', async () => {
    const error = new Error('sync throw');
    const handler = vi.fn(async () => {
      throw error;
    });
    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('returns a function with correct signature', () => {
    const handler = asyncHandler(async () => {});
    expect(typeof handler).toBe('function');
    expect(handler.length).toBe(3); // req, res, next
  });

  it('handles handler that returns a rejected promise', async () => {
    const error = new Error('promise rejection');
    const handler = vi.fn(() => Promise.reject(error));
    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not swallow errors silently', async () => {
    const error = new Error('silent test');
    const handler = vi.fn(async () => {
      throw error;
    });
    const wrapped = asyncHandler(handler);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    consoleSpy.mockRestore();
  });
});
