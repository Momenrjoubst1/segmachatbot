/**
 * Step 8 — Persist user message
 *
 * Saves only the last user message (the others are part of the
 * in-flight session history being re-sent for context).
 *
 * Attachment file parts are NOT stored inside `content` (they would bloat the
 * row with base64 / large refs). They are recorded in `chat_attachments` via
 * recordMessageAttachments and re-attached when the thread is fetched.
 */

import { createLogger } from "../../../utils/logger.js";
import {
  extractAttachmentRefs,
  recordMessageAttachments,
  type AttachmentMeta,
} from "../attachments-store.js";
const log = createLogger("pipeline:persist");
import type { CoreMessage } from "./types.js";

/** Compact text for a message whose parts include attachments/media. */
function sanitizeContent(content: string): string {
  // Strip r2:// attachment refs and data: URLs from stored content —
  // metadata lives in chat_attachments, not in the text column.
  return content
    .replace(/r2:\/\/chat-attachments\/[^\s"']+/g, "[attachment]")
    .replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[inline-data]");
}

export async function persistLastUserMessage(args: {
  activeThreadId: string;
  userId?: string;
  coreMessages: CoreMessage[];
  /** Raw UIMessage parts of the last user message, for attachment extraction. */
  rawParts?: unknown;
}): Promise<void> {
  const { activeThreadId, coreMessages } = args;
  const userMessages = coreMessages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return;

  const last = userMessages[userMessages.length - 1];
  const content = typeof last.content === "string"
    ? sanitizeContent(last.content)
    : sanitizeContent(JSON.stringify(last.content));

  const { supabase } = await import("../../rag/rag-supabase-client.js");
  const { data: inserted, error } = await supabase
    .from("chat_messages")
    .insert([{ session_id: activeThreadId, role: "user", content }])
    .select("id")
    .single();

  if (error) {
    log.error("Error saving user message", { error: error.message });
    return;
  }

  // Record attachments against the stored message (best-effort).
  const userId = args.userId;
  const attachments: AttachmentMeta[] = args.rawParts ? extractAttachmentRefs(args.rawParts) : [];
  if (userId && inserted?.id && attachments.length > 0) {
    await recordMessageAttachments({
      userId,
      sessionId: activeThreadId,
      messageId: inserted.id,
      attachments,
    });
  }
}
