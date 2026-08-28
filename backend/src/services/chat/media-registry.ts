// Per-request registry mapping ⟦MEDIA:<id>⟧ sentinel texts to attachment payloads.
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";

export interface MediaPayload {
  kind: "video" | "audio";
  /** e.g. video/mp4, audio/mpeg */
  mediaType: string;
  filename: string;
  /** Inline data URL (small files). Preferred when within size budget. */
  dataUrl?: string;
  /** Remote https URL (presigned R2 GET) for large files. */
  url?: string;
  /** Whisper transcript fallback for audio a provider cannot ingest. */
  transcript?: string;
}

const registryStorage = new AsyncLocalStorage<Map<string, MediaPayload>>();

const SENTINEL_PREFIX = "⟦MEDIA:";
const SENTINEL_SUFFIX = "⟧";
export const MEDIA_SENTINEL_RE = /⟦MEDIA:([a-z0-9-]+)⟧/g;

export function makeMediaSentinel(id: string): string {
  return `${SENTINEL_PREFIX}${id}${SENTINEL_SUFFIX}`;
}

/** Run `fn` with a fresh media registry bound to its async context. */
export async function runWithMediaRegistry<T>(fn: () => Promise<T>): Promise<T> {
  return registryStorage.run(new Map<string, MediaPayload>(), fn);
}

/** Register a payload; returns the sentinel text that references it. */
export function registerMediaPayload(payload: MediaPayload): string {
  const store = registryStorage.getStore();
  const id = crypto.randomUUID();
  if (store) store.set(id, payload);
  return makeMediaSentinel(id);
}

/** Snapshot of the current request's payloads (empty outside a registry). */
export function getMediaRegistry(): Map<string, MediaPayload> {
  return registryStorage.getStore() ?? new Map<string, MediaPayload>();
}
