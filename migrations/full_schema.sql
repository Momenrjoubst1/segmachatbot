-- ==========================================
-- Full Schema Migration for Chatbot Project
-- ==========================================
-- نسخ هذا الملف والصقه في SQL Editor في مشروع Supabase الجديد
-- ==========================================

-- 0. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================
-- 1. DOCUMENTS (RAG Embeddings)
-- ==========================================
CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  content TEXT,
  metadata JSONB,
  embedding VECTOR(768)
);

-- Match Documents Function (Cosine Similarity Search)
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- ==========================================
-- 2. CHAT SESSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'محادثة جديدة',
  course_id UUID,
  parent_thread_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  branched_from_message_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 3. CHAT MESSAGES
-- ==========================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT FALSE,
  feedback SMALLINT CHECK (feedback IN (-1, 1)),
  parent_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 4. BANNED USERS
-- ==========================================
CREATE TABLE IF NOT EXISTS banned_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  banned_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 5. USERS
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_url TEXT,
  cover_url TEXT,
  is_verified BOOLEAN DEFAULT FALSE
);

-- ==========================================
-- 6. PUBLIC PROFILES
-- ==========================================
CREATE TABLE IF NOT EXISTS public_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_url TEXT
);

-- ==========================================
-- 7. EMAIL CONTACTS
-- ==========================================
CREATE TABLE IF NOT EXISTS email_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  display_name TEXT,
  notes TEXT,
  is_favorite BOOLEAN DEFAULT FALSE,
  email_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 8. EMAIL SIGNATURES
-- ==========================================
CREATE TABLE IF NOT EXISTS email_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 9. EMAIL CONFIRMATIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS email_confirmations (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  to_address TEXT,
  subject TEXT,
  body TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- ==========================================
-- 10. EMAIL AUDIT LOGS
-- ==========================================
CREATE TABLE IF NOT EXISTS email_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipients TEXT[] NOT NULL,
  cc TEXT[],
  bcc_count INTEGER DEFAULT 0,
  subject TEXT NOT NULL,
  body_preview TEXT,
  storage_path TEXT,
  provider TEXT DEFAULT 'smtp',
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  recipient_count INTEGER DEFAULT 0,
  delivery_mode TEXT DEFAULT 'bcc' CHECK (delivery_mode IN ('bcc', 'individual')),
  job_id TEXT,
  read_count INTEGER DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 11. EMAIL JOBS
-- ==========================================
CREATE TABLE IF NOT EXISTS email_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_address TEXT NOT NULL,
  cc_addresses TEXT[],
  bcc_addresses TEXT[],
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  html TEXT,
  provider TEXT DEFAULT 'smtp',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  next_retry_at TIMESTAMPTZ
);

-- ==========================================
-- 12. EMAIL SCHEDULES
-- ==========================================
CREATE TABLE IF NOT EXISTS email_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  html TEXT,
  cc_addresses TEXT[],
  bcc_addresses TEXT[],
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  provider TEXT,
  job_id TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- ==========================================
-- 13. SENT EMAILS
-- ==========================================
CREATE TABLE IF NOT EXISTS sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 14. USER CALENDAR EVENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS user_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT FALSE,
  color TEXT DEFAULT '#3B82F6',
  provider TEXT DEFAULT 'local',
  external_id TEXT,
  external_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 15. USER CALENDAR ATTENDEES
-- ==========================================
CREATE TABLE IF NOT EXISTS user_calendar_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES user_calendar_events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'tentative'))
);

-- ==========================================
-- 16. USER CALENDAR SETTINGS
-- ==========================================
CREATE TABLE IF NOT EXISTS user_calendar_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_calendar_id TEXT,
  google_refresh_token TEXT,
  working_hours_start TEXT DEFAULT '09:00',
  working_hours_end TEXT DEFAULT '17:00',
  working_days INTEGER[] DEFAULT '{0,1,2,3,4}',
  timezone TEXT DEFAULT 'Asia/Amman'
);

-- ==========================================
-- 17. ANALYTICS EVENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id TEXT,
  tokens_used INTEGER,
  response_time_ms INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 18. ANALYTICS DAILY METRICS
