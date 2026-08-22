-- ==========================================
-- Fix: Vector dimension + missing indexes
-- ==========================================

-- 1. Fix vector dimension mismatch (documents table: 768 -> 9692)
-- The embedding service uses 9692 but schema has 768
UPDATE documents SET embedding = NULL WHERE embedding IS NOT NULL;
DROP INDEX IF EXISTS idx_documents_embedding_hnsw;
ALTER TABLE documents ALTER COLUMN embedding TYPE vector(9692);
CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw
ON documents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 2. Fix textbook_chunks vector dimension (768 -> 9692) - already in migration 014
-- but ensure consistency
DROP INDEX IF EXISTS idx_textbook_chunks_embedding_hnsw;
ALTER TABLE textbook_chunks ALTER COLUMN embedding TYPE vector(9692);
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_embedding_hnsw
ON textbook_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. Add missing index for user_memory cleanup (expires_at queries)
CREATE INDEX IF NOT EXISTS idx_user_memory_user_expires
ON user_memory(user_id, expires_at) WHERE expires_at IS NOT NULL;

-- 4. Add missing index for chat_messages cleanup queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
ON chat_messages(session_id, created_at ASC);

-- 5. Add missing index for textbook_chunks user-scoped queries (user_id + textbook_id)
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_user_textbook
ON textbook_chunks(textbook_id) INCLUDE (user_id);

-- 6. Add index for banned_users active checks
CREATE INDEX IF NOT EXISTS idx_banned_users_active_expires
ON banned_users(user_id, expires_at) WHERE is_active = TRUE;

-- 7. Add index for email_confirmations cleanup
CREATE INDEX IF NOT EXISTS idx_email_confirmations_expires
ON email_confirmations(expires_at) WHERE expires_at IS NOT NULL;

-- 8. Add index for email_jobs retry queries
CREATE INDEX IF NOT EXISTS idx_email_jobs_status_retry
ON email_jobs(status, next_retry_at) WHERE status = 'pending';

-- 9. Fix textbook_chunks vector dimension in RLS policy (uses 768)
-- Drop and recreate with correct dimension
DROP FUNCTION IF EXISTS match_textbook_chunks(vector,uuid,double precision,integer,integer,integer);
CREATE OR REPLACE FUNCTION match_textbook_chunks (
  query_embedding VECTOR(9692), p_textbook_id UUID,
  p_match_threshold FLOAT DEFAULT 0.05, p_match_count INT DEFAULT 10,
  p_page_start INT DEFAULT NULL, p_page_end INT DEFAULT NULL
)
RETURNS TABLE (id BIGINT, textbook_id UUID, page_number INT, structure_path TEXT, content TEXT, figure_refs JSONB, similarity FLOAT)
LANGUAGE sql STABLE AS $$
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