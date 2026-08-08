/**
 * Step 4b — Intent detection
 *
 * Heuristic-based (no LLM) intent classifier.  Lets the pipeline skip the
 * expensive RAG + tool setup when the user is just making small talk.
 */

import { ragLog } from "../../../routes/chat/chat-shared.js";
import { detectIntent, type IntentResult, UserIntent } from "../intent-detector.js";
import type { CoreMessage } from "./types.js";

const DEFAULT_INTENT: IntentResult = {
  intent: UserIntent.KNOWLEDGE_QUERY,
  confidence: 0.5,
  needsRAG: true,
  needsTools: false,
};

/** Extracts plain text from a CoreMessage's content. */
function extractPlainText(content: CoreMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ");
  }
  return "";
}

export async function detectUserIntent(
  coreMessages: CoreMessage[],
  userId: string,
): Promise<IntentResult> {
  try {
    const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return DEFAULT_INTENT;

    const text = extractPlainText(lastUserMsg.content);
    if (!text) return DEFAULT_INTENT;

    const result = await detectIntent(text, coreMessages, { userId });
    ragLog.info("Intent detection result", {
      intent: result.intent,
      confidence: result.confidence,
      needsRAG: result.needsRAG,
      needsTools: result.needsTools,
    });
    return result;
  } catch (err) {
    ragLog.warn("Intent detection failed, defaulting to RAG enabled", {
      error: (err as Error)?.message,
    });
    return DEFAULT_INTENT;
  }
}
