-- ==========================================
-- Migration 010: Fix BM25 for Arabic
-- ==========================================
-- Adds Arabic text normalization for better BM25 search.
-- Strips common Arabic prefixes and normalizes characters.
-- ==========================================

-- 1. Create Arabic normalization function
CREATE OR REPLACE FUNCTION normalize_arabic(text TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  result TEXT;
BEGIN
  result := text;
  
  -- Remove tatweel (kashida)
  result := regexp_replace(result, '\u0640', '', 'g');
  
  -- Normalize alef variants to plain alef
  result := regexp_replace(result, '[\u0622\u0623\u0625]', '\u0627', 'g');
  
  -- Normalize teh marbuta to heh
  result := regexp_replace(result, '\u0629', '\u0647', 'g');
  
  -- Normalize yeh variants
  result := regexp_replace(result, '\u0649', '\u064A', 'g');
  
  -- Strip common prefixes (ال, وال, بال, كال, فال)
  result := regexp_replace(result, '\u0627\u0644', '', 'g');
  result := regexp_replace(result, '\u0648\u0627\u0644', '', 'g');
  result := regexp_replace(result, '\u0628\u0627\u0644', '', 'g');
  result := regexp_replace(result, '\u0643\u0627\u0644', '', 'g');
  result := regexp_replace(result, '\u0641\u0627\u0644', '', 'g');
  
  -- Remove diacritics (tashkeel)
  result := regexp_replace(result, '[\u064B-\u065F]', '', 'g');
  
  RETURN result;
END;
$$;

-- 2. Update tsvector to use normalized Arabic
ALTER TABLE textbook_chunks
DROP COLUMN IF EXISTS content_tsv;

ALTER TABLE textbook_chunks
ADD COLUMN IF NOT EXISTS content_tsv tsvector
GENERATED ALWAYS AS (
  to_tsvector('simple', normalize_arabic(content))
) STORED;

-- 3. Recreate GIN index
DROP INDEX IF EXISTS idx_textbook_chunks_tsv;

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_tsv
ON textbook_chunks USING gin(content_tsv);

-- 4. Update hybrid search to use normalized query
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
  WITH normalized_query AS (
    SELECT normalize_arabic(query_text) AS query_text
  ),
  vector_results AS (
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
      textbook_chunks.textbook_id,
      textbook_chunks.page_number,
      textbook_chunks.structure_path,
      textbook_chunks.content,
      textbook_chunks.figure_refs,
      ts_rank_cd(
        textbook_chunks.content_tsv,
        plainto_tsquery('simple', nq.query_text)
      ) AS bm25_score,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          textbook_chunks.content_tsv,
          plainto_tsquery('simple', nq.query_text)
        ) DESC
      ) AS rank
    FROM textbook_chunks
    CROSS JOIN normalized_query nq
    WHERE textbook_chunks.textbook_id = p_textbook_id
      AND textbook_chunks.content_tsv @@ plainto_tsquery('simple', nq.query_text)
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
