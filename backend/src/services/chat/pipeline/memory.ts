/**
 * Step 6 — Memory context
 *
 * Builds the consolidated memory context string (facts + cross-session
 * recall + recent context) for inclusion in the system prompt.
 */

import { memLog } from "../../../routes/chat/chat-shared.js";
import { unifiedMemory } from "../../memory/unified-memory.js";

export interface MemoryContextResult {
  prompt: string;
  stats: {
    factsCount: number;
    crossSessionHits: number;
    totalTimeMs: number;
  };
}

export async function buildMemoryContext(args: {
  userId: string;
  lastUserText: string;
  threadId: string | undefined;
}): Promise<MemoryContextResult> {
  const { userId, lastUserText, threadId } = args;
  try {
    const memResult = await unifiedMemory.buildFullMemoryContext(
      userId,
      lastUserText,
      threadId,
    );
    return memResult;
  } catch (err) {
    memLog.warn("Failed to build consolidated memory context", {
      error: (err as Error)?.message,
    });
    return { prompt: "", stats: { factsCount: 0, crossSessionHits: 0, totalTimeMs: 0 } };
  }
}
