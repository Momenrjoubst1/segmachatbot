/**
 * Tests for the AuthContext Provider and useAuthContext hook.
 *
 * Covers: provider rendering, context value propagation, missing-provider error,
 * and integration with the underlying useAuth hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuthContext } from '@/context/AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { registerVerifiedUserId } from '@/components/ui/core';

// ─── Mock useAuth ─────────────────────────────────────────────────────────────
// IMPORTANT: vi.mock factories are hoisted — no top-level variables allowed inside.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: null,
    isAuthLoading: false,
    isAuthenticated: false,
    error: null,
    signIn: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    logout: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/components/ui/core', () => ({
  registerVerifiedUserId: vi.fn(),
}));

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockRegisterVerifiedUserId = registerVerifiedUserId as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to default unauthenticated state
  mockUseAuth.mockReturnValue({
    user: null,
    isAuthLoading: false,
    isAuthenticated: false,
    error: null,
    signIn: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    logout: vi.fn().mockResolvedValue(undefined),
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('AuthContext', () => {
  describe('AuthProvider', () => {
    it('renders children without errors', () => {
      render(
        <AuthProvider>
          <div data-testid="child">Hello</div>
        </AuthProvider>
      );
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('provides unauthenticated state by default', () => {
      const { result } = renderHook(() => useAuthContext(), {
        wrapper: AuthProvider,
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('provides authenticated state when user is set', () => {
      const mockUser = { id: 'user-1', email: 'test@example.com' };
      mockUseAuth.mockReturnValue({
        user: mockUser,
        isAuthLoading: false,
        isAuthenticated: true,
        error: null,
        signIn: vi.fn(),
        signUp: vi.fn(),
        logout: vi.fn(),
      });

      const { result } = renderHook(() => useAuthContext(), {
        wrapper: AuthProvider,
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockUser);
    });

    it('calls registerVerifiedUserId when user has email and id', async () => {
      const mockUser = { id: 'user-abc', email: 'verified@example.com' };
      mockUseAuth.mockReturnValue({
        user: mockUser,
        isAuthLoading: false,
        isAuthenticated: true,
        error: null,
        signIn: vi.fn(),
        signUp: vi.fn(),
        logout: vi.fn(),
      });

      renderHook(() => useAuthContext(), {
        wrapper: AuthProvider,
      });

      await waitFor(() => {
        expect(mockRegisterVerifiedUserId).toHaveBeenCalledWith('verified@example.com', 'user-abc');
      });
    });

    it('does not call registerVerifiedUserId when user is null', async () => {
      // default beforeEach already sets user: null — nothing to override
      renderHook(() => useAuthContext(), { wrapper: AuthProvider });
      await waitFor(() => true);
      expect(mockRegisterVerifiedUserId).not.toHaveBeenCalled();
    });
  });

  describe('useAuthContext', () => {
    it('throws when used outside AuthProvider', () => {
      // Suppress expected console.error from React
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => renderHook(() => useAuthContext())).toThrow(
        /useAuthContext must be used within an AuthProvider/
      );

      consoleSpy.mockRestore();
    });

    it('provides signIn function that delegates to useAuth', async () => {
      const mockSignIn = vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null });
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthLoading: false,
        isAuthenticated: false,
        error: null,
        signIn: mockSignIn,
        signUp: vi.fn(),
        logout: vi.fn(),
      });

      const { result } = renderHook(() => useAuthContext(), { wrapper: AuthProvider });

      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password');
    });

    it('provides logout function that delegates to useAuth', async () => {
      const mockLogout = vi.fn().mockResolvedValue(undefined);
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthLoading: false,
        isAuthenticated: false,
        error: null,
        signIn: vi.fn(),
        signUp: vi.fn(),
        logout: mockLogout,
      });

      const { result } = renderHook(() => useAuthContext(), { wrapper: AuthProvider });

      await act(async () => {
        await result.current.logout();
      });

      expect(mockLogout).toHaveBeenCalledOnce();
    });
  });
});