-- ==========================================
CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
  date DATE PRIMARY KEY,
  total_conversations INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  avg_response_time_ms NUMERIC DEFAULT 0,
  feedback_avg_score NUMERIC DEFAULT 0,
  estimated_cost_usd NUMERIC DEFAULT 0,
  active_users INTEGER DEFAULT 0,
  top_models JSONB DEFAULT '[]'::jsonb
);

-- ==========================================
-- 19. AGENT CONVERSATION EVENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS agent_conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name TEXT NOT NULL,
  identity TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  turn_id TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 20. USER MEMORY
-- ==========================================
CREATE TABLE IF NOT EXISTS user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('personal', 'academic', 'preference', 'context', 'goal', 'schedule', 'behavior')),
  key TEXT NOT NULL,
  value JSONB,
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT DEFAULT 'extracted' CHECK (source IN ('extracted', 'explicit', 'inferred')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB,
  UNIQUE(user_id, key)
);

-- ==========================================
-- 21. STUDENT COURSES
-- ==========================================
CREATE TABLE IF NOT EXISTS student_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_name TEXT NOT NULL,
  credit_hours INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 22. COURSE RESOURCES
-- ==========================================
CREATE TABLE IF NOT EXISTS course_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES student_courses(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 23. FEEDBACK
-- ==========================================
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_email_contacts_user ON email_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_contacts_email ON email_contacts(user_id, email_address);
CREATE INDEX IF NOT EXISTS idx_email_signatures_user ON email_signatures(user_id);
CREATE INDEX IF NOT EXISTS idx_email_confirmations_user ON email_confirmations(user_id);
CREATE INDEX IF NOT EXISTS idx_email_audit_logs_user ON email_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_jobs_user ON email_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_schedules_user ON email_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_user ON sent_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON user_calendar_events(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_attendees_event ON user_calendar_attendees(event_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_room ON agent_conversation_events(room_name, created_at);
CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id, category);
CREATE INDEX IF NOT EXISTS idx_user_memory_unique ON user_memory(user_id, key);
CREATE INDEX IF NOT EXISTS idx_student_courses_user ON student_courses(user_id);
CREATE INDEX IF NOT EXISTS idx_course_resources_course ON course_resources(course_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_banned_users_active ON banned_users(user_id) WHERE is_active = TRUE;

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendar_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- RLS POLICIES
-- ==========================================

-- Chat Sessions
CREATE POLICY "Users can view own sessions" ON chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON chat_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON chat_sessions FOR DELETE USING (auth.uid() = user_id);

-- Chat Messages (via session ownership)
CREATE POLICY "Users can view messages in own sessions" ON chat_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM chat_sessions WHERE chat_sessions.id = chat_messages.session_id AND chat_sessions.user_id = auth.uid()));
CREATE POLICY "Users can insert messages in own sessions" ON chat_messages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM chat_sessions WHERE chat_sessions.id = chat_messages.session_id AND chat_sessions.user_id = auth.uid()));
CREATE POLICY "Users can update messages in own sessions" ON chat_messages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM chat_sessions WHERE chat_sessions.id = chat_messages.session_id AND chat_sessions.user_id = auth.uid()));

-- Users
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- Public Profiles (viewable by all, editable by owner)
CREATE POLICY "Anyone can view profiles" ON public_profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public_profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Email Contacts
CREATE POLICY "Users can view own contacts" ON email_contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON email_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON email_contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON email_contacts FOR DELETE USING (auth.uid() = user_id);

-- Email Signatures
CREATE POLICY "Users can view own signatures" ON email_signatures FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own signatures" ON email_signatures FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own signatures" ON email_signatures FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own signatures" ON email_signatures FOR DELETE USING (auth.uid() = user_id);

-- Email Confirmations
CREATE POLICY "Users can view own confirmations" ON email_confirmations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own confirmations" ON email_confirmations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own confirmations" ON email_confirmations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own confirmations" ON email_confirmations FOR DELETE USING (auth.uid() = user_id);

