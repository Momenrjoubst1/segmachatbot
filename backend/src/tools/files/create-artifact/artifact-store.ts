/**
 * Artifact Store — durable, versioned artifact persistence.
 *
 * Backed by the `artifacts` / `artifact_versions` Postgres tables (see
 * migrations/032_artifacts.sql). Replaces the previous in-memory + Redis
 * store whose 24h TTL silently destroyed every artifact a user created.
 *
 * Versioning model: `artifacts` always holds the current state. Every state
 * is snapshotted into `artifact_versions` exactly once — at the moment it
 * becomes current — so history is complete (creation = version 1), the
 * (artifact_id, version) pair never collides, and revert is itself a new
 * version (nothing is ever lost).
 */

import { supabase } from "../../../config/supabase.config.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("artifact-store");

/** Content larger than this is rejected (protects the DB and the viewer). */
export const MAX_ARTIFACT_BYTES = 512 * 1024;

export const ARTIFACT_TYPES = [
  "html", "svg", "mermaid", "markdown", "code", "chart", "quiz", "react", "ide",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface ArtifactRow {
  id: string;
  owner_id: string;
  thread_id: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  language: string | null;
  version: number;
  visibility: "private" | "public";
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  title: string;
  content: string;
  language: string | null;
  change_summary: string | null;
  author: "user" | "assistant";
  created_at: string;
}

export class ArtifactStoreError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ArtifactStoreError";
    this.status = status;
  }
}

function assertContentSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new ArtifactStoreError(
      `Artifact content exceeds the ${Math.round(MAX_ARTIFACT_BYTES / 1024)} KB limit`,
      413,
    );
  }
}

function normalizeType(type: string): ArtifactType {
  if ((ARTIFACT_TYPES as readonly string[]).includes(type)) {
    return type as ArtifactType;
  }
  throw new ArtifactStoreError(`Unknown artifact type: ${type}`, 400);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getArtifact(
  id: string,
  ownerId?: string,
): Promise<ArtifactRow | null> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    log.warn("getArtifact failed", { id, error: error.message });
    throw new ArtifactStoreError(error.message);
  }
  if (!data) return null;

  const row = data as ArtifactRow;
  // Non-owners may only read explicitly shared artifacts.
  if (ownerId && row.owner_id !== ownerId && row.visibility !== "public") {
    return null;
  }
  return row;
}

/** Unauthenticated read for share links — only succeeds for public artifacts. */
export async function getPublicArtifact(id: string): Promise<ArtifactRow | null> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("id", id)
    .eq("visibility", "public")
    .maybeSingle();

  if (error) {
    log.warn("getPublicArtifact failed", { id, error: error.message });
    return null;
  }
  return (data as ArtifactRow) ?? null;
}

export interface ListOptions {
  threadId?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listArtifacts(
  ownerId: string,
  opts: ListOptions = {},
): Promise<ArtifactRow[]> {
  let query = supabase
    .from("artifacts")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 200));

  if (opts.threadId) query = query.eq("thread_id", opts.threadId);
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.search) {
    // ilike on title; content search would need fts — title covers the UX.
    query = query.ilike("title", `%${opts.search}%`);
  }
  if (opts.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 100) - 1);

  const { data, error } = await query;
  if (error) {
    log.warn("listArtifacts failed", { ownerId, error: error.message });
    throw new ArtifactStoreError(error.message);
  }
  return (data ?? []) as ArtifactRow[];
}

