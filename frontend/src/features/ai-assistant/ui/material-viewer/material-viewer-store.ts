/**
 * Viewer state for material cards. A single global dialog instance (mounted
 * in AssistantApp) is driven by this store; cards anywhere in the chat open
 * it via `openMaterialViewer`.
 */

import { create } from "zustand";
import { authFetch } from "@/lib/auth";
import type { MaterialRef } from "./material-link";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

export interface MaterialDetails {
  textbookId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  totalPages: number | null;
  status: string | null;
  courseId: string | null;
  source: "r2" | "external" | "local" | "unavailable";
  url: string | null;
  expiresInSeconds?: number;
}

interface ResolvedMaterial {
  details: MaterialDetails;
  /** Absolute epoch-ms after which the presigned URL should be refreshed. */
  expiresAt: number;
}

interface MaterialViewerState {
  isOpen: boolean;
  items: MaterialRef[];
  index: number;
  openMaterialViewer: (items: MaterialRef[], startIndex?: number) => void;
  closeMaterialViewer: () => void;
  nextItem: () => void;
  prevItem: () => void;
}

export const useMaterialViewer = create<MaterialViewerState>((set, get) => ({
  isOpen: false,
  items: [],
  index: 0,

  openMaterialViewer: (items, startIndex = 0) => {
    if (!items.length) return;
    set({ isOpen: true, items, index: Math.min(Math.max(startIndex, 0), items.length - 1) });
  },

  closeMaterialViewer: () => set({ isOpen: false }),

  nextItem: () => {
    const { index, items } = get();
    if (index < items.length - 1) set({ index: index + 1 });
  },

  prevItem: () => {
    const { index } = get();
    if (index > 0) set({ index: index - 1 });
  },
}));

// ── Presigned-URL resolution with a small session cache ─────────────────────

// Module-level (outside zustand) — large maps shouldn't live in component
// state and the cache must survive dialog unmount/remount.
const resolveCache = new Map<string, ResolvedMaterial>();
const CACHE_TTL_MS = 50 * 60 * 1000; // presign TTL is 1h — refresh early

function cachedValid(id: string): ResolvedMaterial | null {
  const hit = resolveCache.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit;
  if (hit) resolveCache.delete(id);
  return null;
}

/**
 * Resolve a MaterialRef into full details + a browser-displayable URL.
 * Uses GET /api/textbooks/:id/file-url (ownership-checked server-side).
 */
export async function fetchMaterialDetails(ref: MaterialRef): Promise<MaterialDetails> {
  const cached = cachedValid(ref.id);
  if (cached) return cached.details;

  let res: Response;
  try {
    res = await authFetch(`${BACKEND_URL}/api/textbooks/${encodeURIComponent(ref.id)}/file-url`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("SESSION_EXPIRED")) throw err;
    throw new Error("NETWORK_ERROR");
  }

  if (!res.ok) {
    if (res.status === 404) throw new Error("NOT_FOUND");
    if (res.status === 503) throw new Error("STORAGE_UNAVAILABLE");
    if (res.status === 409) throw new Error("NOT_READY");
    throw new Error("FETCH_FAILED");
  }

  const details = (await res.json()) as MaterialDetails;

  // external/local sources have no expiry; presigned URLs refresh at 80% TTL
  const ttlMs =
    details.source === "r2" && details.expiresInSeconds
      ? Math.max(details.expiresInSeconds * 1000 * 0.8, 60_000)
      : Number.MAX_SAFE_INTEGER;
  resolveCache.set(ref.id, { details, expiresAt: Date.now() + Math.min(ttlMs, CACHE_TTL_MS * 2) });

  return details;
}

/** Invalidate after errors so a retry actually re-fetches. */
export function invalidateMaterialCache(id: string): void {
  resolveCache.delete(id);
}
