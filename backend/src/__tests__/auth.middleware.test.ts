import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function createMockJWT(expiresInSeconds: number = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    email: 'test@test.com',
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })).toString('base64url');
  const signature = 'mock-signature';
  return `${header}.${payload}.${signature}`;
}

function mockReq(authHeader?: string): Request {
  return {
    headers: { authorization: authHeader },
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('test-agent'),
  } as unknown as Request;
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadMiddleware() {
    const { mockGet, mockSet, mockDel, mockGetUser } = vi.hoisted(() => ({
      mockGet: vi.fn().mockResolvedValue(null),
      mockSet: vi.fn().mockResolvedValue('OK'),
      mockDel: vi.fn().mockResolvedValue(1),
      mockGetUser: vi.fn(),
    }));

    vi.doMock('../utils/logger.js', () => ({
      createLogger: vi.fn(() => mockLogger),
    }));

    vi.doMock('../config/redis/client.js', () => ({
      default: { get: mockGet, set: mockSet, del: mockDel },
    }));

    vi.doMock('../services/supabase.service.js', () => ({
      supabase: {
        auth: { getUser: mockGetUser },
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      },
    }));

    const { authMiddleware } = await import('../middleware/auth.middleware.js');
    return { authMiddleware, mockGet, mockSet, mockDel, mockGetUser };
  }

  describe('Token extraction', () => {
    it('should return 401 when no Authorization header is present', async () => {
      const { authMiddleware } = await loadMiddleware();
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Valid Bearer token required' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not start with Bearer', async () => {
      const { authMiddleware } = await loadMiddleware();
      const req = mockReq('Basic abc123');
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Bearer token is empty', async () => {
      const { authMiddleware } = await loadMiddleware();
      const req = mockReq('Bearer ');
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Redis caching', () => {
    it('should use cached session when available', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
      const cachedUser = { id: 'user-1', email: 'test@test.com' };
      mockGet.mockResolvedValue(
        JSON.stringify({ user: cachedUser, isBanned: false, bannedUntil: null, cachedAt: Date.now() }),
      );

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockGet).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      expect((req as any).user).toEqual(cachedUser);
    });

    it('should skip Redis when circuit breaker is open', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
      // Trigger circuit breaker by calling 5 failures
      mockGet.mockRejectedValue(new Error('Redis down'));

      for (let i = 0; i < 5; i++) {
        const token = createMockJWT();
        await authMiddleware(mockReq(`Bearer ${token}`), mockRes(), vi.fn());
      }

      // Reset mocks for the actual test
      vi.clearAllMocks();
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'u1', email: 'a@b.com', banned_until: null } },
        error: null,
      });

      const token = createMockJWT();
      const req2 = mockReq(`Bearer ${token}`);
      const res2 = mockRes();
      const next2 = vi.fn() as NextFunction;
      await authMiddleware(req2, res2, next2);

      // Redis should be skipped (circuit open), Supabase called instead
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockGetUser).toHaveBeenCalled();
    });

    it('should fall through to Supabase when cache has invalid structure', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
      mockGet.mockResolvedValue(JSON.stringify({ invalid: 'structure' }));

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'u1', email: 'a@b.com', banned_until: null } },
        error: null,
      });

      await authMiddleware(req, res, next);

      expect(mockGetUser).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('JWT validation via Supabase', () => {
    it('should return 401 for invalid tokens', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: null,
        error: { message: 'invalid token' },
      });

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid or expired token' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should attach user to request on valid token', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: 'test@example.com', banned_until: null },
        },
        error: null,
      });

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should cache validation result in Redis', async () => {
      const { authMiddleware, mockGet, mockGetUser, mockSet } = await loadMiddleware();
      mockGet.mockResolvedValue(null);
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: 'user-1', email: 'a@b.com', banned_until: null },
        },
        error: null,
      });

      const token = createMockJWT(600);
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining('auth:session:'),
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });
  });

  describe('Ban checking', () => {
    it('should return 403 for banned users (auth metadata)', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
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

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Account suspended' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow users with expired bans', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
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

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should return 401 on unexpected errors', async () => {
      const { authMiddleware, mockGet, mockGetUser } = await loadMiddleware();
      mockGet.mockRejectedValue(new Error('Redis down'));
      mockGetUser.mockRejectedValue(new Error('Supabase down'));

      const token = createMockJWT();
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn() as NextFunction;

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Authentication failed' }),
      );
    });
  });
});
