/**
 * Supabase Auth Provider
 * مزوّد المصادقة عبر Supabase
 *
 * Implements IAuthProvider using Supabase Auth + banned_users table.
 * This is the default provider for Sigma AI Chatbot.
 */

import { supabase } from '../../../services/supabase.service.js';
import type { IAuthProvider, AuthUserWithBan, BanRecord } from '../auth.types.js';

/**
 * Create a Supabase auth provider.
 *
 * Uses the existing Supabase client singleton — no new connections.
 */
export function createSupabaseAuthProvider(): IAuthProvider {
  return {
    async verifyToken(token: string): Promise<AuthUserWithBan> {
      const { data: authData, error } = await supabase.auth.getUser(token);

      if (error || !authData?.user) {
        throw new Error(error?.message || 'Invalid or expired token');
      }

      return {
        id: authData.user.id,
        email: authData.user.email ?? '',
        banned_until: authData.user.banned_until,
      };
    },

    async checkBanStatus(userId: string): Promise<BanRecord | null> {
      const { data: banRows } = await supabase
        .from('banned_users')
        .select('expires_at')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(10);

      const activeBan = (banRows ?? []).find((row) => {
        if (!row.expires_at) return true;
        return new Date(row.expires_at) > new Date();
      });

      return activeBan ?? null;
    },
  };
}
