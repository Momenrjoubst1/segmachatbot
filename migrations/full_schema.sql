-- ==========================================
-- Full Schema — Canonical Reference
-- ==========================================
-- This file reflects the database state AFTER all 19 migrations.
-- It is a REFERENCE DOCUMENT — do NOT apply it directly.
-- Use numbered migration files (001-019) for applying changes.
-- ==========================================
-- Last updated: migration 019_fix_vector_dim_and_indexes
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
  embedding VECTOR(9692)
);

CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw
ON documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_documents_metadata ON documents USING gin(metadata);

-- NOTE: match_documents function still uses VECTOR(768) signature (from 001).
-- This is a known mismatch — the column is VECTOR(9692) but the RPC was never updated.

-- ==========================================
-- 2. CHAT SESSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New Chat',
  course_id UUID,
  parent_thread_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  branched_from_message_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);

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

CREATE INDEX IF NOT EXISTS idx_banned_users_active ON banned_users(user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_banned_users_active_expires ON banned_users(user_id, expires_at) WHERE is_active = TRUE;

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

CREATE INDEX IF NOT EXISTS idx_email_contacts_user ON email_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_contacts_email ON email_contacts(user_id, email_address);

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

CREATE INDEX IF NOT EXISTS idx_email_signatures_user ON email_signatures(user_id);

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

CREATE INDEX IF NOT EXISTS idx_email_confirmations_user ON email_confirmations(user_id);
CREATE INDEX IF NOT EXISTS idx_email_confirmations_expires ON email_confirmations(expires_at) WHERE expires_at IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_email_audit_logs_user ON email_audit_logs(user_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_email_jobs_user ON email_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_jobs_status_retry ON email_jobs(status, next_retry_at) WHERE status = 'pending';

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

CREATE INDEX IF NOT EXISTS idx_email_schedules_user ON email_schedules(user_id);

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

CREATE INDEX IF NOT EXISTS idx_sent_emails_user ON sent_emails(user_id);

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

CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON user_calendar_events(user_id, start_time);

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

CREATE INDEX IF NOT EXISTS idx_calendar_attendees_event ON user_calendar_attendees(event_id);

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

CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);

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

CREATE INDEX IF NOT EXISTS idx_agent_events_room ON agent_conversation_events(room_name, created_at);

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

CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id, category);
CREATE INDEX IF NOT EXISTS idx_user_memory_unique ON user_memory(user_id, key);
CREATE INDEX IF NOT EXISTS idx_user_memory_user_expires ON user_memory(user_id, expires_at) WHERE expires_at IS NOT NULL;

-- ==========================================
-- 21. CUSTOM INSTRUCTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS custom_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 22. STUDENT COURSES
-- ==========================================
CREATE TABLE IF NOT EXISTS student_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_name TEXT NOT NULL,
  credit_hours INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_courses_user ON student_courses(user_id);

