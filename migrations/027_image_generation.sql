-- Migration 027: AI image generation support
-- Tracks generated images per user (for daily-quota enforcement) and stores
-- the binary in a PUBLIC storage bucket so chat-history image URLs never
-- expire (signed URLs would die after 7 days and break old conversations).

CREATE TABLE IF NOT EXISTS image_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_image_generations_user_created
  ON image_generations(user_id, created_at DESC);

ALTER TABLE image_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own generations" ON image_generations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own generations" ON image_generations
  FOR DELETE USING (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', true)
ON CONFLICT (id) DO NOTHING;
