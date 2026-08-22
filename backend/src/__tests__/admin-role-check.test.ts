import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAdminUser, requireAdmin } from '../utils/admin-role-check.js';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('isAdminUser', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_USER_IDS;
  });

  it('returns false when userId is undefined', () => {
    expect(isAdminUser(undefined)).toBe(false);
  });

  it('returns false when ADMIN_USER_IDS is not set', () => {
    expect(isAdminUser('user1')).toBe(false);
  });

  it('returns true when userId matches an admin', () => {
    process.env.ADMIN_USER_IDS = 'user1,user2,user3';
    expect(isAdminUser('user2')).toBe(true);
  });

  it('returns false when userId is not in the admin list', () => {
    process.env.ADMIN_USER_IDS = 'user1,user2';
    expect(isAdminUser('user3')).toBe(false);
  });

  it('handles whitespace around admin IDs', () => {
    process.env.ADMIN_USER_IDS = ' user1 , user2 ';
    expect(isAdminUser('user1')).toBe(true);
    expect(isAdminUser('user2')).toBe(true);
  });

  it('filters empty entries', () => {
    process.env.ADMIN_USER_IDS = 'user1,,user2,,';
    expect(isAdminUser('user1')).toBe(true);
    expect(isAdminUser('')).toBe(false);
  });
});

describe('requireAdmin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_USER_IDS;
  });

  it('calls next() when user is admin', () => {
    process.env.ADMIN_USER_IDS = 'admin1';
    const req = { user: { id: 'admin1' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not admin', () => {
    process.env.ADMIN_USER_IDS = 'admin1';
    const req = { user: { id: 'notadmin' } } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Admin access required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user is missing', () => {
    const req = { user: undefined } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
