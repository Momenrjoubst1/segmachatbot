-- ==========================================
-- Migration 002: Textbook Understanding Pipeline
-- ==========================================
-- Adds tables for the BYOC (Bring Your Own Content) textbook feature:
--   textbooks        — uploaded book metadata, processing status, structure tree
--   textbook_chunks  — per-page text chunks with embeddings for hybrid search
--   textbook_figures — extracted figures with captions and bounding boxes
--
-- Also adds a new match_textbook_chunks RPC for scoped vector search.
-- ==========================================

-- ==========================================
-- 1. TEXTBOOKS (uploaded book metadata + processing status)
-- ==========================================
CREATE TABLE IF NOT EXISTS textbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES student_courses(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size_bytes BIGINT,
  total_pages INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress JSONB DEFAULT '{}',
  error TEXT,
  structure_tree JSONB,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. TEXTBOOK CHUNKS (per-page text with embeddings)
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_chunks (
  id BIGSERIAL PRIMARY KEY,
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  structure_path TEXT,
  content TEXT NOT NULL,
  embedding VECTOR(768),
  figure_refs JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 3. TEXTBOOK FIGURES (extracted images with captions)
-- ==========================================
CREATE TABLE IF NOT EXISTS textbook_figures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  figure_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  caption TEXT,
  image_url TEXT NOT NULL,
  bounding_box JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_textbooks_user ON textbooks(user_id);
CREATE INDEX IF NOT EXISTS idx_textbooks_hash ON textbooks(file_hash);
CREATE INDEX IF NOT EXISTS idx_textbooks_status ON textbooks(user_id, status);
-- Partial unique: only one completed record per file hash (dedup guard)
CREATE UNIQUE INDEX IF NOT EXISTS idx_textbooks_hash_unique ON textbooks(file_hash) WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_textbook ON textbook_chunks(textbook_id, page_number);
CREATE INDEX IF NOT EXISTS idx_textbook_chunks_structure ON textbook_chunks(textbook_id, structure_path);
CREATE INDEX IF NOT EXISTS idx_textbook_figures_textbook ON textbook_figures(textbook_id, page_number);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_figures ENABLE ROW LEVEL SECURITY;

-- Textbooks — direct user ownership
CREATE POLICY "Users can view own textbooks" ON textbooks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own textbooks" ON textbooks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own textbooks" ON textbooks
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own textbooks" ON textbooks
  FOR DELETE USING (auth.uid() = user_id);

-- Textbook chunks — via textbook ownership
CREATE POLICY "Users can view chunks in own textbooks" ON textbook_chunks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert chunks in own textbooks" ON textbook_chunks
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can delete chunks in own textbooks" ON textbook_chunks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_chunks.textbook_id AND textbooks.user_id = auth.uid())
  );

-- Textbook figures — via textbook ownership
CREATE POLICY "Users can view figures in own textbooks" ON textbook_figures
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can insert figures in own textbooks" ON textbook_figures
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );
CREATE POLICY "Users can delete figures in own textbooks" ON textbook_figures
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM textbooks WHERE textbooks.id = textbook_figures.textbook_id AND textbooks.user_id = auth.uid())
  );

-- ==========================================
-- VECTOR SEARCH RPC — match_textbook_chunks
-- ==========================================
-- Scoped variant of match_documents that filters by textbook_id and
-- optionally by page range. Used by the textbook chat query flow.
-- ==========================================
CREATE OR REPLACE FUNCTION match_textbook_chunks (
  query_embedding VECTOR(768),
  p_textbook_id UUID,
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
  WHERE textbook_chunks.textbook_id = p_textbook_id
    AND 1 - (textbook_chunks.embedding <=> query_embedding) > p_match_threshold
    AND (p_page_start IS NULL OR textbook_chunks.page_number >= p_page_start)
    AND (p_page_end IS NULL OR textbook_chunks.page_number <= p_page_end)
  ORDER BY similarity DESC
  LIMIT p_match_count;
$$;

-- ==========================================
-- BATCH EMBEDDING UPDATE RPC
-- ==========================================
-- Accepts an array of {id, embedding} objects and updates all matching rows
-- in a single round-trip instead of N individual updates.
-- ==========================================
CREATE OR REPLACE FUNCTION batch_update_embeddings(
  p_updates JSONB
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
    WHERE id = (item->>'id')::bigint;
  END LOOP;
END;
$$;

-- ==========================================
-- STORAGE BUCKET — textbook-images
-- ==========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('textbook-images', 'textbook-images', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage policies for textbook images
CREATE POLICY "Users can upload textbook images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'textbook-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Anyone can view textbook images" ON storage.objects
  FOR SELECT USING (bucket_id = 'textbook-images');
CREATE POLICY "Users can delete own textbook images" ON storage.objects
  FOR DELETE USING (bucket_id = 'textbook-images' AND auth.uid()::text = (storage.foldername(name))[1]);
