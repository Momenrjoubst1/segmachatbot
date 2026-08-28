-- Migration 034: Scope match_documents to the requesting user
--
-- Background: the RAG hybrid retriever filters its BM25 leg by
-- metadata->>'user_id' and scopes textbook search by owner, but the vector
-- leg called match_documents with no user parameter and merged results
-- unfiltered (services/chat/pipeline/rag/retrieval.ts). The documents table
-- carries user-embedded content in metadata, so a future re-population would
-- leak cross-user chunks. The table is currently empty; this closes the
-- latent hole before it can matter.
--
-- p_user_id is optional with a NULL default: existing callers that don't
-- pass it keep working (no filter), the backend retriever now always passes
-- the authenticated user id.
--
-- The 3-arg overload created by migration 023 is dropped: it has no user
-- filter, CREATE OR REPLACE does not touch other overloads, and the backend
-- (the only caller) passes all four arguments.

DROP FUNCTION IF EXISTS public.match_documents(vector, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(id bigint, content text, metadata jsonb, similarity double precision)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
    AND (p_user_id IS NULL OR d.metadata->>'user_id' = p_user_id::text)
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
