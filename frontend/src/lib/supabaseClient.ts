/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Supabase Client Initialization
 * 
 * This file initializes the Supabase client with environment variables.
 * All authentication and database operations should use this client.
 * 
 * Environment Variables Required:
 *  - VITE_SUPABASE_URL: Your Supabase project URL
 *  - VITE_SUPABASE_ANON_KEY: Your Supabase anonymous public key
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { createClient, User } from "@supabase/supabase-js";

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseStorageBucket = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'chat_media';

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[SupabaseClient] Missing required environment variables. " +
    "Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local."
  );
}

/**
 * Initialize and export the Supabase client
 * 
 * @example
 * import { supabase } from '@/lib/supabaseClient';
 * 
 * // Check authenticated session
 * const { data: { session } } = await supabase.auth.getSession();
 * 
 * // Sign in
 * await supabase.auth.signInWithPassword({
 *   email: 'user@example.com',
 *   password: 'password'
 * });
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
});



/**
 * Get the current authenticated user
 * 
 * @returns {Promise<User | null>} The current user or null if not authenticated
 * 
 * @example
 * import { getCurrentUser } from '@/lib/supabaseClient';
 * 
 * const user = await getCurrentUser();
 * if (user) {
 *   console.log('User is logged in:', user.email);
 * } else {
 *   console.log('User is not logged in');
 * }
 */
export async function getCurrentUser() {
    try {

      const { data: { session } } = await supabase.auth.getSession();
      return session?.user ?? null;

    } catch (error) {
      console.error('[supabaseClient.ts] [getCurrentUser]:', error);
      return null;
    }
}

/**
 * Subscribe to authentication state changes
 * 
 * @param {Function} callback - Function to call when auth state changes
 * @returns {Function} Unsubscribe function
 * 
 * @example
 * import { onAuthStateChange } from '@/lib/supabaseClient';
 * 
 * const unsubscribe = onAuthStateChange((user) => {
 *   if (user) {
 *     console.log('User logged in:', user.email);
 *   } else {
 *     console.log('User logged out');
 *   }
 * });
 * 
 * // Don't forget to unsubscribe!
 * // unsubscribe();
 */
export function onAuthStateChange(
  callback: (user: User | null) => void
) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });

  return () => {
    subscription?.unsubscribe();
  };
}

/**
 * Sign in with email and password
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Authentication response
 * 
 * @example
 * import { signInWithEmail } from '@/lib/supabaseClient';
 * 
 * const { data, error } = await signInWithEmail('user@example.com', 'password');
 * if (error) {
 *   console.error('Sign in failed:', error.message);
 * } else {
 *   console.log('Signed in successfully');
 * }
 */
export async function signInWithEmail(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      localStorage.setItem('auth_provider', 'email');
    }
    return { data, error };
}

/**
 * Sign up with email and password
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Authentication response
 * 
 * @example
 * import { signUpWithEmail } from '@/lib/supabaseClient';
 * 
 * const { data, error } = await signUpWithEmail('user@example.com', 'password');
 * if (error) {
 *   console.error('Sign up failed:', error.message);
 * } else {
 *   console.log('Signed up successfully');
 * }
 */
export async function signUpWithEmail(email: string, password: string) {
    localStorage.setItem('auth_provider', 'email');
    return supabase.auth.signUp({ email, password });
}

/**
 * Sign in with Google OAuth
 * 
 * @returns {Promise<Object>} Authentication response
 * 
 * @example
 * import { signInWithGoogle } from '@/lib/supabaseClient';
 * 
 * const { data, error } = await signInWithGoogle();
 * if (error) {
 *   console.error('Google sign in failed:', error.message);
 * } else {
 *   console.log('Signed in with Google successfully');
 * }
 */
export async function signInWithGoogle() {
    try {
      localStorage.setItem('auth_provider', 'google');
      return supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}`
        }
      });
    } catch (error) {
      console.error('[supabaseClient.ts] [signInWithGoogle]:', error);
      return { data: null, error: { message: (error as Error).message } };
    }
}

export async function signInWithFacebook() {
    try {
      localStorage.setItem('auth_provider', 'facebook');
      return supabase.auth.signInWithOAuth({
        provider: 'facebook',
        options: {
          redirectTo: `${window.location.origin}`
        }
      });
    } catch (error) {
      console.error('[supabaseClient.ts] [signInWithFacebook]:', error);
      return { data: null, error: { message: (error as Error).message } };
    }
}

/**
 * Sign out the current user
 * 
 * @returns {Promise<Object>} Sign out response
 * 
 * @example
 * import { signOut } from '@/lib/supabaseClient';
 * 
 * const { error } = await signOut();
 * if (error) {
 *   console.error('Sign out failed:', error.message);
 * } else {
 *   console.log('Signed out successfully');
 * }
 */
export async function signOut() {
    localStorage.removeItem('auth_provider');
    return supabase.auth.signOut();
}

/**
 * Get the current session
 * 
 * @returns {Promise<Session | null>} The current session or null
 * 
 * @example
 * import { getSession } from '@/lib/supabaseClient';
 * 
 * const session = await getSession();
 * if (session) {
 *   console.log('Session exists, access token:', session.access_token);
 * }
 */
export async function getSession() {
    try {

      const { data: { session } } = await supabase.auth.getSession();
      return session;

    } catch (error) {
      console.error('[supabaseClient.ts] [getSession]:', error);
      return null;
    }
}

/**
 * Upload Base64 image to Supabase Storage and get public URL
 */
export async function uploadImageToStorage(dataUrl: string, userId: string, type: 'avatar' | 'cover'): Promise<string> {
  try {
    // Convert base64 to blob
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    
    const fileExt = blob.type.split('/')[1] || 'jpg';
    const filePath = `profiles/${userId}/${type}_${Date.now()}.${fileExt}`;
    
    // Upload the file to configurable storage bucket
    const { error: uploadError } = await supabase.storage
      .from(supabaseStorageBucket)
      .upload(filePath, blob, {
        upsert: true,
        contentType: blob.type
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(supabaseStorageBucket)
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (error) {
    console.error("Error in uploadImageToStorage:", error);
    throw error;
  }
}

/**
 * Save user profile image URL to database
 *
 * @param {string} userId - User ID from Auth
 * @param {string} imageUrl - Image URL to save
 * @returns {Promise<Object>} Update response
 */
export async function saveUserProfileImage(userId: string, imageUrl: string) {
    return supabase
      .from("public_profiles")
      .update({ avatar_url: imageUrl })
      .eq("id", userId);
}

/**
 * Get user profile image URL from database
 *
 * @param {string} userId - User ID from Auth
 * @returns {Promise<string | null>} Profile image URL or null
 */
export async function getUserProfileImage(userId: string) {
    try {

      const { data, error } = await supabase
        .from("public_profiles")
        .select("avatar_url")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Error fetching profile image:", error);
        return null;
      }

      return data?.avatar_url || null;

    } catch (error) {
      console.error('[supabaseClient.ts] [getUserProfileImage]:', error);
      return null;
    }
}

/**
 * Save user profile cover image URL to database
 *
 * @param {string} userId - User ID from Auth
 * @param {string} imageUrl - Image URL to save
 * @returns {Promise<Object>} Update response
 */
export async function saveUserCoverImage(userId: string, imageUrl: string) {
    return supabase
      .from("public_profiles")
      .update({ cover_url: imageUrl })
      .eq("id", userId);
}

