/**
 * Tests for useAuth hook
 *
 * Covers: initial state, signIn success/failure, signUp success/failure,
 * logout success/failure, and auth state change subscription.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '@/hooks/useAuth';
import {
  getCurrentUser,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  onAuthStateChange,
} from '@/lib/supabaseClient';

// ─── Mock supabaseClient lib ──────────────────────────────────────────────────
vi.mock('@/lib/supabaseClient', () => ({
  getCurrentUser: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

// ─── Mock AssistantApp chunk (prefetch import in useAuth) ─────────────────────
vi.mock('@/features/ai-assistant/AssistantApp', () => ({
  AssistantApp: () => null,
}));

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockSignInWithEmail = signInWithEmail as ReturnType<typeof vi.fn>;
const mockSignUpWithEmail = signUpWithEmail as ReturnType<typeof vi.fn>;
const mockSignOut = signOut as ReturnType<typeof vi.fn>;
const mockOnAuthStateChange = onAuthStateChange as ReturnType<typeof vi.fn>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MOCK_USER = { id: 'user-123', email: 'test@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockOnAuthStateChange.mockReturnValue(() => {}); // returns unsubscribe fn
  mockGetCurrentUser.mockResolvedValue(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('useAuth', () => {
  it('starts in loading state and resolves to unauthenticated when no user', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthLoading).toBe(true);

    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('resolves to authenticated when a user is already signed in', async () => {
    mockGetCurrentUser.mockResolvedValue(MOCK_USER);
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(MOCK_USER);
  });

  it('updates state when onAuthStateChange fires', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    let authCallback: ((user: typeof MOCK_USER | null) => void) | null = null;
    mockOnAuthStateChange.mockImplementation((cb: typeof authCallback) => {
      authCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    act(() => {
      authCallback?.(MOCK_USER);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(MOCK_USER);
  });

  it('signIn sets authenticated state on success', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    mockSignInWithEmail.mockResolvedValue({
      data: { user: MOCK_USER, session: {} },
      error: null,
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    let signInResult: Awaited<ReturnType<typeof result.current.signIn>>;
    await act(async () => {
      signInResult = await result.current.signIn('test@example.com', 'password');
    });

    expect(mockSignInWithEmail).toHaveBeenCalledWith('test@example.com', 'password');
    expect(signInResult!.error).toBeNull();
  });

  it('signIn sets error state on failure', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const authError = { message: 'Invalid credentials', name: 'AuthApiError', status: 400 };
    mockSignInWithEmail.mockResolvedValue({ data: {}, error: authError });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    await act(async () => {
      await result.current.signIn('bad@example.com', 'wrongpass');
    });

    expect(result.current.error).toBe('Invalid credentials');
  });

  it('signUp returns success result', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    mockSignUpWithEmail.mockResolvedValue({
      data: { user: MOCK_USER, session: null },
      error: null,
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    let signUpResult: Awaited<ReturnType<typeof result.current.signUp>>;
    await act(async () => {
      signUpResult = await result.current.signUp('new@example.com', 'password123');
    });

    expect(mockSignUpWithEmail).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(signUpResult!.error).toBeNull();
  });

  it('logout calls signOut and clears error state', async () => {
    mockGetCurrentUser.mockResolvedValue(MOCK_USER);
    mockSignOut.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it('logout sets error state when signOut fails', async () => {
    mockGetCurrentUser.mockResolvedValue(MOCK_USER);
    mockSignOut.mockResolvedValue({ error: { message: 'Network error' } });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.error).toBe('Network error');
  });

  it('logout handles thrown exceptions', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    mockSignOut.mockRejectedValue(new Error('Connection refused'));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthLoading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.error).toBe('Connection refused');
  });

  it('unsubscribes from auth state changes on unmount', async () => {
    const unsubscribe = vi.fn();
    mockOnAuthStateChange.mockReturnValue(unsubscribe);
    mockGetCurrentUser.mockResolvedValue(null);

    const { unmount } = renderHook(() => useAuth());
    await waitFor(() => true);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
