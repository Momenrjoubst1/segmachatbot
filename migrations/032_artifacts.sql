-- Migration 032: Artifacts — persistent, versioned interactive content.
--
-- Replaces the ephemeral in-memory/Redis artifact store (24h TTL) with
-- durable Postgres storage. Every AI or user edit snapshots the previous
-- content into artifact_versions so users can browse and restore history,
-- mirroring Claude's artifact versioning.
--
-- artifacts.visibility controls sharing: 'private' (owner only) or 'public'
-- (readable by anyone with the id via the unauthenticated public endpoint).

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('html', 'svg', 'mermaid', 'markdown', 'code', 'chart', 'quiz', 'react', 'ide')),
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',
  language TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_owner_updated
  ON artifacts(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_thread
  ON artifacts(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_visibility
  ON artifacts(id) WHERE visibility = 'public';

-- Snapshot of every saved state. The current content lives on artifacts;
-- artifact_versions keeps the history (including the initial creation).
CREATE TABLE IF NOT EXISTS artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT,
  change_summary TEXT,
  author TEXT NOT NULL DEFAULT 'user' CHECK (author IN ('user', 'assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
  ON artifact_versions(artifact_id, version DESC);

-- Keep updated_at fresh on every modification.
CREATE OR REPLACE FUNCTION set_artifacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artifacts_updated_at ON artifacts;
CREATE TRIGGER trg_artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION set_artifacts_updated_at();

-- Cap stored history: keep the 50 most recent versions per artifact so a
-- chatty editing session cannot grow the table unboundedly.
CREATE OR REPLACE FUNCTION prune_artifact_versions()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM artifact_versions
  WHERE artifact_id = NEW.artifact_id
    AND version NOT IN (
      SELECT version FROM artifact_versions
      WHERE artifact_id = NEW.artifact_id
      ORDER BY version DESC
      LIMIT 50
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artifact_versions_prune ON artifact_versions;
CREATE TRIGGER trg_artifact_versions_prune
  AFTER INSERT ON artifact_versions
  FOR EACH ROW EXECUTE FUNCTION prune_artifact_versions();

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own artifacts" ON artifacts
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Public artifacts are readable by anyone" ON artifacts
  FOR SELECT USING (visibility = 'public');

-- Versions inherit access from their parent artifact.
CREATE POLICY "Users can manage versions of their artifacts" ON artifact_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM artifacts a
      WHERE a.id = artifact_id AND a.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM artifacts a
      WHERE a.id = artifact_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY "Public artifact versions are readable" ON artifact_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM artifacts a
      WHERE a.id = artifact_id AND a.visibility = 'public'
    )
  );

-- Stream row changes to connected clients. The frontend listens for
-- INSERT/UPDATE/DELETE to refresh the panel and auto-open new artifacts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'artifacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE artifacts;
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- supabase_realtime publication does not exist (e.g. plain Postgres);
  -- realtime is optional, the panel falls back to polling.
  NULL;
END $$;
