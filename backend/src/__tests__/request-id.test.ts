import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestIdMiddleware } from '../middleware/request-id.js';

// Mock uuid
vi.mock('uuid', async () => {
  return {
    v4: vi.fn(() => '12345678-1234-1234-1234-123456789abc'),
  };
});

// Mock runWithTraceContext from logger
vi.mock('../utils/logger.js', async () => {
  return {
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
    runWithTraceContext: vi.fn((_ctx: any, fn: () => void) => fn()),
  };
});

describe('Request ID Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      setHeader: vi.fn(),
    };
    mockNext = vi.fn();
  });

  it('should generate a UUID when no x-request-id header is present', () => {
    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockReq.headers['x-request-id']).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', '12345678-1234-1234-1234-123456789abc');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should use existing valid UUID from x-request-id header', () => {
    const existingId = 'abcdef12-3456-7890-abcd-ef1234567890';
    mockReq.headers['x-request-id'] = existingId;

    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockReq.headers['x-request-id']).toBe(existingId);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', existingId);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should generate new UUID for invalid format', () => {
    mockReq.headers['x-request-id'] = 'not-a-valid-uuid';

    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockReq.headers['x-request-id']).toBe('12345678-1234-1234-1234-123456789abc');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should generate new UUID for empty string', () => {
    mockReq.headers['x-request-id'] = '';

    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockReq.headers['x-request-id']).toBe('12345678-1234-1234-1234-123456789abc');
  });

  it('should call next() after processing', () => {
    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should set response header', () => {
    requestIdMiddleware(mockReq, mockRes, mockNext);
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    );
  });
});
