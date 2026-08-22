-- Migration 030: Calendar security (RLS) + real recurrence support
--
-- SECURITY: the three calendar tables previously had NO RLS policies while
-- the frontend reads/writes them directly with the user's anon JWT — any
-- authenticated user could enumerate or mutate another user's events.
-- This enables RLS and restricts every table to its owner. Attendees have no
-- user_id column, so their policy routes ownership through the parent event.
--
-- RECURRENCE: adds is_recurring / recurrence_rule so repeating events created
-- by SchedulingPanel actually persist (the form already sends RRULE strings;
-- nothing stored them). Expansion to concrete occurrences is done client-side
-- over the visible range by expandRecurringEvents().

-- ── Recurrence columns ──────────────────────────────────────────────────────
ALTER TABLE user_calendar_events
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE user_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendar_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendar_settings ENABLE ROW LEVEL SECURITY;

-- (select auth.uid()) wraps the call in an InitPlan so it evaluates once per
-- statement instead of per row — silences the auth_rls_initplan advisor.
CREATE POLICY "Users can manage their own calendar events" ON user_calendar_events
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Attendees managed via parent event owner" ON user_calendar_attendees
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_calendar_events e
      WHERE e.id = event_id AND e.user_id = (select auth.uid())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_calendar_events e
      WHERE e.id = event_id AND e.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users can manage their own calendar settings" ON user_calendar_settings
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
