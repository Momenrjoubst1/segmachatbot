import { createClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('supabase-config');

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

function resolveSupabaseUrl(): string {
  const value =
    process.env.AUTH_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  if (value) return value;

  if (isTest) return 'http://vitest.supabase.local';

  if (isProd) {
    throw new Error(
      '[Config] Missing Supabase URL. Set AUTH_SUPABASE_URL or SUPABASE_URL.',
    );
  }

  log.warn(
    '⚠️ [Config] Missing Supabase URL — using local fallback (development only).',
  );
  return 'http://localhost:54321';
}

function resolveServiceRoleKey(): string {
  const value =
    process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (isTest) return 'vitest-service-role-jwt-placeholder';

  if (!value) {
    if (isProd) {
      throw new Error(
        '[Config] Missing service role key. Set AUTH_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY.',
      );
    }

    log.warn(
      '⚠️ [Config] Missing Supabase service role key — using dummy (development only). Set a real key to test against live Supabase.',
    );
    return 'dummy-dev-service-role';
  }

  // Guard: if someone set the env var to the literal dummy value in production, block it
  if (isProd && value === 'dummy-dev-service-role') {
    throw new Error(
      '[Config] Service role key is set to dummy/dev value in production. Set a real key via AUTH_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  if (value === 'dummy-dev-service-role') {
    log.warn(
      '⚠️ [Config] Service role key is set to dummy value — running in development mode.',
    );
  }

  return value;
}

export const supabaseConfig = {
  auth: {
    url: resolveSupabaseUrl(),
    serviceRoleKey: resolveServiceRoleKey(),
  },
} as const;

export const supabase = createClient(
  supabaseConfig.auth.url,
  supabaseConfig.auth.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export const knowledgeSupabase = supabase;