-- Email Audit Logs
CREATE POLICY "Users can view own audit logs" ON email_audit_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own audit logs" ON email_audit_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own audit logs" ON email_audit_logs FOR UPDATE USING (auth.uid() = user_id);

-- Email Jobs
CREATE POLICY "Users can view own jobs" ON email_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own jobs" ON email_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own jobs" ON email_jobs FOR UPDATE USING (auth.uid() = user_id);

-- Email Schedules
CREATE POLICY "Users can view own schedules" ON email_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own schedules" ON email_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own schedules" ON email_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own schedules" ON email_schedules FOR DELETE USING (auth.uid() = user_id);

-- Sent Emails
CREATE POLICY "Users can view own sent emails" ON sent_emails FOR SELECT USING (auth.uid() = user_id);

-- Calendar Events
CREATE POLICY "Users can view own events" ON user_calendar_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own events" ON user_calendar_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own events" ON user_calendar_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own events" ON user_calendar_events FOR DELETE USING (auth.uid() = user_id);

-- Calendar Attendees (via event ownership)
CREATE POLICY "Users can view attendees in own events" ON user_calendar_attendees FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_calendar_events WHERE user_calendar_events.id = user_calendar_attendees.event_id AND user_calendar_events.user_id = auth.uid()));
CREATE POLICY "Users can insert attendees in own events" ON user_calendar_attendees FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_calendar_events WHERE user_calendar_events.id = user_calendar_attendees.event_id AND user_calendar_events.user_id = auth.uid()));
CREATE POLICY "Users can delete attendees in own events" ON user_calendar_attendees FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_calendar_events WHERE user_calendar_events.id = user_calendar_attendees.event_id AND user_calendar_events.user_id = auth.uid()));

-- Calendar Settings
CREATE POLICY "Users can view own settings" ON user_calendar_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON user_calendar_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON user_calendar_settings FOR UPDATE USING (auth.uid() = user_id);

-- Analytics Events
CREATE POLICY "Users can view own analytics" ON analytics_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own analytics" ON analytics_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Analytics Daily Metrics (admin read only, insert via service role)
CREATE POLICY "Service role can manage metrics" ON analytics_daily_metrics FOR ALL USING (true);

-- Agent Conversation Events (service role only)
CREATE POLICY "Service role can manage agent events" ON agent_conversation_events FOR ALL USING (true);

-- User Memory
CREATE POLICY "Users can view own memory" ON user_memory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own memory" ON user_memory FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own memory" ON user_memory FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own memory" ON user_memory FOR DELETE USING (auth.uid() = user_id);

-- Student Courses
CREATE POLICY "Users can view own courses" ON student_courses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own courses" ON student_courses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own courses" ON student_courses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own courses" ON student_courses FOR DELETE USING (auth.uid() = user_id);

-- Course Resources (via course ownership)
CREATE POLICY "Users can view resources in own courses" ON course_resources FOR SELECT
  USING (EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid()));
CREATE POLICY "Users can insert resources in own courses" ON course_resources FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid()));
CREATE POLICY "Users can delete resources in own courses" ON course_resources FOR DELETE
  USING (EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid()));

-- Feedback
CREATE POLICY "Users can view own feedback" ON feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own feedback" ON feedback FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Banned Users (service role check, read via middleware)
CREATE POLICY "Service role can manage bans" ON banned_users FOR ALL USING (true);

-- ==========================================
-- STORAGE BUCKETS
-- ==========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('chat_media', 'chat_media', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('email-bodies', 'email-bodies', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('course-attachments', 'course-attachments', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage Policies
CREATE POLICY "Users can upload chat media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat_media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Anyone can view chat media" ON storage.objects FOR SELECT USING (bucket_id = 'chat_media');
CREATE POLICY "Users can upload email bodies" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'email-bodies' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own email bodies" ON storage.objects FOR SELECT USING (bucket_id = 'email-bodies' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload course attachments" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'course-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Anyone can view course attachments" ON storage.objects FOR SELECT USING (bucket_id = 'course-attachments');
