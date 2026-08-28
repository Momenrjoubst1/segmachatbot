-- Migration 033: RLS for core tables missing from the numbered chain
--
-- Background: chat_sessions / chat_messages / banned_users are created by
-- migration 001 but the numbered chain never enabled RLS on them — the only
-- RLS definitions lived in full_schema.sql, which the migration runner does
-- NOT apply (README: "reference document"). user_memory is not created by any
-- numbered migration at all. A fresh rebuild from migrations/ 001→032 left
-- user conversations readable/writable by anon+authenticated (frontend holds
-- the anon key). The live database already has these policies (applied
-- manually); this migration makes the chain reproduce that state.
--
-- Idempotent: safe to re-run and to apply on the live DB where the policies
-- already exist. Policy bodies mirror the live database exactly.

-- ── 1. Enable RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;

-- ── 2. chat_sessions: users manage own sessions ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_sessions' AND policyname='Users can view own sessions') THEN
    CREATE POLICY "Users can view own sessions" ON public.chat_sessions
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_sessions' AND policyname='Users can insert own sessions') THEN
    CREATE POLICY "Users can insert own sessions" ON public.chat_sessions
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_sessions' AND policyname='Users can update own sessions') THEN
    CREATE POLICY "Users can update own sessions" ON public.chat_sessions
      FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_sessions' AND policyname='Users can delete own sessions') THEN
    CREATE POLICY "Users can delete own sessions" ON public.chat_sessions
      FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── 3. chat_messages: access scoped through the owning session ──────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can view messages in own sessions') THEN
    CREATE POLICY "Users can view messages in own sessions" ON public.chat_messages
      FOR SELECT TO authenticated USING (
        EXISTS (
          SELECT 1 FROM public.chat_sessions
          WHERE chat_sessions.id = chat_messages.session_id
            AND chat_sessions.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can insert messages in own sessions') THEN
    CREATE POLICY "Users can insert messages in own sessions" ON public.chat_messages
      FOR INSERT TO authenticated WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.chat_sessions
          WHERE chat_sessions.id = chat_messages.session_id
            AND chat_sessions.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_messages' AND policyname='Users can update messages in own sessions') THEN
    CREATE POLICY "Users can update messages in own sessions" ON public.chat_messages
      FOR UPDATE TO authenticated USING (
        EXISTS (
          SELECT 1 FROM public.chat_sessions
          WHERE chat_sessions.id = chat_messages.session_id
            AND chat_sessions.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── 4. banned_users: service role only ──────────────────────────────────────
-- SECURITY: the live policy was scoped `TO public` with USING (true) — any
-- anon visitor could read the ban list AND delete ban rows (verified
-- empirically via the REST API on 2026-08-28: GET 200, DELETE 204, INSERT
-- only blocked by an FK). Drop and re-scope to service_role.
DROP POLICY IF EXISTS "Service role can manage bans" ON public.banned_users;
CREATE POLICY "Service role can manage bans" ON public.banned_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4b. Same mis-scope on two other backend-only tables ─────────────────────
DO $$
BEGIN
  IF to_regclass('public.agent_conversation_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can manage agent events" ON public.agent_conversation_events;
    CREATE POLICY "Service role can manage agent events" ON public.agent_conversation_events
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF to_regclass('public.analytics_daily_metrics') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can manage metrics" ON public.analytics_daily_metrics;
    CREATE POLICY "Service role can manage metrics" ON public.analytics_daily_metrics
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 5. user_memory: users manage own memory ─────────────────────────────────
-- Guarded: user_memory is not created by any numbered migration (known drift,
-- tracked separately). Apply only when the table exists.
DO $$
BEGIN
  IF to_regclass('public.user_memory') IS NOT NULL THEN
    ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_memory' AND policyname='Users can view own memory') THEN
      CREATE POLICY "Users can view own memory" ON public.user_memory
        FOR SELECT TO authenticated USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_memory' AND policyname='Users can insert own memory') THEN
      CREATE POLICY "Users can insert own memory" ON public.user_memory
        FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_memory' AND policyname='Users can update own memory') THEN
      CREATE POLICY "Users can update own memory" ON public.user_memory
        FOR UPDATE TO authenticated USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_memory' AND policyname='Users can delete own memory') THEN
      CREATE POLICY "Users can delete own memory" ON public.user_memory
        FOR DELETE TO authenticated USING (auth.uid() = user_id);
    END IF;
  END IF;
END $$;

-- ── 6. documents: intentionally policy-less ─────────────────────────────────
-- RLS is enabled with zero policies: every role is denied, and the backend
-- reaches it exclusively via the service role (RLS bypass). Keep as-is.
