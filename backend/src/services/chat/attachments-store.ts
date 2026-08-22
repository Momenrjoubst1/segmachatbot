/**
 * Chat attachments store — metadata persistence + extraction.
 *
 * The binary lives in R2; this module records one `chat_attachments` row per
 * attached file so thread history can restore attachments after reload, and
 * powers usage reporting. Extraction walks the raw UIMessage parts sent by the
 * client (file parts carrying `r2://chat-attachments/{userId}/…` refs).
 */
import { createLogger } from "../../utils/logger.js";

const log = createLogger("attachments-store");

export type AttachmentKind = "video" | "audio" | "image" | "document" | "text";

/** Wire shape shared with the frontend upload response / message parts. */
export interface AttachmentMeta {
  r2Key: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  sizeBytes: number;
}

interface RawPartLike {
  type?: string;
  url?: string;
  data?: string;
  filename?: string;
  fileName?: string;
  mimeType?: string;
  mediaType?: string;
}

const R2_REF_PREFIX = "r2://chat-attachments/";

/**
 * Extract attachment metadata from a user message's raw parts. Only accepts
 * r2:// references produced by the upload endpoint — inline base64 payloads
 * are ignored here (legacy flow never had persistence).
 */
export function extractAttachmentRefs(parts: unknown): AttachmentMeta[] {
  if (!Array.isArray(parts)) return [];
  const out: AttachmentMeta[] = [];
  for (const part of parts as RawPartLike[]) {
    if (!part || typeof part !== "object") continue;
    if (part.type !== "file" && !part.url) continue;
    const ref = typeof part.url === "string" && part.url.startsWith(R2_REF_PREFIX)
      ? part.url
      : typeof part.data === "string" && part.data.startsWith(R2_REF_PREFIX)
        ? part.data
        : null;
    if (!ref) continue;

    let key = "";
    try {
      key = decodeURIComponent(new URL(ref).pathname.slice(1));
    } catch {
      key = ref.slice(R2_REF_PREFIX.length);
    }
    // Ownership prefix is re-verified by the caller against req.user.id.
    out.push({
      r2Key: key,
      fileName: String(part.filename || part.fileName || key.split("/").pop() || "attachment").substring(0, 200),
      mimeType: String(part.mimeType || part.mediaType || "application/octet-stream"),
      kind: guessKind(part.mimeType || part.mediaType || "", part.filename || part.fileName || ""),
      sizeBytes: 0, // backfilled from the upload row when known
    });
  }
  return out.filter((a) => a.r2Key.startsWith("chat-attachments/"));
}

function guessKind(mimeType: string, fileName: string): AttachmentKind {
  const mt = mimeType.split(";")[0].toLowerCase();
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("image/")) return "image";
  if (mt === "text/plain" || mt === "application/json" || mt.startsWith("text/")) {
    // csv/md/html/xml live under text/* but are routed as documents upstream
    const ext = ("." + (fileName.split(".").pop() || "")).toLowerCase();
    return [".txt", ".json", ".js", ".ts", ".py", ".css", ".log"].includes(ext) ? "text" : "document";
  }
  return "document";
}

/**
 * Persist attachment rows for a stored chat message. Best-effort: a failed
 * insert logs a warning and never breaks the chat response.
 */
export async function recordMessageAttachments(args: {
  userId: string;
  sessionId: string;
  messageId: string;
  attachments: AttachmentMeta[];
}): Promise<void> {
  const { userId, sessionId, messageId, attachments } = args;
  if (!attachments.length) return;
  try {
    const { supabase } = await import("../rag/rag-supabase-client.js");
    const rows = attachments.map((a) => ({
      user_id: userId,
      session_id: sessionId,
      message_id: messageId,
      r2_key: a.r2Key,
      file_name: a.fileName,
      mime_type: a.mimeType,
      kind: a.kind,
      status: "uploaded",
      size_bytes: a.sizeBytes,
    }));
    const { error } = await supabase.from("chat_attachments").upsert(rows, {
      onConflict: "r2_key",
      ignoreDuplicates: false,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    log.warn("Failed to record chat attachments", {
      userId,
      messageId,
      count: attachments.length,
      error: (err as Error).message,
    });
  }
}

/** Attachments grouped by message_id for the given chat messages. */
export async function getAttachmentsByMessageIds(
  messageIds: string[]
): Promise<Map<string, AttachmentMeta[]>> {
  const byMessage = new Map<string, AttachmentMeta[]>();
  if (messageIds.length === 0) return byMessage;
  try {
    const { supabase } = await import("../rag/rag-supabase-client.js");
    const { data, error } = await supabase
      .from("chat_attachments")
      .select("message_id, r2_key, file_name, mime_type, kind, size_bytes")
      .in("message_id", messageIds);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (!row.message_id) continue;
      const list = byMessage.get(row.message_id) ?? [];
      list.push({
        r2Key: row.r2_key,
        fileName: row.file_name,
        mimeType: row.mime_type,
        kind: row.kind as AttachmentKind,
        sizeBytes: Number(row.size_bytes || 0),
      });
      byMessage.set(row.message_id, list);
    }
  } catch (err) {
    log.warn("Failed to load chat attachments", { error: (err as Error).message });
  }
  return byMessage;
}
