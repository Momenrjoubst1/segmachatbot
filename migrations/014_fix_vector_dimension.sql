UPDATE textbook_chunks SET embedding = NULL WHERE embedding IS NOT NULL;

DROP INDEX IF EXISTS idx_textbook_chunks_embedding_hnsw;
ALTER TABLE textbook_chunks ALTER COLUMN embedding TYPE vector(9692);

DROP FUNCTION IF EXISTS match_textbook_chunks(vector,uuid,uuid,double precision,integer,integer,integer);
DROP FUNCTION IF EXISTS hybrid_search_textbook_chunks(vector,text,uuid,uuid,double precision,integer,integer,integer);
DROP FUNCTION IF EXISTS batch_update_embeddings(uuid,uuid,jsonb);

CREATE OR REPLACE FUNCTION match_textbook_chunks (
  query_embedding VECTOR(9692), p_textbook_id UUID, p_user_id UUID,
  p_match_threshold FLOAT DEFAULT 0.05, p_match_count INT DEFAULT 10,
  p_page_start INT DEFAULT NULL, p_page_end INT DEFAULT NULL
)
RETURNS TABLE (id BIGINT, content TEXT, page_number INT, structure_path TEXT, figure_refs JSONB, similarity FLOAT)
LANGUAGE sql STABLE AS $$
  SELECT tc.id, tc.content, tc.page_number, tc.structure_path, tc.figure_refs,
    1 - (tc.embedding <=> query_embedding) AS similarity
  FROM textbook_chunks tc JOIN textbooks tb ON tc.textbook_id = tb.id
  WHERE tc.textbook_id = p_textbook_id AND tb.user_id = p_user_id
    AND tc.embedding IS NOT NULL
    AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
    AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
    AND 1 - (tc.embedding <=> query_embedding) > p_match_threshold
  ORDER BY tc.embedding <=> query_embedding LIMIT p_match_count;
$$;

CREATE OR REPLACE FUNCTION hybrid_search_textbook_chunks(
  query_embedding VECTOR(9692), query_text TEXT, p_textbook_id UUID, p_user_id UUID,
  p_match_threshold FLOAT DEFAULT 0.05, p_match_count INT DEFAULT 10,
  p_page_start INT DEFAULT NULL, p_page_end INT DEFAULT NULL
)
RETURNS TABLE (id BIGINT, content TEXT, page_number INT, structure_path TEXT, figure_refs JSONB, final_score FLOAT)
LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT tc.id, tc.content, tc.page_number, tc.structure_path, tc.figure_refs,
      1 - (tc.embedding <=> query_embedding) AS vs
    FROM textbook_chunks tc JOIN textbooks tb ON tc.textbook_id = tb.id
    WHERE tc.textbook_id = p_textbook_id AND tb.user_id = p_user_id
      AND tc.embedding IS NOT NULL
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
      AND 1 - (tc.embedding <=> query_embedding) > p_match_threshold
  ),
  t AS (
    SELECT tc.id, ts_rank(tc.content_tsv, plainto_tsquery('simple', query_text)) AS ts
    FROM textbook_chunks tc JOIN textbooks tb ON tc.textbook_id = tb.id
    WHERE tc.textbook_id = p_textbook_id AND tb.user_id = p_user_id
      AND tc.content_tsv @@ plainto_tsquery('simple', query_text)
      AND (p_page_start IS NULL OR tc.page_number >= p_page_start)
      AND (p_page_end IS NULL OR tc.page_number <= p_page_end)
  )
  SELECT v.id, v.content, v.page_number, v.structure_path, v.figure_refs,
    COALESCE(v.vs * 0.7, 0) + COALESCE(t.ts * 0.3, 0) AS final_score
  FROM v LEFT JOIN t ON v.id = t.id ORDER BY final_score DESC LIMIT p_match_count;
$$;

CREATE OR REPLACE FUNCTION batch_update_embeddings(p_textbook_id UUID, p_updates JSONB)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE updated_count INT := 0; item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    UPDATE textbook_chunks SET embedding = (item->>'embedding')::vector(9692)
    WHERE id = (item->>'id')::BIGINT AND textbook_id = p_textbook_id;
    IF FOUND THEN updated_count := updated_count + 1; END IF;
  END LOOP;
  RETURN updated_count;
END;
$$;
