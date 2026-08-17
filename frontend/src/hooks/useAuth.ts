/**
 * ════════════════════════════════════════════════════════════════════════════════
 * useAuth Hook
 * 
 * Custom React hook for managing authentication state and operations
 * Handles user session, loading state, and provides helper methods
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useState } from "react";
import {
  getCurrentUser,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  onAuthStateChange,
} from "@/lib/supabaseClient";

interface User {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export type { User };

interface AuthState {
  user: User | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
}

/**
 * useAuth Hook
 * 
 * @returns {Object} Auth state and helper functions
 * 
 * @example
 * import { useAuth } from '@/hooks/useAuth';
 * 
 * export function MyComponent() {
 *   const { user, isAuthenticated, isAuthLoading, signIn, signUp, logout } = useAuth();
 *   
 *   if (isAuthLoading) return <div>Loading...</div>;
 *   
 *   if (isAuthenticated) {
 *     return <div>Welcome, {user?.email}</div>;
 *   }
 *   
 *   return <button onClick={() => signIn('user@example.com', 'password')}>Sign In</button>;
 * }
 */
export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthLoading: true,
    isAuthenticated: false,
  });

  const [error, setError] = useState<string | null>(null);

  // Check initial auth state on mount
  useEffect(() => {
    // Prefetch the AssistantApp chunk during auth check to avoid sequential waterfall.
    // The dynamic import triggers the browser to download the chunk immediately,
    // so by the time auth resolves and React.lazy() in App.tsx requests it,
    // the module is already cached.
    import("@/features/ai-assistant/AssistantApp");

    let isMounted = true;

    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (isMounted) {
          setAuthState({
            user: user ?? null,
            isAuthLoading: false,
            isAuthenticated: !!user,
          });
        }
      } catch (err) {
        if (isMounted) {
          setError((err as Error).message);
          setAuthState({ user: null, isAuthLoading: false, isAuthenticated: false });
        }
      }
    };

    // NOTE: no safety timer that force-clears isAuthLoading — doing so
    // fabricated a guest state for an authenticated user while the session
    // was still being restored (slow networks). onAuthStateChange also
    // resolves loading via the INITIAL_SESSION event, so the spinner in
    // App.tsx is the worst case now.

    checkAuth();

    // Subscribe to auth changes
    const unsubscribe = onAuthStateChange((user) => {
      if (isMounted) {
        setAuthState({
          user,
          isAuthLoading: false,
          isAuthenticated: !!user,
        });
      }
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  // Sign in handler
  const signIn = async (email: string, password: string) => {
      try {

          setError(null);
          const { data, error } = await signInWithEmail(email, password);
          if (error) {
            setError(error.message);
            // Clean up stale auth data on failure
            localStorage.removeItem('auth_provider');
          }
          return { data, error };
        
      } catch (error) {
        console.error('[useAuth.ts] [signIn]:', error);
        const message = error instanceof Error ? error.message : 'Sign in failed';
        setError(message);
        return {
          data: { user: null, session: null },
          error: { message, name: 'AuthApiError', status: 0 } as import('@supabase/supabase-js').AuthError,
        };
      }
  };

  // Sign up handler
  const signUp = async (email: string, password: string) => {
      try {

          setError(null);
          const { data, error } = await signUpWithEmail(email, password);
          if (error) {
            setError(error.message);
            // Clean up stale auth data on failure
            localStorage.removeItem('auth_provider');
          }
          return { data, error };
        
      } catch (error) {
        console.error('[useAuth.ts] [signUp]:', error);
        const message = error instanceof Error ? error.message : 'Sign up failed';
        setError(message);
        return {
          data: { user: null, session: null },
          error: { message, name: 'AuthApiError', status: 0 } as import('@supabase/supabase-js').AuthError,
        };
      }
  };

  // Sign out handler
  const logout = async () => {
    try {
      setError(null);
      if (authState.user) {
        // Clear any cached data on logout
        localStorage.removeItem(`chat_data_${authState.user.id}`);
      }
      const signOutResult = await signOut();
      if (signOutResult?.error) {
        const msg = signOutResult.error.message;
        setError(msg);
        // Surface the error to the user via console; callers can show a toast
        console.error('[useAuth] logout error:', msg);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Logout failed';
      setError(msg);
      console.error('[useAuth.ts] [logout]:', error);
    }
  };

  return {
    ...authState,
    error,
    signIn,
    signUp,
    logout,
  };
}
