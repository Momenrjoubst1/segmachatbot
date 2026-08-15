-- ==========================================
-- Migration 007: Fix SECURITY DEFINER functions
-- ==========================================
-- Adds ownership verification to batch_update_embeddings
-- and fixes duplicate chunk issue with idempotent insert.
-- ==========================================

-- 1. Fix batch_update_embeddings with ownership check
CREATE OR REPLACE FUNCTION batch_update_embeddings(
  p_updates JSONB,
  p_textbook_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item JSONB;
  owner_id UUID;
BEGIN
  -- Verify ownership: the textbook must belong to the calling user
  SELECT user_id INTO owner_id
  FROM textbooks
  WHERE id = p_textbook_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Textbook not found: %', p_textbook_id;
  END IF;

  -- Only proceed if the caller is the owner (or service role)
  IF auth.uid() IS NOT NULL AND owner_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: not the textbook owner';
  END IF;

  FOR item IN SELECT jsonb_array_elements(p_updates)
  LOOP
    UPDATE textbook_chunks
    SET embedding = (item->>'embedding')::vector(768)
    WHERE id = (item->>'id')::bigint
      AND textbook_id = p_textbook_id;
  END LOOP;
END;
$$;

-- 2. Add idempotent insert: delete existing chunks before re-inserting
-- This is handled in the TypeScript code (textbook-processor.ts)
-- but we add a safety unique constraint as well
CREATE UNIQUE INDEX IF NOT EXISTS idx_textbook_chunks_content_unique
ON textbook_chunks (textbook_id, page_number, left(content, 100));
