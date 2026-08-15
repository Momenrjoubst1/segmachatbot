-- ==========================================
-- Migration 005: Hybrid Search (Vector + BM25)
-- ==========================================
-- Adds full-text search capability alongside existing vector search.
-- Uses PostgreSQL's tsvector/tsquery for BM25-style ranking.
-- ==========================================

-- 1. Add tsvector column (auto-computed from content)
ALTER TABLE textbook_chunks
ADD COLUMN IF NOT EXISTS content_tsv tsvector
GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

-- 2. GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_tsv
ON textbook_chunks USING gin(content_tsv);

-- 3. Hybrid search RPC: combines vector similarity + BM25 ranking
CREATE OR REPLACE FUNCTION hybrid_search_textbook_chunks(
  query_embedding VECTOR(768),
  query_text TEXT,
  p_textbook_id UUID,
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
  WITH vector_results AS (
    SELECT
      textbook_chunks.id,
      textbook_chunks.textbook_id,
      textbook_chunks.page_number,
      textbook_chunks.structure_path,
      textbook_chunks.content,
      textbook_chunks.figure_refs,
      1 - (textbook_chunks.embedding <=> query_embedding) AS similarity
    FROM textbook_chunks
    WHERE textbook_chunks.textbook_id = p_textbook_id
      AND textbook_chunks.embedding IS NOT NULL
      AND 1 - (textbook_chunks.embedding <=> query_embedding) > p_match_threshold
      AND (p_page_start IS NULL OR textbook_chunks.page_number >= p_page_start)
      AND (p_page_end IS NULL OR textbook_chunks.page_number <= p_page_end)
    ORDER BY similarity DESC
    LIMIT 20
  ),
  bm25_results AS (
    SELECT
      textbook_chunks.id,
      ts_rank_cd(
        textbook_chunks.content_tsv,
        plainto_tsquery('simple', query_text)
      ) AS bm25_score
    FROM textbook_chunks
    WHERE textbook_chunks.textbook_id = p_textbook_id
      AND textbook_chunks.content_tsv @@ plainto_tsquery('simple', query_text)
      AND (p_page_start IS NULL OR textbook_chunks.page_number >= p_page_start)
      AND (p_page_end IS NULL OR textbook_chunks.page_number <= p_page_end)
    ORDER BY bm25_score DESC
    LIMIT 20
  ),
  combined AS (
    SELECT
      v.*,
      COALESCE(b.bm25_score, 0) AS bm25_score,
      (
        0.7 * v.similarity
        + 0.3 * (COALESCE(b.bm25_score, 0) / (COALESCE(b.bm25_score, 0) + 1))
      ) AS final_score
    FROM vector_results v
    LEFT JOIN bm25_results b ON v.id = b.id
  )
  SELECT * FROM combined
  ORDER BY final_score DESC
  LIMIT p_match_count;
$$;
