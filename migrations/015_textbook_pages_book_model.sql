-- ==========================================
-- Migration 015: Book Model — per-page digital twin (Phase 1)
-- ==========================================
-- Stores the Stage 1+2 output of the PDF processor: every page face with
-- its background color, layout tree (blocks with roles/colors/reading
-- order), image summaries, and vector figure clusters.
-- ==========================================

CREATE TABLE IF NOT EXISTS textbook_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  width FLOAT8 NOT NULL DEFAULT 0,
  height FLOAT8 NOT NULL DEFAULT 0,
  background_color TEXT NOT NULL DEFAULT '#FFFFFF',
  page_role TEXT NOT NULL DEFAULT 'interior'
    CHECK (page_role IN ('cover_front', 'interior', 'cover_back', 'blank')),
  page_type TEXT NOT NULL DEFAULT 'text_only'
    CHECK (page_type IN ('blank', 'text_only', 'mixed', 'figure_only', 'table_heavy', 'toc', 'index', 'cover')),
  dominant_script TEXT NOT NULL DEFAULT 'en'
    CHECK (dominant_script IN ('ar', 'en', 'mixed')),
  approximate_columns INT NOT NULL DEFAULT 1,
  layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (textbook_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_textbook_pages_textbook
  ON textbook_pages(textbook_id, page_number);

-- Layout-aware chunk metadata
ALTER TABLE textbook_chunks
  ADD COLUMN IF NOT EXISTS block_role TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS text_color TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS chunk_bbox JSONB DEFAULT NULL;

-- Book-level language (ar / en / mixed)
ALTER TABLE textbooks
  ADD COLUMN IF NOT EXISTS book_language TEXT DEFAULT NULL
    CHECK (book_language IS NULL OR book_language IN ('ar', 'en', 'mixed'));

-- RLS policies (mirror textbook_chunks: rows reachable only via the
-- owning textbook's user)
CREATE POLICY "Users can view pages in own textbooks"
  ON textbook_pages FOR SELECT
  USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_pages.textbook_id
      AND textbooks.user_id = auth.uid()));

CREATE POLICY "Users can insert pages in own textbooks"
  ON textbook_pages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_pages.textbook_id
      AND textbooks.user_id = auth.uid()));

CREATE POLICY "Users can delete pages in own textbooks"
  ON textbook_pages FOR DELETE
  USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_pages.textbook_id
      AND textbooks.user_id = auth.uid()));
