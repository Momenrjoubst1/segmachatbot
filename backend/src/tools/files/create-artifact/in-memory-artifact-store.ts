import crypto from "crypto";
import redis from "../../../config/redis/client.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("artifact-store");

interface Artifact {
  id: string;
  owner_id: string;
  type: string;
  title: string;
  content: string;
  language?: string;
  created_at: string;
}

const artifactStore = new Map<string, Artifact>();
const TTL_MS = 24 * 60 * 60 * 1000;
const TTL_SECONDS = 24 * 60 * 60;
const timers = new Map<string, NodeJS.Timeout>();

export function createArtifact(
  type: string,
  title: string,
  content: string,
  language?: string,
  ownerId?: string,
): Artifact {
  const id = crypto.randomUUID().slice(0, 12);
  const artifact: Artifact = {
    id,
    owner_id: ownerId || 'anonymous',
    type,
    title,
    content,
    language: language || inferLanguage(type),
    created_at: new Date().toISOString(),
  };
  artifactStore.set(id, artifact);

  // Sync to Redis asynchronously if Redis is connected
  try {
    if (typeof redis.setex === "function") {
      redis.setex(`artifact:${id}`, TTL_SECONDS, JSON.stringify(artifact)).catch((err) => {
        log.warn("Failed to persist artifact to Redis", { id, error: err.message });
      });
    }
  } catch (e) {
    // Ignore Redis errors for local fallback
  }

  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const ttlTimer = setTimeout(() => {
    artifactStore.delete(id);
    timers.delete(id);
  }, TTL_MS);
  ttlTimer.unref?.();
  timers.set(id, ttlTimer);

  return artifact;
}

export function getArtifact(id: string, ownerId?: string): Artifact | undefined {
  const artifact = artifactStore.get(id);
  if (!artifact) return undefined;
  if (ownerId && artifact.owner_id !== ownerId && artifact.owner_id !== 'anonymous') {
    return undefined;
  }
  return artifact;
}

export async function getArtifactAsync(id: string, ownerId?: string): Promise<Artifact | undefined> {
  const cached = getArtifact(id, ownerId);
  if (cached) return cached;

  try {
    if (typeof redis.get === "function") {
      const raw = await redis.get(`artifact:${id}`);
      if (raw) {
        const artifact = JSON.parse(raw) as Artifact;
        artifactStore.set(artifact.id, artifact);
        return getArtifact(id, ownerId);
      }
    }
  } catch (e) {
    // Fall back to memory
  }
  return undefined;
}

export function listArtifacts(ownerId?: string): Artifact[] {
  const all = Array.from(artifactStore.values());
  const filtered = ownerId
    ? all.filter((a) => a.owner_id === ownerId)
    : all;
  return filtered.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function inferLanguage(type: string): string | undefined {
  switch (type) {
    case "react":
    case "html": return "html";
    case "svg": return "svg";
    case "mermaid": return "mermaid";
    case "code": return "text";
    case "markdown": return "markdown";
    case "chart": return "json";
    case "quiz": return "json";
    default: return "text";
  }
}