-- ==========================================
-- 23. COURSE RESOURCES
-- ==========================================
CREATE TABLE IF NOT EXISTS course_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES student_courses(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_resources_course ON course_resources(course_id);

-- ==========================================
-- 24. FEEDBACK
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

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
-- ==========================================
-- 25. TEXTBOOKS (BYOC feature)
-- ==========================================
CREATE TABLE IF NOT EXISTS textbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES student_courses(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size_bytes BIGINT,
  total_pages INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress JSONB DEFAULT '{}',
  error TEXT,
  structure_tree JSONB,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  book_language TEXT DEFAULT NULL CHECK (book_language IS NULL OR book_language IN ('ar', 'en', 'mixed')),
  source_thread_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_textbooks_user ON textbooks(user_id);
CREATE INDEX IF NOT EXISTS idx_textbooks_hash ON textbooks(file_hash);
CREATE INDEX IF NOT EXISTS idx_textbooks_status ON textbooks(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_textbooks_user_hash_unique
ON textbooks(user_id, file_hash) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_textbooks_source_thread ON textbooks(source_thread_id) WHERE source_thread_id IS NOT NULL;

-- ==========================================
-- 26. TEXTBOOK CHUNKS
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_chunks (
  id BIGSERIAL PRIMARY KEY,
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  structure_path TEXT,
  content TEXT NOT NULL,
  embedding VECTOR(9692),
  figure_refs JSONB DEFAULT '[]'::jsonb,
  content_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', normalize_arabic(content))
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  block_role TEXT DEFAULT NULL,
  text_color TEXT DEFAULT NULL,
  chunk_bbox JSONB DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_textbook ON textbook_chunks(textbook_id, page_number);
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_structure ON textbook_chunks(textbook_id, structure_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_textbook_chunks_content_unique
ON textbook_chunks(textbook_id, page_number, left(content, 100));
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_embedding_hnsw
ON textbook_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_tsv ON textbook_chunks USING gin(content_tsv);
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_user_textbook ON textbook_chunks(textbook_id) INCLUDE (user_id);

-- ==========================================
-- 27. TEXTBOOK FIGURES
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_figures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  figure_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  caption TEXT,
  image_url TEXT NOT NULL,
  bounding_box JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  vlm_description TEXT DEFAULT NULL,
  dominant_colors JSONB DEFAULT NULL,
  is_colored BOOLEAN DEFAULT NULL,
  kind TEXT DEFAULT 'raster' CHECK (kind IS NULL OR kind IN ('raster', 'vector'))
);

CREATE INDEX IF NOT EXISTS idx_textbook_figures_textbook ON textbook_figures(textbook_id, page_number);

-- ==========================================
-- 28. TEXTBOOK PAGES
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  width FLOAT8 NOT NULL DEFAULT 0,
  height FLOAT8 NOT NULL DEFAULT 0,
  background_color TEXT NOT NULL DEFAULT '#FFFFFF',
  page_role TEXT NOT NULL DEFAULT 'interior'
    CHECK (page_role IN ('cover_front', 'interior', 'cover_back', 'blank')),
  page_type TEXT NOT NULL DEFAULT 'text_only'
    CHECK (page_type IN ('blank', 'text_only', 'mixed', 'figure_only', 'table_heavy', 'toc', 'index', 'cover')),
  dominant_script TEXT NOT NULL DEFAULT 'en'
    CHECK (dominant_script IN ('ar', 'en', 'mixed')),
  approximate_columns INT NOT NULL DEFAULT 1,
  layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (textbook_id, page_number),
  vlm_summary TEXT DEFAULT NULL,
  vlm_enriched BOOLEAN NOT NULL DEFAULT false,
  thumbnail_key TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_textbook_pages_textbook ON textbook_pages(textbook_id, page_number);
CREATE INDEX IF NOT EXISTS idx_textbook_pages_needs_visual ON textbook_pages(textbook_id) WHERE vlm_enriched = false;

-- ==========================================
-- 29. TEXTBOOK SECTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES textbook_sections(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('unit', 'lesson', 'topic')),
  title TEXT NOT NULL,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_textbook_sections_book ON textbook_sections(textbook_id, order_index);

-- ==========================================
-- 30. TEXTBOOK QUESTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL DEFAULT 'lesson_questions'
    CHECK (question_type IN ('lesson_questions', 'unit_questions')),
  number TEXT,
  text TEXT NOT NULL,
  page_number INT,
  section_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_textbook_questions_book ON textbook_questions(textbook_id);

-- ==========================================
-- 31. TEXTBOOK GLOSSARY
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_glossary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  definition TEXT,
  page_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_textbook_glossary_book ON textbook_glossary(textbook_id);
-- ==========================================
-- VIEWS
-- ==========================================
CREATE OR REPLACE VIEW chat_sessions_with_messages
WITH (security_invoker = true) AS
SELECT cs.id, cs.user_id, cs.title, cs.updated_at, cs.course_id
FROM chat_sessions cs
WHERE EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.session_id = cs.id);

-- ==========================================
-- FUNCTIONS
-- ==========================================

-- Arabic normalization (011)
CREATE OR REPLACE FUNCTION normalize_arabic(text TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  result TEXT;
BEGIN
  result := text;
  result := regexp_replace(result, '\u0640', '', 'g');
  result := regexp_replace(result, '[\u0622\u0623\u0625]', '\u0627', 'g');
  result := regexp_replace(result, '\u0629', '\u0647', 'g');
  result := regexp_replace(result, '\u0649', '\u064A', 'g');
  result := regexp_replace(result, '[\u064B-\u065F]', '', 'g');
  result := regexp_replace(result, '(^| )ال', '\1', 'g');
  RETURN result;
END;
$$;

-- bump_session_updated_at trigger (008b)
CREATE OR REPLACE FUNCTION bump_session_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_bump_session_updated_at
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION bump_session_updated_at();

-- match_textbook_chunks (019 - VECTOR(9692))
CREATE OR REPLACE FUNCTION match_textbook_chunks (
  query_embedding VECTOR(9692),
  p_textbook_id UUID,
  p_match_threshold FLOAT DEFAULT 0.05,
  p_match_count INT DEFAULT 10,
  p_page_start INT DEFAULT NULL,
  p_page_end INT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  textbook_id UUID,
  page_number INT,
  structure_path TEXT,
  content TEXT,
  figure_refs JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT tc.id, tc.textbook_id, tc.page_number, tc.structure_path, tc.content, tc.figure_refs,
    1 - (tc.embedding <=> query_embedding) AS similarity
  FROM textbook_chunks tc
  WHERE tc.textbook_id = p_textbook_id
    AND tc.embedding IS NOT NULL
    AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
    AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    AND 1 - (tc.embedding <=> query_embedding) > p_match_threshold
  ORDER BY tc.embedding <=> query_embedding LIMIT p_match_count;
$$;

-- hybrid_search_textbook_chunks (014 - VECTOR(9692), with user_id scoping)
CREATE OR REPLACE FUNCTION hybrid_search_textbook_chunks(
  query_embedding VECTOR(9692),
  query_text TEXT,
  p_textbook_id UUID,
  p_user_id UUID,
  p_match_threshold FLOAT DEFAULT 0.4,
  p_match_count INT DEFAULT 10,
  p_page_start INT DEFAULT NULL,
  p_page_end INT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  textbook_id UUID,
  page_number INTEGER,
  structure_path TEXT,
  content TEXT,
  figure_refs JSONB,
  similarity FLOAT,
  bm25_score FLOAT,
  final_score FLOAT
)
LANGUAGE sql STABLE
AS $$
  WITH normalized_query AS (
    SELECT normalize_arabic(query_text) AS query_text
  ),
  vector_results AS (
    SELECT
      tc.id, tc.textbook_id, tc.page_number, tc.structure_path, tc.content, tc.figure_refs,
      1 - (tc.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY 1 - (tc.embedding <=> query_embedding) DESC) AS rank
    FROM textbook_chunks tc
    WHERE tc.textbook_id = p_textbook_id
      AND tc.user_id = p_user_id
      AND tc.embedding IS NOT NULL
      AND 1 - (tc.embedding <=> query_embedding) > p_match_threshold
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    ORDER BY similarity DESC LIMIT 20
  ),
  bm25_results AS (
    SELECT
      tc.id, tc.textbook_id, tc.page_number, tc.structure_path, tc.content, tc.figure_refs,
      ts_rank_cd(tc.content_tsv, plainto_tsquery('simple', nq.query_text)) AS bm25_score,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tc.content_tsv, plainto_tsquery('simple', nq.query_text)) DESC) AS rank
    FROM textbook_chunks tc
    CROSS JOIN normalized_query nq
    WHERE tc.textbook_id = p_textbook_id
      AND tc.user_id = p_user_id
      AND tc.content_tsv @@ plainto_tsquery('simple', nq.query_text)
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    ORDER BY bm25_score DESC LIMIT 20
  ),
  trgm_results AS (
    SELECT
      tc.id, tc.textbook_id, tc.page_number, tc.structure_path, tc.content, tc.figure_refs,
      similarity(tc.content, nq.query_text) AS trgm_score,
      ROW_NUMBER() OVER (ORDER BY similarity(tc.content, nq.query_text) DESC) AS rank
    FROM textbook_chunks tc
    CROSS JOIN normalized_query nq
    WHERE tc.textbook_id = p_textbook_id
      AND tc.user_id = p_user_id
      AND tc.content % nq.query_text
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    ORDER BY trgm_score DESC LIMIT 20
  ),
  combined AS (
    SELECT v.id, v.textbook_id, v.page_number, v.structure_path, v.content, v.figure_refs,
      v.similarity, COALESCE(b.bm25_score, 0) AS bm25_score,
      COALESCE(t.trgm_score, 0) AS trgm_score,
      (1.0 / (60 + v.rank)) AS rrf_vector, 0.0 AS rrf_bm25, 0.0 AS rrf_trgm
    FROM vector_results v
    LEFT JOIN bm25_results b ON v.id = b.id
    LEFT JOIN trgm_results t ON v.id = t.id
    UNION
    SELECT b.id, b.textbook_id, b.page_number, b.structure_path, b.content, b.figure_refs,
      COALESCE(v.similarity, 0) AS similarity, b.bm25_score,
      COALESCE(t.trgm_score, 0) AS trgm_score,
      0.0 AS rrf_vector, (1.0 / (60 + b.rank)) AS rrf_bm25, 0.0 AS rrf_trgm
    FROM bm25_results b
    LEFT JOIN vector_results v ON b.id = v.id
    LEFT JOIN trgm_results t ON b.id = t.id
    WHERE v.id IS NULL
    UNION
    SELECT t.id, t.textbook_id, t.page_number, t.structure_path, t.content, t.figure_refs,
      COALESCE(v.similarity, 0) AS similarity, COALESCE(b.bm25_score, 0) AS bm25_score,
      t.trgm_score,
      0.0 AS rrf_vector, 0.0 AS rrf_bm25, (1.0 / (60 + t.rank)) AS rrf_trgm
    FROM trgm_results t
    LEFT JOIN vector_results v ON t.id = v.id
    LEFT JOIN bm25_results b ON t.id = b.id
    WHERE v.id IS NULL AND b.id IS NULL
  ),
  scored AS (
    SELECT *,
      GREATEST(0, LEAST(1, similarity)) AS norm_vector,
      CASE WHEN bm25_score > 0 THEN LEAST(1, bm25_score / (bm25_score + 1)) ELSE 0 END AS norm_bm25,
      CASE WHEN trgm_score > 0 THEN LEAST(1, trgm_score) ELSE 0 END AS norm_trgm,
      (rrf_vector + rrf_bm25 + rrf_trgm) AS rrf_score
    FROM combined
  ),
  final_scored AS (
    SELECT *, (0.4 * norm_vector + 0.35 * norm_bm25 + 0.25 * norm_trgm) AS combined_score FROM scored
  )
  SELECT id, textbook_id, page_number, structure_path, content, figure_refs,
    similarity, bm25_score,
    (0.6 * combined_score + 0.4 * rrf_score) AS final_score
  FROM final_scored
  ORDER BY final_score DESC
  LIMIT p_match_count;
$$;

-- batch_update_embeddings (014 - scoped by textbook_id)
CREATE OR REPLACE FUNCTION batch_update_embeddings(
  p_updates JSONB,
  p_textbook_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item JSONB;
BEGIN
  FOR item IN SELECT jsonb_array_elements(p_updates)
  LOOP
    UPDATE textbook_chunks
    SET embedding = (item->>'embedding')::vector(9692)
    WHERE id = (item->>'id')::bigint
      AND textbook_id = p_textbook_id;
  END LOOP;
END;
$$;

-- ANALYZE after bulk embedding: pgvector needs fresh stats for HNSW queries
CREATE OR REPLACE FUNCTION analyze_textbook_chunks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  ANALYZE textbook_chunks;
END;
$$;

-- pg_trgm for Arabic morphological similarity (supplements BM25 term-matching)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_content_trgm
ON textbook_chunks USING gin (content gin_trgm_ops);
-- ==========================================
-- ROW-LEVEL SECURITY POLICIES
-- ==========================================
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_glossary ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversation_events ENABLE ROW LEVEL SECURITY;

-- chat_sessions: users manage own sessions
CREATE POLICY "Users can view their own sessions" ON chat_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own sessions" ON chat_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sessions" ON chat_sessions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sessions" ON chat_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- chat_messages: users manage own messages
CREATE POLICY "Users can view their own messages" ON chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_sessions WHERE chat_sessions.id = chat_messages.session_id
      AND chat_sessions.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert messages in their own sessions" ON chat_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sessions WHERE chat_sessions.id = chat_messages.session_id
      AND chat_sessions.user_id = auth.uid()
    )
  );

-- user_memory: users manage own data
CREATE POLICY "Users can view their own memory" ON user_memory
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own memory" ON user_memory
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own memory" ON user_memory
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own memory" ON user_memory
  FOR DELETE USING (auth.uid() = user_id);

-- email_contacts: users manage own contacts
CREATE POLICY "Users can view their own contacts" ON email_contacts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own contacts" ON email_contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own contacts" ON email_contacts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own contacts" ON email_contacts
  FOR DELETE USING (auth.uid() = user_id);

-- email_signatures: users manage own signatures
CREATE POLICY "Users can view their own signatures" ON email_signatures
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own signatures" ON email_signatures
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own signatures" ON email_signatures
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own signatures" ON email_signatures
  FOR DELETE USING (auth.uid() = user_id);

-- email_jobs: users manage own jobs
CREATE POLICY "Users can view their own jobs" ON email_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own jobs" ON email_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- email_schedules: users manage own schedules
CREATE POLICY "Users can view their own schedules" ON email_schedules
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own schedules" ON email_schedules
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own schedules" ON email_schedules
  FOR DELETE USING (auth.uid() = user_id);

-- email_audit_logs: users view own logs
CREATE POLICY "Users can view their own audit logs" ON email_audit_logs
  FOR SELECT USING (auth.uid() = user_id);

-- analytics_events: users view own events
CREATE POLICY "Users can view their own events" ON analytics_events
  FOR SELECT USING (auth.uid() = user_id);

-- textbooks: users manage own textbooks
CREATE POLICY "Users can view their own textbooks" ON textbooks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own textbooks" ON textbooks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own textbooks" ON textbooks
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own textbooks" ON textbooks
  FOR DELETE USING (auth.uid() = user_id);

-- textbook_chunks: users access own textbook chunks
CREATE POLICY "Users can view chunks from own textbooks" ON textbook_chunks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert chunks into own textbooks" ON textbook_chunks
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can update chunks in own textbooks" ON textbook_chunks
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can delete chunks from own textbooks" ON textbook_chunks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );

-- textbook_figures: users access own textbook figures
CREATE POLICY "Users can view figures from own textbooks" ON textbook_figures
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert figures into own textbooks" ON textbook_figures
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can update figures in own textbooks" ON textbook_figures
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can delete figures from own textbooks" ON textbook_figures
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );

-- textbook_pages: users access own textbook pages
CREATE POLICY "Users can view pages from own textbooks" ON textbook_pages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_pages.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert pages into own textbooks" ON textbook_pages
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_pages.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can update pages in own textbooks" ON textbook_pages
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_pages.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can delete pages from own textbooks" ON textbook_pages
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_pages.textbook_id AND textbooks.user_id = auth.uid())
  );

