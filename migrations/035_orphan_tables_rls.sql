-- Migration 035: RLS backfill for orphan tables (email/analytics/study/profiles)
--
-- These tables exist only in the live database / full_schema.sql reference —
-- no numbered migration creates them. The live policies were also scoped
-- TO public; user-scoped predicates (auth.uid() = ...) mean anon effectively
-- sees nothing, but this migration re-creates every policy TO authenticated
-- so anon is explicitly denied (default-deny, no predicate evaluation).
-- Policy bodies mirror the live database as of 2026-08-28.
--
-- Idempotent: guarded by to_regclass + pg_policies existence checks.

DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.course_resources') IS NOT NULL THEN
    ALTER TABLE public.course_resources ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.email_audit_logs') IS NOT NULL THEN
    ALTER TABLE public.email_audit_logs ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.email_confirmations') IS NOT NULL THEN
    ALTER TABLE public.email_confirmations ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.email_contacts') IS NOT NULL THEN
    ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.email_jobs') IS NOT NULL THEN
    ALTER TABLE public.email_jobs ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.email_schedules') IS NOT NULL THEN
    ALTER TABLE public.email_schedules ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.email_signatures') IS NOT NULL THEN
    ALTER TABLE public.email_signatures ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.feedback') IS NOT NULL THEN
    ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.public_profiles') IS NOT NULL THEN
    ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.sent_emails') IS NOT NULL THEN
    ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.student_courses') IS NOT NULL THEN
    ALTER TABLE public.student_courses ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('analytics_events','Users can view own analytics','SELECT','auth.uid() = user_id',NULL),
    ('analytics_events','Users can insert own analytics','INSERT',NULL,'auth.uid() = user_id'),
    ('feedback','Users can view own feedback','SELECT','auth.uid() = user_id',NULL),
    ('feedback','Users can insert own feedback','INSERT',NULL,'auth.uid() = user_id'),
    ('email_contacts','Users can view own contacts','SELECT','auth.uid() = user_id',NULL),
    ('email_contacts','Users can insert own contacts','INSERT',NULL,'auth.uid() = user_id'),
    ('email_contacts','Users can update own contacts','UPDATE','auth.uid() = user_id',NULL),
    ('email_contacts','Users can delete own contacts','DELETE','auth.uid() = user_id',NULL),
    ('email_signatures','Users can view own signatures','SELECT','auth.uid() = user_id',NULL),
    ('email_signatures','Users can insert own signatures','INSERT',NULL,'auth.uid() = user_id'),
    ('email_signatures','Users can update own signatures','UPDATE','auth.uid() = user_id',NULL),
    ('email_signatures','Users can delete own signatures','DELETE','auth.uid() = user_id',NULL),
    ('email_jobs','Users can view own jobs','SELECT','auth.uid() = user_id',NULL),
    ('email_jobs','Users can insert own jobs','INSERT',NULL,'auth.uid() = user_id'),
    ('email_jobs','Users can update own jobs','UPDATE','auth.uid() = user_id',NULL),
    ('email_schedules','Users can view own schedules','SELECT','auth.uid() = user_id',NULL),
    ('email_schedules','Users can insert own schedules','INSERT',NULL,'auth.uid() = user_id'),
    ('email_schedules','Users can delete own schedules','DELETE','auth.uid() = user_id',NULL),
    ('email_audit_logs','Users can view own audit logs','SELECT','auth.uid() = user_id',NULL),
    ('email_audit_logs','Users can insert own audit logs','INSERT',NULL,'auth.uid() = user_id'),
    ('email_audit_logs','Users can update own audit logs','UPDATE','auth.uid() = user_id',NULL),
    ('email_confirmations','Users can view own confirmations','SELECT','auth.uid() = user_id',NULL),
    ('email_confirmations','Users can insert own confirmations','INSERT',NULL,'auth.uid() = user_id'),
    ('email_confirmations','Users can update own confirmations','UPDATE','auth.uid() = user_id',NULL),
    ('email_confirmations','Users can delete own confirmations','DELETE','auth.uid() = user_id',NULL),
    ('sent_emails','Users can view own sent emails','SELECT','auth.uid() = user_id',NULL),
    ('student_courses','Users can view own courses','SELECT','auth.uid() = user_id',NULL),
    ('student_courses','Users can insert own courses','INSERT',NULL,'auth.uid() = user_id'),
    ('student_courses','Users can update own courses','UPDATE','auth.uid() = user_id',NULL),
    ('student_courses','Users can delete own courses','DELETE','auth.uid() = user_id',NULL),
    ('course_resources','Users can view resources in own courses','SELECT','EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid())',NULL),
    ('course_resources','Users can insert resources in own courses','INSERT',NULL,'EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid())'),
    ('course_resources','Users can delete resources in own courses','DELETE','EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid())',NULL),
    ('users','Users can view own profile','SELECT','auth.uid() = id',NULL),
    ('users','Users can insert own profile','INSERT',NULL,'auth.uid() = id'),
    ('users','Users can update own profile','UPDATE','auth.uid() = id',NULL),
    ('public_profiles','Users can view own profile','SELECT','auth.uid() = id',NULL),
    ('public_profiles','Users can insert own profile','INSERT',NULL,'auth.uid() = id'),
    ('public_profiles','Users can update own profile','UPDATE','auth.uid() = id',NULL)
  ) AS t(tab, pname, cmd, qual, wc)
  LOOP
    IF to_regclass(format('public.%I', r.tab)) IS NULL THEN CONTINUE; END IF;
    -- Re-create under the stricter TO authenticated scope (live policies
    -- were TO public; drop-then-create keeps the migration idempotent).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pname, r.tab);
    IF r.cmd = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', r.pname, r.tab, r.qual);
    ELSIF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', r.pname, r.tab, r.wc);
    ELSIF r.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s)', r.pname, r.tab, r.qual);
    ELSIF r.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', r.pname, r.tab, r.qual);
    END IF;
  END LOOP;
END $$;

-- public_profiles: intentionally public read (profiles are meant to be browsable).
DO $$
BEGIN
  IF to_regclass('public.public_profiles') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='public_profiles' AND policyname='Anyone can view profiles') THEN
      CREATE POLICY "Anyone can view profiles" ON public.public_profiles FOR SELECT TO public USING (true);
    END IF;
  END IF;
END $$;