export async function listVersions(
  artifactId: string,
  ownerId: string,
): Promise<ArtifactVersionRow[]> {
  const artifact = await getArtifact(artifactId, ownerId);
  if (!artifact) throw new ArtifactStoreError("Artifact not found", 404);

  const { data, error } = await supabase
    .from("artifact_versions")
    .select("*")
    .eq("artifact_id", artifactId)
    .order("version", { ascending: false });

  if (error) throw new ArtifactStoreError(error.message);
  return (data ?? []) as ArtifactVersionRow[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateArtifactInput {
  ownerId: string;
  threadId?: string | null;
  type: string;
  title: string;
  content: string;
  language?: string | null;
  author?: "user" | "assistant";
}

export async function createArtifact(input: CreateArtifactInput): Promise<ArtifactRow> {
  const type = normalizeType(input.type);
  assertContentSize(input.content);

  const title = input.title.trim() || "Untitled";
  const language = input.language?.trim() || inferLanguage(type);

  const { data, error } = await supabase
    .from("artifacts")
    .insert({
      owner_id: input.ownerId,
      thread_id: input.threadId ?? null,
      type,
      title,
      content: input.content,
      language,
      version: 1,
    })
    .select()
    .single();

  if (error) throw new ArtifactStoreError(error.message);

  const row = data as ArtifactRow;
  const { error: versionError } = await supabase.from("artifact_versions").insert({
    artifact_id: row.id,
    version: 1,
    title,
    content: input.content,
    language,
    change_summary: "Created",
    author: input.author ?? "assistant",
  });
  if (versionError) {
    // Non-fatal: the artifact exists; history for v1 is missing.
    log.warn("Failed to snapshot initial version", { id: row.id, error: versionError.message });
  }
  return row;
}

export interface UpdateArtifactInput {
  title?: string;
  content?: string;
  language?: string;
  changeSummary?: string;
  author?: "user" | "assistant";
}

/**
 * Apply a mutation and bump the version. The NEW state is snapshotted into
 * artifact_versions exactly once — when it becomes current — so history is
 * complete (v1..vN) and (artifact_id, version) never collides. Reverting is
 * just updateArtifact with an old version's content.
 */
export async function updateArtifact(
  id: string,
  ownerId: string,
  patch: UpdateArtifactInput,
): Promise<ArtifactRow> {
  const current = await getArtifact(id, ownerId);
  if (!current) throw new ArtifactStoreError("Artifact not found", 404);

  const nextContent = patch.content !== undefined ? patch.content : current.content;
  assertContentSize(nextContent);
  const nextTitle = patch.title?.trim() || current.title;
  const nextLanguage = patch.language?.trim() || current.language;
  const nextVersion = current.version + 1;

  const { data, error } = await supabase
    .from("artifacts")
    .update({
      title: nextTitle,
      content: nextContent,
      language: nextLanguage,
      version: nextVersion,
    })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select()
    .single();

  if (error) throw new ArtifactStoreError(error.message);
  const row = data as ArtifactRow;

  const { error: snapshotError } = await supabase.from("artifact_versions").insert({
    artifact_id: id,
    version: nextVersion,
    title: nextTitle,
    content: nextContent,
    language: nextLanguage,
    change_summary: patch.changeSummary ?? "Edited",
    author: patch.author ?? "user",
  });
  if (snapshotError) {
    // Non-fatal: the artifact is updated; only its history entry is missing.
    log.warn("Failed to snapshot new version", { id, error: snapshotError.message });
  }

  return row;
}

export async function deleteArtifact(id: string, ownerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("artifacts")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id");

  if (error) throw new ArtifactStoreError(error.message);
  return (data?.length ?? 0) > 0;
}

/**
 * Restore an old version's content as the current state. Implemented as a
 * new version on top (not a rewind) so no history is ever destroyed.
 */
export async function revertToVersion(
  artifactId: string,
  ownerId: string,
  version: number,
): Promise<ArtifactRow> {
  const { data, error } = await supabase
    .from("artifact_versions")
    .select("*")
    .eq("artifact_id", artifactId)
    .eq("version", version)
    .maybeSingle();

  if (error) throw new ArtifactStoreError(error.message);
  if (!data) throw new ArtifactStoreError(`Version ${version} not found`, 404);

  const snapshot = data as ArtifactVersionRow;
  return updateArtifact(artifactId, ownerId, {
    title: snapshot.title,
    content: snapshot.content,
    language: snapshot.language ?? undefined,
    changeSummary: `Reverted to version ${version}`,
    author: "user",
  });
}

export async function setVisibility(
  id: string,
  ownerId: string,
  visibility: "private" | "public",
): Promise<ArtifactRow> {
  const { data, error } = await supabase
    .from("artifacts")
    .update({ visibility })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select()
    .single();

  if (error) throw new ArtifactStoreError(error.message);
  return data as ArtifactRow;
}

/** Duplicate someone else's (public) artifact into the caller's library. */
export async function remixArtifact(id: string, newOwnerId: string): Promise<ArtifactRow> {
  const source = await getArtifact(id);
  if (!source) throw new ArtifactStoreError("Artifact not found", 404);
  if (source.visibility !== "public" && source.owner_id !== newOwnerId) {
    throw new ArtifactStoreError("Artifact is not shared publicly", 403);
  }

  return createArtifact({
    ownerId: newOwnerId,
    type: source.type,
    title: `${source.title} (remix)`,
    content: source.content,
    language: source.language ?? undefined,
    author: "user",
  });
}

function inferLanguage(type: ArtifactType): string | null {
  switch (type) {
    case "react":
    case "html": return "html";
    case "svg": return "svg";
    case "mermaid": return "mermaid";
    case "markdown": return "markdown";
    case "chart":
    case "quiz":
    case "ide": return "json";
    default: return "text";
  }
}
