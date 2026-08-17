-- ==========================================
-- Migration 017: Visual enrichment (Phase 2 — VLM layer)
-- ==========================================

ALTER TABLE textbook_pages
  ADD COLUMN IF NOT EXISTS vlm_summary TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vlm_enriched BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbnail_key TEXT DEFAULT NULL;

ALTER TABLE textbook_figures
  ADD COLUMN IF NOT EXISTS vlm_description TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dominant_colors JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_colored BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'raster'
    CHECK (kind IS NULL OR kind IN ('raster', 'vector'));

CREATE INDEX IF NOT EXISTS idx_textbook_pages_needs_visual
  ON textbook_pages(textbook_id) WHERE vlm_enriched = false;
