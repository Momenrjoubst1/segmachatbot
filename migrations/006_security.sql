-- ==========================================
-- Migration 006: Security Improvements
-- ==========================================
-- 1. Make textbook-images bucket private (signed URLs only)
-- 2. Update batch_update_embeddings to scope by textbook_id
-- ==========================================

-- 1. Make storage bucket private
UPDATE storage.buckets
SET public = false
WHERE id = 'textbook-images';

-- 2. Drop old public SELECT policy
DROP POLICY IF EXISTS "Anyone can view textbook images" ON storage.objects;

-- 3. New policy: only owner can view their images
CREATE POLICY "Users can view own textbook images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'textbook-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 4. Update batch_update_embeddings to scope by textbook_id
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
BEGIN
  FOR item IN SELECT jsonb_array_elements(p_updates)
  LOOP
    UPDATE textbook_chunks
    SET embedding = (item->>'embedding')::vector(768)
    WHERE id = (item->>'id')::bigint
      AND textbook_id = p_textbook_id;
  END LOOP;
END;
$$;
