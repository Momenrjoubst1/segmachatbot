/**
 * ════════════════════════════════════════════════════════════════════════════════
 * AuthContext - Global Authentication State
 * 
 * Provides authentication state to the entire application
 * Allows components to access user info and auth functions from anywhere
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { createContext, useContext, ReactNode, useEffect } from "react";
import { useAuth, type User } from "@/hooks/useAuth";
import { registerVerifiedUserId } from "@/components/ui/core";
import type { AuthError, Session } from "@supabase/supabase-js";

interface AuthResult {
  data: { user: User | null; session: Session | null };
  error: AuthError | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

// Create context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * AuthProvider Component
 * 
 * Wrap your app with this provider to make auth state available globally
 * 
 * @example
 * import { AuthProvider } from '@/context/AuthContext';
 * 
 * export function App() {
 *   return (
 *     <AuthProvider>
 *       <YourApp />
 *     </AuthProvider>
 *   );
 * }
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  // Register verified user IDs at auth time
  useEffect(() => {
    if (auth.user?.email && auth.user?.id) {
      registerVerifiedUserId(auth.user.email, auth.user.id);
    }
  }, [auth.user?.email, auth.user?.id]);

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuthContext Hook
 * 
 * Access authentication state from any component
 * 
 * @returns {AuthContextType} Authentication state and functions
 * 
 * @throws {Error} If used outside AuthProvider
 * 
 * @example
 * import { useAuthContext } from '@/context/AuthContext';
 * 
 * export function MyComponent() {
 *   const { user, isAuthenticated, signIn } = useAuthContext();
 *   
 *   return (
 *     <div>
 *       {isAuthenticated ? (
 *         <p>Hello, {user.email}</p>
 *       ) : (
 *         <button onClick={() => signIn('user@example.com', 'password')}>
 *           Sign In
 *         </button>
 *       )}
 *     </div>
 *   );
 * }
 */
export function useAuthContext() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuthContext must be used within an AuthProvider. " +
      "Make sure to wrap your app with <AuthProvider>"
    );
  }

  return context;
}
