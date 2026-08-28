/**
 * Chat attachment media resolution.
 *
 * Sent messages carry only `r2://chat-attachments/{userId}/…` references, so
 * <img>/<video>/<audio>/<iframe> elements cannot render them directly (those
 * elements cannot send Authorization headers). This module resolves a
 * reference to a short-lived browser-usable URL:
 *
 *   1. Backend presigned GET URL (streams with range support — no memory cost)
 *   2. Fallback: authenticated fetch of /attachments/file → blob object URL
 *
 * Resolutions are cached for the tab session; failures are retried on demand.
 */
import { supabase } from "@/lib/supabaseClient";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

const R2_PREFIX = "r2://chat-attachments/";

export function extractR2Key(ref: string): string | null {
  if (!ref.startsWith(R2_PREFIX)) return null;
  try {
    return decodeURIComponent(ref.slice(R2_PREFIX.length));
  } catch {
    return ref.slice(R2_PREFIX.length);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const resolutionCache = new Map<string, Promise<string>>();

/** Resolve one r2 key to a browser-usable URL (cached per key). */
export function resolveChatAttachmentUrl(r2Key: string): Promise<string> {
  const hit = resolutionCache.get(r2Key);
  if (hit) return hit;

  const promise = (async () => {
    // 1) Presigned URL — zero-copy streaming for video/audio/PDF iframes.
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${BACKEND_URL}/api/chat/attachments/view-url?key=${encodeURIComponent(r2Key)}`,
        { headers },
      );
      if (res.ok) {
        const { url } = (await res.json()) as { url?: string };
        if (url) return url;
      }
    } catch {
      /* fall through to blob path */
    }

    // 2) Blob fallback — works even when presigning is unavailable.
    const headers = await authHeaders();
    const res = await fetch(
      `${BACKEND_URL}/api/chat/attachments/file?key=${encodeURIComponent(r2Key)}`,
      { headers },
    );
    if (!res.ok) throw new Error(`attachment fetch failed (${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  })();

  promise.catch(() => resolutionCache.delete(r2Key));
  resolutionCache.set(r2Key, promise);
  return promise;
}

/** Save an attached file to disk via an authenticated stream. Never throws. */
export async function downloadChatAttachment(r2Key: string, fileName: string): Promise<void> {
  try {
    const headers = await authHeaders();
    const res = await fetch(
      `${BACKEND_URL}/api/chat/attachments/file?key=${encodeURIComponent(r2Key)}&download=1&name=${encodeURIComponent(fileName)}`,
      { headers },
    );
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (err) {
    console.warn("[chatAttachmentMedia] download failed", err);
  }
}
