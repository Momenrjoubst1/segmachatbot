/**
 * Chat attachment upload — streaming multipart client for composer files.
 *
 * Large PDFs are uploaded to the backend (multer streams to disk, then R2)
 * and referenced in chat messages as `r2://<key>`. XHR is used instead of
 * fetch so upload progress can drive the composer's pending-attachment UI.
 */

import { supabase } from "@/lib/supabaseClient";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

export interface UploadedChatAttachment {
  r2Key: string;
  fileName: string;
  mimeType: string;
  /** video | audio | image | document | text — mirrors the backend registry. */
  kind?: string;
  sizeBytes: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Upload a PDF chat attachment with progress reporting.
 * Resolves with the server-assigned R2 key; rejects with an Error whose
 * message comes from the server response when available.
 */
export function uploadChatAttachment(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedChatAttachment> {
  return new Promise<UploadedChatAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress && e.total > 0) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedChatAttachment);
        } catch {
          reject(new Error("Invalid server response"));
        }
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch { /* non-JSON body */ }
      reject(new Error(message));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed — check your connection")));
    xhr.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));

    void supabase.auth.getSession().then(({ data }) => {
      xhr.open("POST", `${BACKEND_URL}/api/chat/attachments`);
      const token = data.session?.access_token;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.send(formData);
    });
  });
}

/** Best-effort delete of a previously uploaded attachment. Never throws. */
export async function deleteChatAttachment(r2Key: string): Promise<void> {
  try {
    const headers = await authHeaders();
    const res = await fetch(
      `${BACKEND_URL}/api/chat/attachments?key=${encodeURIComponent(r2Key)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok && res.status !== 404) {
      console.warn("[chatAttachmentUpload] delete failed", res.status);
    }
  } catch (err) {
    // Orphans are acceptable here — the object lives under the user's own
    // prefix and the backend supersedes stale pending files per user.
    console.warn("[chatAttachmentUpload] delete error", err);
  }
}
