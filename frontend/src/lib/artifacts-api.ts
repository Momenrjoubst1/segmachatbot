/**
 * Artifacts API client — typed wrapper around the backend artifacts REST API.
 *
 * Uses the absolute VITE_BACKEND_URL when provided (production may serve the
 * app from a different origin than the API) and falls back to the dev proxy.
 */

import { getAssistantAuthHeaders } from "@/lib/auth";

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export interface Artifact {
  id: string;
  owner_id: string;
  thread_id: string | null;
  type: string;
  title: string;
  content: string;
  language?: string | null;
  version: number;
  visibility: "private" | "public";
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  version: number;
  title: string;
  content: string;
  language?: string | null;
  change_summary?: string | null;
  author: "user" | "assistant";
  created_at: string;
}

function apiUrl(path: string): string {
  return `${BACKEND_URL}${path}`;
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* non-JSON error body */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function listArtifacts(params: {
  threadId?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<Artifact[]> {
  const qs = new URLSearchParams();
  if (params.threadId) qs.set("thread_id", params.threadId);
  if (params.type) qs.set("type", params.type);
  if (params.search) qs.set("search", params.search);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(apiUrl(`/api/artifacts${suffix}`), {
    headers: await getAssistantAuthHeaders(),
  });
  return parse<Artifact[]>(res);
}

export async function getArtifact(id: string): Promise<Artifact> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}`), {
    headers: await getAssistantAuthHeaders(),
  });
  return parse<Artifact>(res);
}

/** Fetch a publicly shared artifact without authentication. */
export async function getPublicArtifact(id: string): Promise<Artifact> {
  const res = await fetch(apiUrl(`/api/public/artifacts/${id}`));
  return parse<Artifact>(res);
}

export async function createArtifact(input: {
  type: string;
  title: string;
  content: string;
  language?: string;
}): Promise<Artifact> {
  const res = await fetch(apiUrl("/api/artifacts"), {
    method: "POST",
    headers: await getAssistantAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parse<Artifact>(res);
}

export async function updateArtifact(
  id: string,
  patch: { title?: string; content?: string; language?: string; change_summary?: string },
): Promise<Artifact> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}`), {
    method: "PATCH",
    headers: await getAssistantAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  return parse<Artifact>(res);
}

export async function deleteArtifact(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}`), {
    method: "DELETE",
    headers: await getAssistantAuthHeaders(),
  });
  await parse<{ status: string }>(res);
}

export async function listVersions(id: string): Promise<ArtifactVersion[]> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}/versions`), {
    headers: await getAssistantAuthHeaders(),
  });
  return parse<ArtifactVersion[]>(res);
}

export async function revertToVersion(id: string, version: number): Promise<Artifact> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}/revert`), {
    method: "POST",
    headers: await getAssistantAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ version }),
  });
  return parse<Artifact>(res);
}

export async function setVisibility(id: string, visibility: "private" | "public"): Promise<Artifact> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}/share`), {
    method: "PATCH",
    headers: await getAssistantAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ visibility }),
  });
  return parse<Artifact>(res);
}

export async function remixArtifact(id: string): Promise<Artifact> {
  const res = await fetch(apiUrl(`/api/artifacts/${id}/remix`), {
    method: "POST",
    headers: await getAssistantAuthHeaders(),
  });
  return parse<Artifact>(res);
}
