/**
 * Chat Pipeline — Orchestrator
 *
 * Composes the per-step modules in `pipeline/`.  Each step has a single
 * responsibility and is independently testable; this file is just the
 * glue that wires them together.
 *
 * Steps:
 *  1. validateAndPrepareRequest      → request validation
 *  2. processAndModerate              → message processing + moderation
 *  3. fetchUserCoursesContext         → student courses
 *  4. detectUserIntent                → intent classification
 *  5. runRagPipeline                  → RAG retrieval
 *  6. buildMemoryContext              → memory context
 *  6b. assembleSystemPrompt           → system prompt assembly
 *  7. resolveThread                   → thread management
 *  8. persistLastUserMessage          → persist user message
 *  9. manageContextWindow             → summarisation / trimming
 * 10. runUIFastPasses                 → UI action fast-passes
 *     generateAndStreamResponse       → final LLM streaming
 */

import type { Request, Response } from "express";
import { log, summarizeMessageForLog, getProviderAndModel, createProviderClient } from "../../routes/chat/chat-shared.js";
import { generateAndStreamResponse } from "./response-generator.service.js";
import { TOOL_DEFINITIONS } from "../../tools/tool-definitions-aggregator.js";
import { isWebSearchAvailable } from "../../tools/web/search/index.js";
import { isEmailAvailable } from "../../tools/email/send/index.js";
import type { ToolDefinition } from "../../tools/shared/types.js";
import { getToolsRequiringUserId } from "../../tools/tool-metadata.js";
import { withTimeout, TIMEOUTS } from "../../utils/timeout-wrapper.js";

import { validateAndPrepareRequest } from "./pipeline/validation.js";
import { processAndModerate } from "./pipeline/input-processing.js";
import { fetchUserCoursesContext } from "./pipeline/user-courses.js";
import { detectUserIntent } from "./pipeline/intent.js";
import { runRagPipeline } from "./pipeline/rag-retrieval.js";
import { buildMemoryContext } from "./pipeline/memory.js";
import { assembleSystemPrompt } from "./pipeline/system-prompt.js";
import { resolveThread } from "./pipeline/thread.js";
import { persistLastUserMessage } from "./pipeline/persist.js";
import { manageContextWindow } from "./pipeline/summarization.js";
import { runUIFastPasses } from "./pipeline/ui-fastpass.js";
import type { CoreMessage } from "./moderation.service.js";

/** Tools that receive `__userId` in their execute args - now from metadata system */
const TOOLS_NEEDING_USER_ID: ReadonlySet<string> = new Set(getToolsRequiringUserId());

/** Builds the `enabledTools` map for the response generator. Filtered by intent to prevent token overflows. */
function buildEnabledTools(userId: string, intent?: string): Record<string, ToolDefinition> {
  // For small talk or knowledge queries without specific tool needs, send NO tools to save tokens
  if (intent === "small_talk") {
    return {};
  }

  const enabled: Record<string, ToolDefinition> = {};
  for (const [name, def] of Object.entries(TOOL_DEFINITIONS) as Array<[string, ToolDefinition]>) {
    if (name === "web_search" && !isWebSearchAvailable()) continue;
    if (name === "send_email" && !isEmailAvailable()) continue;

    if (TOOLS_NEEDING_USER_ID.has(name)) {
      enabled[name] = {
        ...def,
        execute: (args: Record<string, unknown>) =>
          def.execute({ ...args, __userId: userId }),
      };
    } else {
      enabled[name] = def;
    }
  }
  return enabled;
}

