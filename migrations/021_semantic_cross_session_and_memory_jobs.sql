-- ==========================================
-- Migration 021: Semantic Cross-Session + Reliable Memory Extraction
-- ==========================================
-- Creates infrastructure required by:
--   - services/memory/semantic-cross-session.service.ts  (message_embeddings)
--   - services/memory/reliable-memory-extraction.service.ts (jobs + dead letter)
--
-- Embedding dimension MUST match EXPECTED_DIMENSIONS (9692) used by
-- documents/textbook_chunks (see migrations 014/019) - gemini-embedding-001.
-- NOTE: pgvector HNSW supports max 2000 dims; like documents/textbook_chunks,
-- search uses exact sequential scan scoped by user_id/session_id.
-- ==========================================

-- ==========================================
-- 1. MESSAGE EMBEDDINGS (semantic cross-session search)
-- ==========================================

CREATE TABLE IF NOT EXISTS message_embeddings (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(9692) NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_embeddings_user
ON message_embeddings(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_embeddings_session
ON message_embeddings(session_id);

-- ==========================================
-- 2. SIMILARITY SEARCH RPC (exact scan - no ANN index possible at 9692 dims)
-- ==========================================

CREATE OR REPLACE FUNCTION search_message_embeddings(
  query_embedding VECTOR(9692),
  user_id_filter UUID,
  session_id_exclude TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.65,
  match_count INT DEFAULT 20,
  cutoff_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days'
)
RETURNS TABLE (
  message_id UUID,
  session_id UUID,
  session_title TEXT,
  session_updated_at TIMESTAMPTZ,
  content TEXT,
  role TEXT,
  message_created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT
    me.message_id,
    me.session_id,
    cs.title AS session_title,
    cs.updated_at AS session_updated_at,
    me.content,
    me.role,
    me.created_at AS message_created_at,
    1 - (me.embedding OPERATOR(public.<=>) query_embedding) AS similarity
  FROM public.message_embeddings me
  JOIN public.chat_sessions cs ON cs.id = me.session_id
  WHERE me.user_id = user_id_filter
    AND (session_id_exclude IS NULL OR session_id_exclude = ''
         OR me.session_id::text <> session_id_exclude)
    AND cs.updated_at >= cutoff_date
    AND 1 - (me.embedding OPERATOR(public.<=>) query_embedding) >= match_threshold
  ORDER BY me.embedding OPERATOR(public.<=>) query_embedding
  LIMIT match_count;
$$;

-- ==========================================
-- 3. MEMORY EXTRACTION JOBS (reliable queue)
-- ==========================================

CREATE TABLE IF NOT EXISTS memory_extraction_jobs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  messages JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  extracted_facts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_extraction_jobs_user_status
ON memory_extraction_jobs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_memory_extraction_jobs_retry
ON memory_extraction_jobs(next_retry_at)
WHERE status = 'pending' AND next_retry_at IS NOT NULL;

-- ==========================================
-- 4. DEAD LETTER QUEUE (failed extractions for admin review)
-- ==========================================

CREATE TABLE IF NOT EXISTS memory_extraction_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  messages JSONB NOT NULL,
  last_error TEXT NOT NULL,
  attempts INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_extraction_dead_letter_unresolved
ON memory_extraction_dead_letter(user_id, resolved)
WHERE resolved = FALSE;

-- ==========================================
-- 5. LOCKDOWN (backend/service-role only - no public policies)
-- ==========================================

ALTER TABLE message_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_extraction_dead_letter ENABLE ROW LEVEL SECURITY;
