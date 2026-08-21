-- Migration 020: Retrieval feedback table + page summary embeddings
-- Enables active learning from retrieval misses and user satisfaction signals.
-- Page summaries provide a ColBERT-like two-layer retrieval without
-- multi-vector storage cost.

CREATE TABLE IF NOT EXISTS retrieval_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  textbook_id UUID REFERENCES textbooks(id) ON DELETE SET NULL,
  query_text TEXT NOT NULL,
  matched_section_id UUID REFERENCES textbook_sections(id) ON DELETE SET NULL,
  matched_pages INT[],
  chunks_retrieved INT NOT NULL DEFAULT 0,
  user_satisfied BOOLEAN,  -- thumbs up/down on the answer
  feedback_text TEXT,       -- optional free-text comment
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_retrieval_feedback_user ON retrieval_feedback(user_id, created_at DESC);
CREATE INDEX idx_retrieval_feedback_textbook ON retrieval_feedback(textbook_id, created_at DESC);
CREATE INDEX idx_retrieval_feedback_satisfaction ON retrieval_feedback(user_satisfied) WHERE user_satisfied IS NOT NULL;

ALTER TABLE retrieval_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own feedback" ON retrieval_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own feedback" ON retrieval_feedback
  FOR SELECT USING (auth.uid() = user_id);

-- ── Page summaries for late-interaction retrieval ──────────────────────────
-- Per-page summary text + embedding enables a two-layer search:
--   Layer 1: match pages via summary embedding (high recall, coarse)
--   Layer 2: retrieve chunks only from matched pages (precise, low noise)
CREATE TABLE IF NOT EXISTS textbook_page_summaries (
  id BIGSERIAL PRIMARY KEY,
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  summary TEXT NOT NULL,
  embedding VECTOR(9692),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (textbook_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_page_summaries_textbook
ON textbook_page_summaries(textbook_id, page_number);
CREATE INDEX IF NOT EXISTS idx_page_summaries_embedding_hnsw
ON textbook_page_summaries USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

ALTER TABLE textbook_page_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view page summaries via textbook" ON textbook_page_summaries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM textbooks
      WHERE textbooks.id = textbook_page_summaries.textbook_id
      AND textbooks.user_id = auth.uid()
    )
  );

-- Search page summaries (Layer 1 of late-interaction retrieval)
CREATE OR REPLACE FUNCTION match_textbook_page_summaries(
  query_embedding VECTOR(9692),
  p_textbook_id UUID,
  p_match_threshold FLOAT DEFAULT 0.3,
  p_match_count INT DEFAULT 5
)
RETURNS TABLE (
  page_number INT,
  summary TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT ps.page_number, ps.summary,
    1 - (ps.embedding <=> query_embedding) AS similarity
  FROM textbook_page_summaries ps
  WHERE ps.textbook_id = p_textbook_id
    AND ps.embedding IS NOT NULL
    AND 1 - (ps.embedding <=> query_embedding) > p_match_threshold
  ORDER BY ps.embedding <=> query_embedding
  LIMIT p_match_count;
$$;