function extractText(content: CoreMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => p?.type === "text")
      .map((p) => p.text ?? "")
      .join(" ");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function executeChatPipeline(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // ---- Step 1: Validation ----
    const validation = validateAndPrepareRequest(req);
    if (!validation.ok) {
      res.status(validation.status).json(validation.payload);
      return;
    }

    const {
      selectedModel,
      userId,
      metrics,
      messages,
      ragEnabled,
      threadId,
      courseId,
      clientChatGuid,
    } = validation;

    log.debug("Incoming messages summary", {
      count: messages.length,
      messages: messages.map((m) => summarizeMessageForLog(m as { role?: string; content?: unknown; parts?: unknown } | null)),
    });

    // Provider / model
    const { provider, modelName } = getProviderAndModel(selectedModel);
    log.info("Using model", { model: modelName, provider });
    const client = createProviderClient(provider as Parameters<typeof createProviderClient>[0]);

    // ---- Step 2+3: Process & moderate ----
    const processed = await withTimeout(
      processAndModerate(messages, selectedModel, metrics),
      {
        timeoutMs: TIMEOUTS.MODERATION,
        operationName: 'moderation',
        errorMessage: 'Content moderation timed out',
      }
    );
    if (processed.blocked) {
      res.status(400).json({ error: processed.blockError });
      return;
    }
    const { coreMessages, hasImages: _hasImages } = processed;

    // ---- Step 4: User courses ----
    const userCoursesContext = await withTimeout(
      fetchUserCoursesContext(userId),
      {
        timeoutMs: TIMEOUTS.DB_QUERY,
        operationName: 'fetch_user_courses',
        errorMessage: 'User courses fetch timed out',
      }
    );

    // ---- Step 4c: thread-scoped regular-file context (chat attachments
    // the user declined to promote to materials) ----
    let threadFileContext = "";
    try {
      const { getThreadFileContext } = await import("./chat-file-router.js");
      threadFileContext = await getThreadFileContext(threadId);
    } catch { /* non-fatal */ }

    // ---- Step 4b: Intent ----
    const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === "user");
    const lastUserText = lastUserMsg ? extractText(lastUserMsg.content) : "";
    const intentResult = await withTimeout(
      detectUserIntent(coreMessages, userId),
      {
        timeoutMs: TIMEOUTS.INTENT_DETECTION,
        operationName: 'intent_detection',
        errorMessage: 'Intent detection timed out',
      }
    );
    metrics.intent = intentResult.intent;
    metrics.intentConfidence = intentResult.confidence;

    // ---- Step 5: RAG ----
    const ragResult = await withTimeout(
      runRagPipeline({
        coreMessages,
        lastUserText,
        userId,
        selectedModel,
        intentResult,
        userCoursesContext,
        ragEnabled,
        threadId,
        res,
      }),
      {
        timeoutMs: TIMEOUTS.RAG_RETRIEVAL + TIMEOUTS.RAG_RERANKING,
        operationName: 'rag_pipeline',
        errorMessage: 'RAG pipeline timed out',
      }
    );

    if (ragResult.responseCacheHit) {
      // Cache hit was already streamed by the RAG step
      return;
    }

    metrics.ragSuccess = ragResult.ragSuccess;
    metrics.ragDocsCount = ragResult.rankedDocs.length;
    metrics.ragSources = ragResult.ragSources;

    // ---- Step 6: Memory context ----
    const memResult = await withTimeout(
      buildMemoryContext({ userId, lastUserText, threadId }),
      {
        timeoutMs: TIMEOUTS.MEMORY_RETRIEVAL,
        operationName: 'memory_context',
        errorMessage: 'Memory context building timed out',
      }
    );
    const memoryPrompt = memResult.prompt;

    // ---- Step 6b: System prompt ----
    const { systemPrompt: augmentedSystemPrompt, basePersona } = assembleSystemPrompt({
      ragContext: ragResult.ragContext,
      userCoursesContext: userCoursesContext + threadFileContext,
      memoryPrompt,
    });

    // ---- Step 7: Thread management ----
    const threadResult = await withTimeout(
      resolveThread({
        req,
        threadId,
        clientChatGuid,
        courseId,
        userId,
      }),
      {
        timeoutMs: TIMEOUTS.DB_WRITE,
        operationName: 'thread_resolution',
        errorMessage: 'Thread resolution timed out',
      }
    );
    if (!threadResult.ok) {
      res.status(threadResult.status).json({ error: threadResult.error });
      return;
    }
    const { activeThreadId, reused } = threadResult;
    metrics.threadReused = reused;

    // ---- Step 7b: chat file routing (material vs regular file) ----
    // Intercepts PDF attachments: asks the user, promotes to the material
    // pipeline, or binds the text to this thread. Streams a canned reply.
    try {
      const { handleChatFileFlow } = await import("./chat-file-router.js");
      const handled = await handleChatFileFlow({ userId, threadId: activeThreadId, messages, res });
      if (handled) {
        metrics.chatFileRouted = true;
        return;
      }
    } catch (fileErr) {
      log.warn("chat file routing failed (non-fatal)", {
        error: (fileErr as Error).message,
      });
    }

    // Stream headers
    if (activeThreadId && !threadId) {
      res.setHeader("X-Thread-Id", activeThreadId);
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Include model fallback information in response headers
    if (validation.modelFallback) {
      res.setHeader("X-Model-Fallback", JSON.stringify(validation.modelFallback));
    }

    // ---- Step 8: Persist user message ----
    await withTimeout(
      persistLastUserMessage({ activeThreadId, coreMessages }),
      {
        timeoutMs: TIMEOUTS.DB_WRITE,
        operationName: 'persist_message',
        errorMessage: 'Message persistence timed out',
      }
    );

    // ---- Step 9: Manage context window ----
    const { finalMessages, conversationSummary } = await withTimeout(
      manageContextWindow({
        coreMessages,
        userId,
      }),
      {
        timeoutMs: TIMEOUTS.PIPELINE_STEP,
        operationName: 'context_window',
        errorMessage: 'Context window management timed out',
      }
    );

    // ---- Step 10: UI fast-passes ----
    const fastPass = await withTimeout(
      runUIFastPasses({ res, coreMessages, userId }),
      {
        timeoutMs: TIMEOUTS.PIPELINE_STEP,
        operationName: 'ui_fastpass',
        errorMessage: 'UI fast-pass timed out',
      }
    );
    if (fastPass.terminal) return;
    metrics.uiActionInjected = fastPass.injected;

    // ---- Step 10: Stream final response ----
    const enabledTools = buildEnabledTools(userId, intentResult.intent);
    
    // Include model fallback information in the response
    const responseMetadata = validation.modelFallback 
      ? { modelFallback: validation.modelFallback }
      : {};
    
    await generateAndStreamResponse({
      client,
      modelName,
      finalMessages,
      finalSystemPrompt: augmentedSystemPrompt,
      basePersona,
      enabledTools,
      activeThreadId,
      userId,
      coreMessages,
      conversationSummary,
      augmentedSystemPrompt,
      reqMetrics: metrics,
      res,
      cacheMetadata: ragResult.cacheMetadata,
      retrievedDocsForGrounding: ragResult.rankedDocs,
      metadata: responseMetadata,
    });
  } catch (error) {
    const err = error as Error;
    const isTimeout = (err as any)?.code === 'TIMEOUT';
    const errorMessage = isTimeout
      ? 'Operation timed out. Please try again.'
      : 'Internal Stream Error';
    
    log.error("Stream Error", {
      error: err.message,
      stack: err.stack,
      isTimeout,
      operationName: (err as any)?.operationName,
    });
    
    if (!res.headersSent) {
      res.status(isTimeout ? 504 : 500).json({
        error: errorMessage,
      });
    } else {
      try {
        res.write(
          `3:${JSON.stringify({ error: errorMessage })}\n`,
        );
        res.end();
      } catch (writeErr) {
        log.error("Failed to write error chunk to response", { error: writeErr });
      }
    }
  }
}
