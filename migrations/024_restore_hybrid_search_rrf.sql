-- Migration 024: Restore RRF hybrid search + embedding HNSW index + finish search_path hardening
--
-- Restores the sophisticated three-way hybrid ranking for textbook retrieval
-- (vector + BM25-style ts_rank_cd + pg_trgm, fused with Reciprocal Rank Fusion),
-- adapted to the LIVE schema:
--   * textbook_chunks has NO user_id column -> ownership enforced by JOINing
--     textbooks (same defense-in-depth as migration 013).
--   * Signature kept IDENTICAL to the currently deployed function so the
--     backend (textbook-search.ts searchTextbookChunks) needs zero changes.
--
-- Also:
--   * Adds the missing HNSW index on textbook_chunks.embedding (vector search
--     was doing sequential scans).
--   * Fixes the last two function_search_path_mutable advisor warnings
--     (normalize_arabic, bump_session_updated_at).

-- ── 1. Rich hybrid search (RRF fusion) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hybrid_search_textbook_chunks(
  query_embedding VECTOR(9692),
  query_text TEXT,
  p_textbook_id UUID,
  p_user_id UUID,
  p_match_threshold DOUBLE PRECISION DEFAULT 0.05,
  p_match_count INTEGER DEFAULT 10,
  p_page_start INTEGER DEFAULT NULL::integer,
  p_page_end INTEGER DEFAULT NULL::integer
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  page_number INTEGER,
  structure_path TEXT,
  figure_refs JSONB,
  final_score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH normalized_query AS (
    SELECT normalize_arabic(query_text) AS q
  ),
  vector_results AS (
    SELECT
      tc.id,
      tc.content,
      tc.page_number,
      tc.structure_path,
      tc.figure_refs,
      1 - (tc.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (
        ORDER BY 1 - (tc.embedding <=> query_embedding) DESC
      ) AS rank
    FROM textbook_chunks tc
    JOIN textbooks tb ON tb.id = tc.textbook_id
    CROSS JOIN normalized_query nq
    WHERE tc.textbook_id = p_textbook_id
      AND tb.user_id = p_user_id
      AND tc.embedding IS NOT NULL
      AND 1 - (tc.embedding <=> query_embedding) > p_match_threshold
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    ORDER BY similarity DESC
    LIMIT 20
  ),
  bm25_results AS (
    SELECT
      tc.id,
      tc.content,
      tc.page_number,
      tc.structure_path,
      tc.figure_refs,
      ts_rank_cd(tc.content_tsv, plainto_tsquery('simple', nq.q)) AS bm25_score,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(tc.content_tsv, plainto_tsquery('simple', nq.q)) DESC
      ) AS rank
    FROM textbook_chunks tc
    JOIN textbooks tb ON tb.id = tc.textbook_id
    CROSS JOIN normalized_query nq
    WHERE tc.textbook_id = p_textbook_id
      AND tb.user_id = p_user_id
      AND tc.content_tsv @@ plainto_tsquery('simple', nq.q)
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    ORDER BY bm25_score DESC
    LIMIT 20
  ),
  trgm_results AS (
    SELECT
      tc.id,
      tc.content,
      tc.page_number,
      tc.structure_path,
      tc.figure_refs,
      similarity(tc.content, nq.q) AS trgm_score,
      ROW_NUMBER() OVER (
        ORDER BY similarity(tc.content, nq.q) DESC
      ) AS rank
    FROM textbook_chunks tc
    JOIN textbooks tb ON tb.id = tc.textbook_id
    CROSS JOIN normalized_query nq
    WHERE tc.textbook_id = p_textbook_id
      AND tb.user_id = p_user_id
      AND tc.content % nq.q
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    ORDER BY trgm_score DESC
    LIMIT 20
  ),
  combined AS (
    SELECT v.id, v.content, v.page_number, v.structure_path, v.figure_refs,
      v.similarity, b.bm25_score, t.trgm_score,
      (1.0 / (60 + v.rank)) AS rrf_vector,
      0.0 AS rrf_bm25,
      0.0 AS rrf_trgm
    FROM vector_results v
    LEFT JOIN bm25_results b ON v.id = b.id
    LEFT JOIN trgm_results t ON v.id = t.id

    UNION

    SELECT b.id, b.content, b.page_number, b.structure_path, b.figure_refs,
      v.similarity, b.bm25_score, t.trgm_score,
      0.0, (1.0 / (60 + b.rank)), 0.0
    FROM bm25_results b
    LEFT JOIN vector_results v ON b.id = v.id
    LEFT JOIN trgm_results t ON b.id = t.id
    WHERE v.id IS NULL

    UNION

    SELECT t.id, t.content, t.page_number, t.structure_path, t.figure_refs,
      v.similarity, b.bm25_score, t.trgm_score,
      0.0, 0.0, (1.0 / (60 + t.rank))
    FROM trgm_results t
    LEFT JOIN vector_results v ON t.id = v.id
    LEFT JOIN bm25_results b ON t.id = b.id
    WHERE v.id IS NULL AND b.id IS NULL
  ),
  scored AS (
    SELECT *,
      (0.7 * COALESCE(similarity, 0)
        + 0.3 * (COALESCE(bm25_score, 0) / (COALESCE(bm25_score, 0) + 1))) AS weighted_score,
      (rrf_vector + rrf_bm25 + rrf_trgm) AS rrf_score
    FROM combined
  )
  SELECT
    id,
    content,
    page_number,
    structure_path,
    figure_refs,
    (0.5 * weighted_score + 0.5 * rrf_score)::double precision AS final_score
  FROM scored
  ORDER BY final_score DESC
  LIMIT p_match_count;
$$;

-- ── 2. Embedding index: DEFERRED (documented decision) ─────────────────────
-- textbook_chunks.embedding is VECTOR(9692). pgvector hard limits:
--   * hnsw  -> max 2000 dimensions
--   * halfvec (expression index) -> max 4000 dimensions
-- Therefore NO index type can serve 9692-dim vectors today. This is why the
-- table had no embedding index originally — not an oversight.
--
-- Root-cause fix (deferred, requires coordinated change):
--   1. Set EMBEDDING_TARGET_DIM=1536 (or <=2000) in backend env.
--   2. Re-embed all chunks + page summaries (gemini-embedding-001 supports
--      MRL dimension truncation).
--   3. Recreate columns as VECTOR(1536) and add:
--      CREATE INDEX ... USING hnsw (embedding vector_cosine_ops).
-- Until then, vector search uses sequential scan — acceptable at current
-- scale (hundreds of chunks), degrades linearly with book count.

-- ── 3. Last two search_path warnings ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_arabic(text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.bump_session_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;