-- textbook_sections: users access own textbook sections
CREATE POLICY "Users can view sections from own textbooks" ON textbook_sections
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert sections into own textbooks" ON textbook_sections
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can update sections in own textbooks" ON textbook_sections
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can delete sections from own textbooks" ON textbook_sections
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid())
  );

-- textbook_questions: users access own textbook questions
CREATE POLICY "Users can view questions from own textbooks" ON textbook_questions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_questions.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert questions into own textbooks" ON textbook_questions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_questions.textbook_id AND textbooks.user_id = auth.uid())
  );

-- textbook_glossary: users access own textbook glossary
CREATE POLICY "Users can view glossary from own textbooks" ON textbook_glossary
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_glossary.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert glossary into own textbooks" ON textbook_glossary
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_glossary.textbook_id AND textbooks.user_id = auth.uid())
  );

-- custom_instructions: users manage own instructions
CREATE POLICY "Users can view their own instructions" ON custom_instructions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own instructions" ON custom_instructions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own instructions" ON custom_instructions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own instructions" ON custom_instructions
  FOR DELETE USING (auth.uid() = user_id);

-- student_courses: users manage own courses
CREATE POLICY "Users can view their own courses" ON student_courses
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own courses" ON student_courses
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own courses" ON student_courses
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own courses" ON student_courses
  FOR DELETE USING (auth.uid() = user_id);

