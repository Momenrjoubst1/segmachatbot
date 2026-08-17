-- ==========================================
-- 013: User-scoped textbook search RPCs
--
-- Adds p_user_id to match_textbook_chunks and hybrid_search_textbook_chunks.
-- Both now JOIN textbooks to enforce ownership: the backend runs on the
-- service-role key (RLS bypassed), so this is the last line of defense
-- against cross-user chunk disclosure if any caller ever passes a
-- textbook_id it did not verify. A NULL p_user_id matches no rows
-- (t.user_id = NULL is never true) — fail-safe by SQL semantics.
--
-- NOTE: changing the parameter list requires DROP + CREATE (CREATE OR
-- REPLACE with a different signature would silently create an overload).
-- ==========================================

DROP FUNCTION IF EXISTS match_textbook_chunks(
  VECTOR(768), UUID, FLOAT, INT, INT, INT
);

CREATE OR REPLACE FUNCTION match_textbook_chunks (
  query_embedding VECTOR(768),
  p_textbook_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_match_threshold FLOAT DEFAULT 0.5,
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
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    textbook_chunks.id,
    textbook_chunks.textbook_id,
    textbook_chunks.page_number,
    textbook_chunks.structure_path,
    textbook_chunks.content,
    textbook_chunks.figure_refs,
    1 - (textbook_chunks.embedding <=> query_embedding) AS similarity
  FROM textbook_chunks
  JOIN textbooks t ON t.id = textbook_chunks.textbook_id
  WHERE t.user_id = p_user_id
    AND textbook_chunks.textbook_id = p_textbook_id
    AND 1 - (textbook_chunks.embedding <=> query_embedding) > p_match_threshold
    AND (p_page_start IS NULL OR textbook_chunks.page_number >= p_page_start)
    AND (p_page_end IS NULL OR textbook_chunks.page_number <= p_page_end)
  ORDER BY similarity DESC
  LIMIT p_match_count;
$$;

DROP FUNCTION IF EXISTS hybrid_search_textbook_chunks(
  VECTOR(768), TEXT, UUID, FLOAT, INT, INT, INT
);

CREATE OR REPLACE FUNCTION hybrid_search_textbook_chunks(
  query_embedding VECTOR(768),
  query_text TEXT,
  p_textbook_id UUID,
  p_user_id UUID DEFAULT NULL,
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
      1 - (textbook_chunks.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY 1 - (textbook_chunks.embedding <=> query_embedding) DESC) AS rank
    FROM textbook_chunks
    JOIN textbooks t ON t.id = textbook_chunks.textbook_id
    WHERE t.user_id = p_user_id
      AND textbook_chunks.textbook_id = p_textbook_id
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
      textbook_chunks.textbook_id,
      textbook_chunks.page_number,
      textbook_chunks.structure_path,
      textbook_chunks.content,
      textbook_chunks.figure_refs,
      ts_rank_cd(
        textbook_chunks.content_tsv,
        plainto_tsquery('simple', query_text)
      ) AS bm25_score,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          textbook_chunks.content_tsv,
          plainto_tsquery('simple', query_text)
        ) DESC
      ) AS rank
    FROM textbook_chunks
    JOIN textbooks t ON t.id = textbook_chunks.textbook_id
    WHERE t.user_id = p_user_id
      AND textbook_chunks.textbook_id = p_textbook_id
      AND textbook_chunks.content_tsv @@ plainto_tsquery('simple', query_text)
      AND (p_page_start IS NULL OR textbook_chunks.page_number >= p_page_start)
      AND (p_page_end IS NULL OR textbook_chunks.page_number <= p_page_end)
    ORDER BY bm25_score DESC
    LIMIT 20
  ),
  combined AS (
    SELECT
      v.id,
      v.textbook_id,
      v.page_number,
      v.structure_path,
      v.content,
      v.figure_refs,
      v.similarity,
      COALESCE(b.bm25_score, 0) AS bm25_score,
      (1.0 / (60 + v.rank)) AS rrf_vector,
      0.0 AS rrf_bm25
    FROM vector_results v
    LEFT JOIN bm25_results b ON v.id = b.id

    UNION

    SELECT
      b.id,
      b.textbook_id,
      b.page_number,
      b.structure_path,
      b.content,
      b.figure_refs,
      COALESCE(v.similarity, 0) AS similarity,
      b.bm25_score,
      0.0 AS rrf_vector,
      (1.0 / (60 + b.rank)) AS rrf_bm25
    FROM bm25_results b
    LEFT JOIN vector_results v ON b.id = v.id
    WHERE v.id IS NULL
  ),
  scored AS (
    SELECT
      *,
      (0.7 * similarity + 0.3 * (bm25_score / (bm25_score + 1))) AS weighted_score,
      (rrf_vector + rrf_bm25) AS rrf_score
    FROM combined
  )
  SELECT
    id,
    textbook_id,
    page_number,
    structure_path,
    content,
    figure_refs,
    similarity,
    bm25_score,
    (0.5 * weighted_score + 0.5 * rrf_score) AS final_score
  FROM scored
  ORDER BY final_score DESC
  LIMIT p_match_count;
$$;