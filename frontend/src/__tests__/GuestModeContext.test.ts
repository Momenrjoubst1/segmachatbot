/**
 * Tests for GuestModeContext
 *
 * Covers: guest mode detection, message count tracking, limit handling,
 * server status sync, and setGuestQuota functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { GuestModeProvider, useGuestMode, GUEST_MESSAGE_LIMIT } from '@/context/GuestModeContext';

// ─── Mock AuthContext ─────────────────────────────────────────────────────────
const mockUseAuthContext = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

// ─── Mock fetch ──────────────────────────────────────────────────────────────
const mockFetch = vi.fn();

// Store original fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
  mockUseAuthContext.mockReturnValue({ isAuthenticated: false });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Test Wrapper ────────────────────────────────────────────────────────────
const createWrapper = () => {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(GuestModeProvider, null, children);
  };
};

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('GuestModeContext', () => {
  describe('GUEST_MESSAGE_LIMIT', () => {
    it('should be set to 4', () => {
      expect(GUEST_MESSAGE_LIMIT).toBe(4);
    });
  });

  describe('useGuestMode', () => {
    it('should throw when used outside GuestModeProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useGuestMode());
      }).toThrow('useGuestMode must be used within GuestModeProvider');

      consoleSpy.mockRestore();
    });

    it('should return guest mode state when used inside provider', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isGuestMode).toBe(true);
      expect(result.current.guestMessageCount).toBe(0);
      expect(result.current.guestMessageLimit).toBe(4);
      expect(result.current.limitReached).toBe(false);
    });

    it('should return authenticated mode when user is logged in', () => {
      mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isGuestMode).toBe(false);
    });
  });

  describe('guestMessageCount', () => {
    it('should start at 0', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      expect(result.current.guestMessageCount).toBe(0);
    });

    it('should update when setGuestQuota is called', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setGuestQuota({ count: 2, limit: 4 });
      });

      expect(result.current.guestMessageCount).toBe(2);

      act(() => {
        result.current.setGuestQuota({ count: 3, limit: 4 });
      });

      expect(result.current.guestMessageCount).toBe(3);
    });
  });

  describe('guestMessageLimit', () => {
    it('should default to GUEST_MESSAGE_LIMIT', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      expect(result.current.guestMessageLimit).toBe(GUEST_MESSAGE_LIMIT);
    });

    it('should update from setGuestQuota', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setGuestQuota({ count: 0, limit: 10 });
      });

      expect(result.current.guestMessageLimit).toBe(10);
    });
  });

  describe('limitReached', () => {
    it('should be false initially', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      expect(result.current.limitReached).toBe(false);
    });

    it('should be computed from count >= limit', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setGuestQuota({ count: 3, limit: 4 });
      });

      expect(result.current.limitReached).toBe(false);

      act(() => {
        result.current.setGuestQuota({ count: 4, limit: 4 });
      });

      expect(result.current.limitReached).toBe(true);

      act(() => {
        result.current.setGuestQuota({ count: 5, limit: 4 });
      });

      expect(result.current.limitReached).toBe(true);
    });
  });

  describe('retryAfterSeconds', () => {
    it('should be null initially', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      expect(result.current.retryAfterSeconds).toBeNull();
    });

    it('should update from setGuestQuota', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setGuestQuota({ count: 4, limit: 4, retryAfterSeconds: 3600 });
      });

      expect(result.current.retryAfterSeconds).toBe(3600);
    });
  });

  describe('refreshGuestStatus', () => {
    it('should fetch guest status from server', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 2, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.refreshGuestStatus();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/guest/status'),
        { credentials: 'include' }
      );
      expect(result.current.guestMessageCount).toBe(2);
    });

    it('should update limitReached from server response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 4, limit: 4, limitReached: true }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.refreshGuestStatus();
      });

      expect(result.current.limitReached).toBe(true);
      expect(result.current.guestMessageCount).toBe(4);
    });

    it('should not fetch when authenticated', async () => {
      mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 0, limit: 4, limitReached: false }),
      });

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.refreshGuestStatus();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle fetch failure gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      // Should not throw
      await act(async () => {
        await result.current.refreshGuestStatus();
      });

      // Count should remain at initial value
      expect(result.current.guestMessageCount).toBe(0);

      consoleSpy.mockRestore();
    });

    it('should handle non-ok response gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.refreshGuestStatus();
      });

      expect(result.current.guestMessageCount).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe('auto-fetch on mount', () => {
    it('should fetch guest status on mount when not authenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 1, limit: 4, limitReached: false }),
      });

      renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it('should not fetch on mount when authenticated', async () => {
      mockUseAuthContext.mockReturnValue({ isAuthenticated: true });

      renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      // Wait a bit to ensure no fetch happens
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('reset on auth change', () => {
    it('should reset guest state when user logs in', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ count: 3, limit: 4, limitReached: false }),
      });

      const { result, rerender } = renderHook(() => useGuestMode(), {
        wrapper: createWrapper(),
      });

      // Wait for initial fetch
      await waitFor(() => {
        expect(result.current.guestMessageCount).toBe(3);
      });

      // Simulate login
      mockUseAuthContext.mockReturnValue({ isAuthenticated: true });
      rerender();

      // State should be reset
      expect(result.current.guestMessageCount).toBe(0);
      expect(result.current.guestMessageLimit).toBe(GUEST_MESSAGE_LIMIT);
      expect(result.current.retryAfterSeconds).toBeNull();
    });
  });
});
