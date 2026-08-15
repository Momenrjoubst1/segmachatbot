-- ==========================================
-- Migration 011: Fix Arabic Regex
-- ==========================================
-- Fixes the normalize_arabic function to only strip
-- "ال" prefix at word beginnings, not in middle of words.
-- ==========================================

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
  
  -- Remove diacritics (tashkeel)
  result := regexp_replace(result, '[\u064B-\u065F]', '', 'g');
  
  -- Strip "ال" prefix only at word beginnings
  result := regexp_replace(result, '(^| )ال', '\1', 'g');
  
  RETURN result;
END;
$$;

-- Recreate the hybrid search function with fixed normalization
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
      -- Normalize vector similarity to 0-1 range
      GREATEST(0, LEAST(1, similarity)) AS norm_vector,
      -- Normalize BM25 score using log scaling
      CASE WHEN bm25_score > 0 THEN LEAST(1, bm25_score / (bm25_score + 1)) ELSE 0 END AS norm_bm25,
      -- RRF scores
      (rrf_vector + rrf_bm25) AS rrf_score
    FROM combined
  ),
  final_scored AS (
    SELECT
      *,
      -- Combine normalized components with equal weight for vector and BM25
      -- Then blend with RRF for diversity
      (0.5 * norm_vector + 0.5 * norm_bm25) AS combined_score
    FROM scored
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
    -- Final score: 70% combined similarity + 30% RRF diversity
    (0.7 * combined_score + 0.3 * rrf_score) AS final_score
  FROM final_scored
  ORDER BY final_score DESC
  LIMIT p_match_count;
$$;