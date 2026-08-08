import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Use vi.hoisted to define mock functions that vi.mock factories can reference
const { mockGet, mockSet, mockDel, mockGetUser } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn().mockResolvedValue('OK'),
  mockDel: vi.fn().mockResolvedValue(1),
  mockGetUser: vi.fn(),
}));

vi.mock('../config/redis/client.js', () => ({
  default: {
    get: mockGet,
    set: mockSet,
    del: mockDel,
  },
}));

vi.mock('../services/supabase.service.js', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
    },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

import { authMiddleware } from '../middleware/auth.middleware.js';

function mockReq(authHeader?: string): Request {
  return {
    headers: {
      authorization: authHeader,
    },
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-agent'),
  } as unknown as Request;
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const next = vi.fn() as NextFunction;

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);
  });

  describe('Token extraction', () => {
    it('should return 401 when no Authorization header is present', async () => {
      const req = mockReq();
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Valid Bearer token required' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      const req = mockReq('Basic abc123');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Bearer token is empty', async () => {
      const req = mockReq('Bearer ');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Redis caching', () => {
    it('should use cached session when available', async () => {
      const cachedUser = { id: 'user-1', email: 'test@test.com' };
      mockGet.mockResolvedValue(
        JSON.stringify({ user: cachedUser, isBanned: false, bannedUntil: null }),
      );

      const req = mockReq('Bearer valid-token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(mockGet).toHaveBeenCalled();
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      expect((req as any).user).toEqual(cachedUser);
    });

    it('should skip Redis when circuit breaker is open', async () => {
      // Trigger circuit breaker by calling 5 failures
      mockGet.mockRejectedValue(new Error('Redis down'));

      for (let i = 0; i < 5; i++) {
        await authMiddleware(mockReq(`Bearer token${i}`), mockRes(), next);
      }

      // Reset mocks for the actual test
      vi.clearAllMocks();
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'u1', email: 'a@b.com', banned_until: null } },
        error: null,
      });

      const req2 = mockReq('Bearer fresh-token');
      const res2 = mockRes();
      await authMiddleware(req2, res2, next);

      // Redis should be skipped (circuit open), Supabase called instead
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockGetUser).toHaveBeenCalled();
    });

    it('should fall through to Supabase when cache has invalid structure', async () => {
      // Return valid JSON with missing required fields
      mockGet.mockResolvedValue(JSON.stringify({ invalid: 'structure' }));

      const req = mockReq('Bearer token');
      const res = mockRes();
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'u1', email: 'a@b.com', banned_until: null } },
        error: null,
      });

      await authMiddleware(req, res, next);

      // Should fall through to Supabase and still authenticate
      expect(mockGetUser).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('JWT validation via Supabase', () => {
    it('should return 401 for invalid tokens', async () => {
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: null,
        error: { message: 'invalid token' },
      });

      const req = mockReq('Bearer invalid-token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid or expired token' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should attach user to request on valid token', async () => {
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: 'test@example.com', banned_until: null },
        },
        error: null,
      });

      const req = mockReq('Bearer valid-token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should cache validation result in Redis for 5 minutes', async () => {
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: 'user-1', email: 'a@b.com', banned_until: null },
        },
        error: null,
      });

      const req = mockReq('Bearer token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('auth:session:'),
        expect.any(String),
        'EX',
        300,
      );
    });
  });

  describe('Ban checking', () => {
    it('should return 403 for banned users (auth metadata)', async () => {
      mockGet.mockResolvedValue(null);
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: 'banned-user',
            email: 'banned@test.com',
            banned_until: futureDate,
          },
        },
        error: null,
      });

      const req = mockReq('Bearer banned-token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Account suspended' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow users with expired bans', async () => {
      mockGet.mockResolvedValue(null);
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: 'user1',
            email: 'a@b.com',
            banned_until: pastDate,
          },
        },
        error: null,
      });

      const req = mockReq('Bearer token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should return 401 on unexpected errors', async () => {
      // Make Redis throw and Supabase also throw to hit the outer catch block
      mockGet.mockRejectedValue(new Error('Redis down'));
      mockGetUser.mockRejectedValue(new Error('Supabase down'));

      const req = mockReq('Bearer token');
      const res = mockRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
