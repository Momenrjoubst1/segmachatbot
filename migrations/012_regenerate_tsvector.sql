-- ==========================================
-- Migration 012: Regenerate tsvector for old books
-- ==========================================
-- Regenerates content_tsv using the new normalize_arabic function
-- for all existing textbook chunks.
-- ==========================================

UPDATE textbook_chunks SET content = content;