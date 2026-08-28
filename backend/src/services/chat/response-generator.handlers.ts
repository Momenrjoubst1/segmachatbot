// Stream event handlers: onFinish, persistInterruptedPartial.

import { log } from "../../routes/chat/chat-shared.js";
import { moderateOutput } from "./moderation.service.js";
import { triggerChatTitlingAsync } from "../chat-title-generator.service.js";
import { tryExtractAndStore } from "../memory/memory-context-builder.js";
import { MemoryConfig } from "../../config/memory.config.js";
import { contextCache } from "../memory/context-cache.service.js";
import { enhancedMemory } from "../memory/enhanced-memory.service.js";
import { responseCache } from "./response-cache.service.js";
import { checkGrounding } from "./grounding-check.js";
import { modelRouter } from "../../routes/chat/chat-shared.js";
import type { StreamOptions } from "./response-generator.types.js";

export interface OnFinishContext {
  activeThreadId: string | undefined;
  userId: string | undefined;
  coreMessages: StreamOptions["coreMessages"];
  finalMessages: StreamOptions["finalMessages"];
  conversationSummary: string;
  cacheMetadata?: StreamOptions["cacheMetadata"];
  retrievedDocsForGrounding?: StreamOptions["retrievedDocsForGrounding"];
  reqMetrics: StreamOptions["reqMetrics"];
  MULTI_AGENT_ENABLED: boolean;
}

export async function handleOnFinish(
  text: string | undefined,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined,
  finishReason: string | undefined,
  ctx: OnFinishContext,
  currentModelName: string,
): Promise<void> {
  ctx.reqMetrics.totalTimeMs = Date.now() - (ctx.reqMetrics.startTime as number);

  const visibleText = text ? stripThinkTags(text) : text;

  log.info("chat_metrics", {
    event: "chat_metrics",
    timestamp: new Date().toISOString(),
    metrics: ctx.reqMetrics,
    usage: usage || {},
    finishReason,
    session_id: ctx.activeThreadId,
    mode: ctx.MULTI_AGENT_ENABLED ? "multi-agent" : "single-model",
    model: currentModelName,
  });

  if (!ctx.activeThreadId || !visibleText) return;

  // Grounding check
  if (ctx.retrievedDocsForGrounding && ctx.retrievedDocsForGrounding.length > 0) {
    try {
      const groundingResult = checkGrounding(visibleText, ctx.retrievedDocsForGrounding);
      log.info("Grounding check result", {
        isGrounded: groundingResult.isGrounded,
        percentage: `${groundingResult.groundedPercentage}%`,
        ungroundedClaims: groundingResult.ungroundedClaims.length,
      });
    } catch (groundingErr) {
      log.warn("Grounding check failed", { error: (groundingErr as Error)?.message });
    }
  }

  // Report success to model router
  modelRouter.reportSuccess(currentModelName);

  // Output safety filter
  const safeResponseText = await moderateOutput(visibleText, ctx.userId || "", ctx.activeThreadId);

  // Save assistant response
  const { supabase } = await import("../rag/rag-supabase-client.js");
  const { error: astErr } = await supabase
    .from("chat_messages")
    .insert([{ session_id: ctx.activeThreadId, role: "assistant", content: safeResponseText, model: currentModelName }]);
  if (astErr) log.error("Error saving assistant message", { error: astErr.message });

  // Trigger automatic chat titling
  triggerChatTitlingAsync(ctx.activeThreadId);

  // Background memory extraction
  if (ctx.userId) {
    tryExtractAndStore(
      ctx.userId,
      ctx.coreMessages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })),
      ctx.activeThreadId,
    ).catch((err) => {
      log.error("Background memory extraction failed", {
        error: (err as Error)?.message,
        userId: ctx.userId,
        threadId: ctx.activeThreadId,
      });
    });

    if (MemoryConfig.memoryBank.enabled) {
      try {
        const messagesWithResponse = [
          ...ctx.finalMessages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })),
          { role: "assistant", content: visibleText },
        ];
        const extracted = await enhancedMemory.extractMemories(
          ctx.userId,
          messagesWithResponse as { role: string; content: string }[],
          ctx.activeThreadId,
        );
        if (extracted.length > 0) {
          log.info("Extracted new memories", { count: extracted.length });
        }
      } catch (memError) {
        log.error("Error extracting memories (enhanced)", { error: (memError as Error)?.message });
      }
    }

    if (ctx.conversationSummary && MemoryConfig.caching.enabled) {
      try {
        await contextCache.set(ctx.userId, ctx.conversationSummary, {
          type: "conversation_summary",
          sessionId: ctx.activeThreadId,
          timestamp: Date.now(),
        });
        log.info("Conversation summary cached");
      } catch (cacheError) {
        log.error("Error caching summary", { error: (cacheError as Error)?.message });
      }
    }
  }

  // Cache the response
  if (ctx.cacheMetadata && !ctx.cacheMetadata.bypassed && visibleText) {
    try {
      await responseCache.cacheResponse(
        ctx.cacheMetadata.queryText,
        ctx.cacheMetadata.queryEmbedding,
        visibleText,
        { model: ctx.cacheMetadata.model, ragSources: ctx.cacheMetadata.ragSources },
        ctx.cacheMetadata.userId,
      );
    } catch (cacheErr) {
      log.warn("Failed to cache response", { error: (cacheErr as Error)?.message });
    }
  }
}

export async function persistInterruptedPartial(
  partialVisibleText: string,
  streamCompleted: boolean,
  currentModelName: string,
  activeThreadId: string | undefined,
  userId: string | undefined,
): Promise<void> {
  if (streamCompleted) return;
  const partial = stripThinkTags(partialVisibleText).trim();
  if (!activeThreadId || partial.length < 2) return;

  let safePartial = partial;
  try {
    safePartial = await moderateOutput(partial, userId || "", activeThreadId);
  } catch (modErr) {
    log.warn("Interrupted-partial moderation failed — saving unmoderated", {
      error: (modErr as Error)?.message,
    });
  }

  try {
    const { supabase } = await import("../rag/rag-supabase-client.js");
    const { error: astErr } = await supabase
      .from("chat_messages")
      .insert([{ session_id: activeThreadId, role: "assistant", content: safePartial, model: currentModelName }]);
    if (astErr) {
      log.error("Error saving interrupted assistant message", { error: astErr.message });
    } else {
      log.info("Persisted interrupted partial reply", { session_id: activeThreadId, chars: safePartial.length });
    }
  } catch (err) {
    log.error("persistInterruptedPartial failed", { error: (err as Error)?.message });
  }
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
