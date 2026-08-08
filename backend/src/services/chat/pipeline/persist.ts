/**
 * Step 8 — Persist user message
 *
 * Saves only the last user message (the others are part of the
 * in-flight session history being re-sent for context).
 */

import { createLogger } from "../../../utils/logger.js";
const log = createLogger("pipeline:persist");
import type { CoreMessage } from "./types.js";

export async function persistLastUserMessage(args: {
  activeThreadId: string;
  coreMessages: CoreMessage[];
}): Promise<void> {
  const { activeThreadId, coreMessages } = args;
  const userMessages = coreMessages.filter((m) => m.role === "user");
  if (userMessages.length === 0) return;

  const last = userMessages[userMessages.length - 1];
  const content = typeof last.content === "string"
    ? last.content
    : JSON.stringify(last.content);

  const { supabase } = await import("../../rag/rag-supabase-client.js");
  const { error } = await supabase.from("chat_messages").insert([{
    session_id: activeThreadId,
    role: "user",
    content,
  }]);

  if (error) {
    log.error("Error saving user message", { error: error.message });
  }
}
