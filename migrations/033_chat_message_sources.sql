-- 033: Persist structured RAG sources on assistant messages.
--
-- The pipeline already computes deduplicated structured sources
-- ({source, page, textbook_id, similarity}) for every answer. Until now they
-- only traveled on the X-RAG-Sources response header, so the sources panel
-- vanished after a reload. Storing them on the row makes the panel survive
-- reloads and thread switches.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS sources jsonb;

COMMENT ON COLUMN public.chat_messages.sources IS
  'Structured RAG sources for assistant answers: [{source, page, textbook_id, similarity}]';
