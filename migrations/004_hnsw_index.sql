-- ==========================================
-- Migration 004: HNSW Index for Vector Search
-- ==========================================
-- Adds a HNSW index on the embedding column for fast approximate nearest
-- neighbor search. This works alongside the existing B-tree indexes —
-- the RPC filters by textbook_id first (B-tree), then does vector search.
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_embedding_hnsw
ON textbook_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
