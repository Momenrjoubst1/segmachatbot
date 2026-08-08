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

/** Tools that receive `__userId` in their execute args. */
const TOOLS_NEEDING_USER_ID: ReadonlySet<string> = new Set([
  "send_email",
  "get_email_history",
  "get_email_details",
  "delete_email",
  "resend_email",
  "get_email_stats",
  "save_email_contact",
  "get_email_contacts",
  "delete_email_contact",
  "create_calendar_event",
  "get_upcoming_events",
  "find_free_slots",
  "get_calendar_insights",
  "delete_calendar_event",
  "update_calendar_event",
  "find_optimal_time",
  "email_to_meeting",
]);

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
    const processed = await processAndModerate(messages, selectedModel, metrics);
    if (processed.blocked) {
      res.status(400).json({ error: processed.blockError });
      return;
    }
    const { coreMessages, hasImages: _hasImages } = processed;

    // ---- Step 4: User courses ----
    const userCoursesContext = await fetchUserCoursesContext(userId);

    // ---- Step 4b: Intent ----
    const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === "user");
    const lastUserText = lastUserMsg ? extractText(lastUserMsg.content) : "";
    const intentResult = await detectUserIntent(coreMessages, userId);
    metrics.intent = intentResult.intent;
    metrics.intentConfidence = intentResult.confidence;

    // ---- Step 5: RAG ----
    const ragResult = await runRagPipeline({
      coreMessages,
      lastUserText,
      userId,
      selectedModel,
      intentResult,
      userCoursesContext,
      ragEnabled,
      threadId,
      res,
    });

    if (ragResult.responseCacheHit) {
      // Cache hit was already streamed by the RAG step
      return;
    }

    metrics.ragSuccess = ragResult.ragSuccess;
    metrics.ragDocsCount = ragResult.rankedDocs.length;
    metrics.ragSources = ragResult.ragSources;

    // ---- Step 6: Memory context ----
    const memResult = await buildMemoryContext({ userId, lastUserText, threadId });
    const memoryPrompt = memResult.prompt;

    // ---- Step 6b: System prompt ----
    const { systemPrompt: augmentedSystemPrompt, basePersona } = assembleSystemPrompt({
      ragContext: ragResult.ragContext,
      userCoursesContext,
      memoryPrompt,
    });

    // ---- Step 7: Thread management ----
    const threadResult = await resolveThread({
      req,
      threadId,
      clientChatGuid,
      courseId,
      userId,
    });
    if (!threadResult.ok) {
      res.status(threadResult.status).json({ error: threadResult.error });
      return;
    }
    const { activeThreadId, reused } = threadResult;
    metrics.threadReused = reused;

    // Stream headers
    if (activeThreadId && !threadId) {
      res.setHeader("X-Thread-Id", activeThreadId);
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // ---- Step 8: Persist user message ----
    await persistLastUserMessage({ activeThreadId, coreMessages });

    // ---- Step 9: Manage context window ----
    const { finalMessages, conversationSummary } = await manageContextWindow({
      coreMessages,
      userId,
    });

    // ---- Step 10: UI fast-passes ----
    const fastPass = await runUIFastPasses({ res, coreMessages, userId });
    if (fastPass.terminal) return;
    metrics.uiActionInjected = fastPass.injected;

    // ---- Step 10: Stream final response ----
    const enabledTools = buildEnabledTools(userId, intentResult.intent);
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
    });
  } catch (error) {
    log.error("Stream Error", {
      error: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Stream Error",
      });
    } else {
      try {
        res.write(
          `3:${JSON.stringify({ error: "Internal Stream Error" })}\n`,
        );
        res.end();
      } catch (writeErr) {
        log.error("Failed to write error chunk to response", { error: writeErr });
      }
    }
  }
}
