-- Migration 023: Security Hardening
-- 1. Revoke anon/authenticated EXECUTE on SECURITY DEFINER functions
-- 2. Grant EXECUTE to service_role only
-- 3. Add SET search_path = public to public RPCs (fix function_search_path_mutable)

-- ══════════════════════════════════════════════════════════════════
-- PART 1: Revoke + Grant on SECURITY DEFINER functions
-- ══════════════════════════════════════════════════════════════════

-- analyze_textbook_chunks() — backend-only ANALYZE after bulk embedding
REVOKE EXECUTE ON FUNCTION public.analyze_textbook_chunks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analyze_textbook_chunks() TO service_role;

-- batch_update_embeddings(jsonb, uuid) — backend-only bulk embedding update
REVOKE EXECUTE ON FUNCTION public.batch_update_embeddings(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_update_embeddings(jsonb, uuid) TO service_role;

-- rls_auto_enable() — event trigger that auto-enables RLS on new tables
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- Also fix function_search_path_mutable for SECURITY DEFINER functions
CREATE OR REPLACE FUNCTION public.analyze_textbook_chunks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ANALYZE textbook_chunks;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_update_embeddings(
  p_updates JSONB,
  p_textbook_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- ══════════════════════════════════════════════════════════════════
-- PART 2: Recreate public RPCs with SET search_path = public
-- Fixes: function_search_path_mutable advisory warning
-- ══════════════════════════════════════════════════════════════════

-- match_documents — general RAG vector search
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold double precision,
  match_count integer
)
RETURNS TABLE(id bigint, content text, metadata jsonb, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- hybrid_search_textbook_chunks — hybrid vector + BM25 search
CREATE OR REPLACE FUNCTION public.hybrid_search_textbook_chunks(
  query_embedding vector,
  query_text text,
  p_textbook_id uuid,
  p_user_id uuid,
  p_match_threshold double precision DEFAULT 0.05,
  p_match_count integer DEFAULT 10,
  p_page_start integer DEFAULT NULL::integer,
  p_page_end integer DEFAULT NULL::integer
)
RETURNS TABLE(id bigint, content text, page_number integer, structure_path text, figure_refs jsonb, final_score double precision)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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

-- match_textbook_chunks — scoped vector search by textbook
CREATE OR REPLACE FUNCTION public.match_textbook_chunks(
  query_embedding vector,
  p_textbook_id uuid,
  p_user_id uuid,
  p_match_threshold double precision DEFAULT 0.05,
  p_match_count integer DEFAULT 10,
  p_page_start integer DEFAULT NULL::integer,
  p_page_end integer DEFAULT NULL::integer
)
RETURNS TABLE(id bigint, content text, page_number integer, structure_path text, figure_refs jsonb, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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

-- match_textbook_page_summaries — page-level summary search
CREATE OR REPLACE FUNCTION public.match_textbook_page_summaries(
  query_embedding vector,
  p_textbook_id uuid,
  p_match_threshold double precision DEFAULT 0.3,
  p_match_count integer DEFAULT 5
)
RETURNS TABLE(page_number integer, summary text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
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
