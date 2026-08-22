-- Migration 029: Tasks — personal task management alongside calendar events.
--
-- user_tasks: tasks/to-dos the assistant can fully manage through its task
-- tools (create/update/complete/delete/list). A task may optionally be linked
-- to a calendar event (linked_event_id) when it is scheduled on the calendar;
-- unlinking happens automatically if the event is deleted.

CREATE TABLE IF NOT EXISTS user_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date TIMESTAMPTZ,
  linked_event_id UUID REFERENCES user_calendar_events(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_user_status
  ON user_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_tasks_user_due
  ON user_tasks(user_id, due_date ASC);
CREATE INDEX IF NOT EXISTS idx_user_tasks_linked_event
  ON user_tasks(linked_event_id);

ALTER TABLE user_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own tasks" ON user_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