-- course_resources: users access own course resources
CREATE POLICY "Users can view resources for their courses" ON course_resources
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid())
  );
CREATE POLICY "Users can insert resources for their courses" ON course_resources
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM student_courses WHERE student_courses.id = course_resources.course_id AND student_courses.user_id = auth.uid())
  );

-- feedback: users manage own feedback
CREATE POLICY "Users can view their own feedback" ON feedback
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own feedback" ON feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- agent_conversation_events: users access own room events
CREATE POLICY "Users can view events in their own rooms" ON agent_conversation_events
  FOR SELECT USING (room_name LIKE auth.uid() || ':%');
CREATE POLICY "Users can insert events in their own rooms" ON agent_conversation_events
  FOR INSERT WITH CHECK (room_name LIKE auth.uid() || ':%');
-- ==========================================
-- STORAGE BUCKETS & POLICIES
-- ==========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-attachments', 'profile-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Agents: read/write own folder
CREATE POLICY "agents: read own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agents' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "agents: insert own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agents' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "agents: update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agents' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "agents: delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agents' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Agent avatars: read/write own folder
CREATE POLICY "agent-avatars: read own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agent-avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "agent-avatars: insert own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agent-avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "agent-avatars: update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agent-avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "agent-avatars: delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'agent-avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Avatars: read/write own folder (009)
CREATE POLICY "avatars: read own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "avatars: insert own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "avatars: update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "avatars: delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'avatars' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- User uploads: read/write own folder
CREATE POLICY "user_uploads: read own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'user-uploads' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "user_uploads: insert own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'user-uploads' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "user_uploads: update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'user-uploads' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "user_uploads: delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'user-uploads' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Covers: public read, owner write
CREATE POLICY "covers: public read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'covers'
  );
CREATE POLICY "covers: insert own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'covers' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "covers: update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'covers' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "covers: delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'covers' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );

-- Textbooks: read/write own folder
CREATE POLICY "textbooks: read own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'textbooks' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "textbooks: insert own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'textbooks' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "textbooks: update own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'textbooks' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY "textbooks: delete own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-attachments' AND (storage.foldername(name))[1] = 'textbooks' AND
    (storage.foldername(name))[2] = auth.uid()::text
  );
