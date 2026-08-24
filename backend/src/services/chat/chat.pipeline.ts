/**
 * Chat Pipeline â€” Orchestrator
 *
 * Composes the per-step modules in `pipeline/`.  Each step has a single
 * responsibility and is independently testable; this file is just the
 * glue that wires them together.
 *
 * Steps:
 *  1. validateAndPrepareRequest      â†’ request validation
 *  2. processAndModerate              â†’ message processing + moderation
 *  3. fetchUserCoursesContext         â†’ student courses
 *  4. detectUserIntent                â†’ intent classification
 *  5. runRagPipeline                  â†’ RAG retrieval
 *  6. buildMemoryContext              â†’ memory context
 *  6b. assembleSystemPrompt           â†’ system prompt assembly
 *  7. resolveThread                   â†’ thread management
 *  8. persistLastUserMessage          â†’ persist user message
 *  9. manageContextWindow             â†’ summarisation / trimming
 * 10. runUIFastPasses                 â†’ UI action fast-passes
 *     generateAndStreamResponse       â†’ final LLM streaming
 */

import type { Request, Response } from "express";
import { log, summarizeMessageForLog, getProviderAndModel, createProviderClient } from "../../routes/chat/chat-shared.js";
import { generateAndStreamResponse } from "./response-generator.service.js";
import { getToolDefinitions } from "../../tools/tool-definitions-aggregator.js";
import { isWebSearchAvailable } from "../../tools/web/search/index.js";
import { isEmailAvailable } from "../../tools/email/send/index.js";
import type { ToolDefinition } from "../../tools/shared/types.js";
import { getToolsRequiringUserId } from "../../tools/tool-metadata.js";
import { withTimeout, TIMEOUTS } from "../../utils/timeout-wrapper.js";
import { StepEventEmitter } from "./step-event-emitter.js";
import { getTextbookQAModel, getVisionModel } from "./model-router.js";
import { isVisionCapableModel } from "./message-processor.service.js";

import { validateAndPrepareRequest } from "./pipeline/validation.js";
import { processAndModerate } from "./pipeline/input-processing.js";
import { fetchCombinedUserContext } from "./pipeline/user-courses.js";
import { detectUserIntent } from "./pipeline/intent.js";
import { runRagPipeline } from "./pipeline/rag-retrieval.js";
import { buildMemoryContext } from "./pipeline/memory.js";
import { assembleSystemPrompt } from "./pipeline/system-prompt.js";
import { resolveThread } from "./pipeline/thread.js";
import { persistLastUserMessage } from "./pipeline/persist.js";
import { getMediaRequirements, supportsMedia, getMediaFallbackModel, hasOversizedVideo } from "./media-router.js";
import { runWithMediaRegistry } from "./media-registry.js";
import { manageContextWindow } from "./pipeline/summarization.js";
import { runUIFastPasses } from "./pipeline/ui-fastpass.js";
import { injectUIActionToStream, panelOpenArtifacts } from "./ui-action-emitter.js";
import type { CoreMessage } from "./moderation.service.js";

function cleanSourceName(source?: string): string {
  if (!source) return "Knowledge Base";
  return source
    .replace(/^Textbook:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]/g, " ")
    .trim() || "Knowledge Base";
}

/** Builds the `enabledTools` map for the response generator. Filtered by intent to prevent token overflows. */
function buildEnabledTools(
  userId: string,
  intent?: string,
  hasTextbookChunks?: boolean,
  streamHooks?: { res?: Response; activeThreadId?: string | null },
  webSearchEnabled = true,
): Record<string, ToolDefinition> {
  // Resolved per call: tool modules register their metadata during initTools(),
  // which may run after this module is first imported.
  const TOOLS_NEEDING_USER_ID: ReadonlySet<string> = new Set(getToolsRequiringUserId());
  // For small talk or knowledge queries without specific tool needs, send NO tools to save tokens
  if (intent === "small_talk") {
    return {};
  }

  // If no specific intent detected, send a minimal tool set to stay under TPM limits
  const isSpecificIntent = intent && intent !== "small_talk" && intent !== "general";

  const enabled: Record<string, ToolDefinition> = {};
  for (const [name, def] of Object.entries(getToolDefinitions()) as Array<[string, ToolDefinition]>) {
    if (name === "web_search" && (!isWebSearchAvailable() || !webSearchEnabled)) continue;
    if (name === "send_email" && !isEmailAvailable()) continue;

    // Artifact tools must survive the general-intent filter: a request like
    // "Ø§Ø¹Ù…Ù„ Ù„ÙŠ ØµÙØ­Ø© ÙˆÙŠØ¨" classifies as general but still needs them.
    const ARTIFACT_TOOLS = new Set(["create_artifact", "update_artifact"]);

    // For general queries, only send essential tools to reduce token usage
    if (!isSpecificIntent) {
      const ESSENTIAL_TOOLS = new Set(["get_time", "get_weather", "calculator", "web_search"]);
      // Education tools always pass when textbook chunks are present
      const EDUCATION_TOOLS = new Set(["record_quiz_result", "generate_flashcards"]);
      if (!ESSENTIAL_TOOLS.has(name) && !ARTIFACT_TOOLS.has(name) && !(hasTextbookChunks && EDUCATION_TOOLS.has(name))) continue;
    }

    if (TOOLS_NEEDING_USER_ID.has(name)) {
      // Per-request dedupe for the auto-open action below.
      const openedArtifactIds = new Set<string>();
      enabled[name] = {
        ...def,
        execute: async (args: Record<string, unknown>) => {
          const result = await def.execute({
            ...args,
            __userId: userId,
            __threadId: streamHooks?.activeThreadId ?? null,
          });
          // When a tool produces an artifact mid-stream, pop the artifact panel
          // open and focus it â€” mirrors Claude's creation flow.
          if (streamHooks?.res && typeof result === "string") {
            try {
              const parsed = JSON.parse(result) as { status?: string; artifact_id?: string };
              if (
                parsed?.status === "success" &&
                parsed.artifact_id &&
                !openedArtifactIds.has(parsed.artifact_id)
              ) {
                openedArtifactIds.add(parsed.artifact_id);
                injectUIActionToStream(streamHooks.res, panelOpenArtifacts(parsed.artifact_id));
              }
            } catch {
              // non-JSON tool results have no artifacts to focus
            }
          }
          return result;
        },
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
  // The media registry must span message processing AND the outbound model
  // fetch â€” AsyncLocalStorage carries it across the whole request.
  return runWithMediaRegistry(() => executeChatPipelineInner(req, res));
}

async function executeChatPipelineInner(
  req: Request,
  res: Response,
): Promise<void> {
  const steps = new StepEventEmitter();
  try {
    // ---- Step 1: Validation ----
    const validation = validateAndPrepareRequest(req);
    if (!validation.ok) {
      res.status(validation.status).json(validation.payload);
      return;
    }

    const {
      selectedModel,
      selectedEffort,
      webSearchEnabled,
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
      effort: selectedEffort,
      messages: messages.map((m) => summarizeMessageForLog(m as { role?: string; content?: unknown; parts?: unknown } | null)),
    });

    // Provider / model
    let { provider, modelName } = getProviderAndModel(selectedModel);
    log.info("Using model", { model: modelName, provider, effort: selectedEffort });
    let client = createProviderClient(provider as Parameters<typeof createProviderClient>[0], { reasoningTap: true, effort: selectedEffort, modelName });

    // ---- Step 1.5: Media capability routing ----
    // When the conversation carries video/audio attachments, make sure the
    // answering model ingests them natively; otherwise swap to the media
    // fallback (Gemini) BEFORE message processing so media parts are resolved
    // for the right target. Videos above the inline dataURL cap also route to
    // Gemini â€” OpenRouter-compatible models cannot fetch video URLs.
    const mediaReqs = getMediaRequirements(messages);
    if (mediaReqs.video > 0 || mediaReqs.audio > 0) {
      const oversizedVideo =
        mediaReqs.video > 0 ? await hasOversizedVideo(messages, userId) : false;
      const needsSwap =
        (mediaReqs.video > 0 && !supportsMedia(modelName, "video")) ||
        (mediaReqs.audio > 0 && !supportsMedia(modelName, "audio")) ||
        (oversizedVideo && !modelName.toLowerCase().startsWith("gemini"));
      if (needsSwap) {
        const mediaModel = getMediaFallbackModel();
        try {
          const { provider: mProvider, modelName: mName } = getProviderAndModel(mediaModel);
            client = createProviderClient(mProvider as Parameters<typeof createProviderClient>[0], { reasoningTap: true });
            modelName = mName;
          log.info("Media fallback model activated", { model: mName, provider: mProvider });
        } catch (err) {
          log.warn("Media fallback unavailable â€” transcripts will be used", {
            requested: mediaModel,
            error: (err as Error).message,
          });
        }
      }
      res.setHeader("X-Media-Mode", "true");
    }

    // ---- Step 2+3: Process & moderate ----
    const processed = await withTimeout(
      processAndModerate(messages, modelName, metrics, userId),
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
    const { coreMessages, hasImages } = processed;

    // ---- Step 4: User courses + study progress ----
    const userCoursesContext = await withTimeout(
      fetchCombinedUserContext(userId),
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

    // ---- Build structured RAG sources for the frontend ----
    if (ragResult.rankedDocs.length > 0) {
      const seen = new Set<string>();
      const structuredSources: Array<{
        source: string;
        page: number | undefined;
        textbookId: string | undefined;
        similarity: number;
      }> = [];

      for (const doc of ragResult.rankedDocs) {
        if (structuredSources.length >= 8) break;

        const rawSource =
          (typeof doc.metadata?.source === "string" ? doc.metadata.source :
           typeof doc.metadata?.source_url === "string" ? doc.metadata.source_url :
           typeof doc.metadata?.file_name === "string" ? doc.metadata.file_name : undefined);

        const source = cleanSourceName(rawSource);
        const page = typeof doc.metadata?.page_number === "number" ? doc.metadata.page_number : undefined;
        const textbookId = typeof doc.metadata?.textbook_id === "string" ? doc.metadata.textbook_id : undefined;

        const key = `${source}|${page ?? ""}|${textbookId ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        structuredSources.push({ source, page, textbookId, similarity: doc.similarity });
      }

      const headerJson = JSON.stringify(structuredSources);
      if (Buffer.byteLength(headerJson, "utf8") <= 6144) {
        res.setHeader("X-RAG-Sources", headerJson);
      }
    }

    // ---- Step 5b: Textbook QA model override ----
    // When textbook chunks are present, use a stronger model for better answers.
    if (ragResult.hasTextbookChunks) {
      const textbookModel = getTextbookQAModel();
      if (textbookModel && textbookModel !== modelName) {
        try {
          const { provider: tbProvider, modelName: tbModelName } = getProviderAndModel(textbookModel);
          client = createProviderClient(tbProvider as Parameters<typeof createProviderClient>[0], { reasoningTap: true });
          modelName = tbModelName;
          res.setHeader("X-Study-Mode", "true");
          log.info("Textbook QA model activated", { model: tbModelName, provider: tbProvider });
        } catch {
          log.warn("Textbook QA model unavailable, using default", { model: textbookModel });
        }
      }
    }

    // ---- Step 5c: Vision model routing ----
    // When the latest user message contains images, ensure the answering
    // model accepts them natively; otherwise switch to VISION_MODEL so the
    // image reaches the LLM instead of being degraded to a text description.
    if (hasImages) {
      if (!isVisionCapableModel(modelName)) {
        const visionModel = getVisionModel();
        if (visionModel && visionModel !== modelName) {
          try {
            const { provider: vProvider, modelName: vName } = getProviderAndModel(visionModel);
            client = createProviderClient(vProvider as Parameters<typeof createProviderClient>[0], { reasoningTap: true });
            modelName = vName;
            log.info("Vision model activated", { model: vName, provider: vProvider });
          } catch {
            log.warn("Vision model unavailable, keeping selected model", { model: visionModel });
          }
        }
      }
      res.setHeader("X-Vision-Mode", "true");
    }

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

    // ---- Step 6b: System prompt (with A/B + metrics) ----
    steps.begin("system_prompt" as never, "system_prompt" as never);
    const { systemPrompt: augmentedSystemPrompt, basePersona, promptVariant, promptLength, promptTokensEstimate, buildTimeMs } = assembleSystemPrompt({
      ragContext: ragResult.ragContext,
      userCoursesContext: userCoursesContext + threadFileContext,
      memoryPrompt,
      userId,
      selectedModel,
    });
    metrics.promptVariant = promptVariant;
    metrics.promptLength = promptLength;
    metrics.promptTokensEstimate = promptTokensEstimate;
    metrics.promptBuildTimeMs = buildTimeMs;
    steps.complete("system_prompt" as never, {
      label: `Prompt: ${promptVariant} (${promptTokensEstimate} tok)`,
      detail: `${promptLength} chars in ${buildTimeMs}ms`,
    } as never);

    // ---- Step 6c: Image grounding instruction ----
    // When the student photographs a problem AND has textbook material
    // indexed, instruct the model to prefer book-grounded solving.
    const systemPromptForGeneration =
      hasImages && ragResult.hasTextbookChunks
        ? augmentedSystemPrompt +
          `\n\n## Image Question Grounding\nThe user's latest message includes a photo (e.g. a photographed exercise or page). ` +
          `If the photo shows a question covered by the retrieved textbook excerpts, solve it using those excerpts and cite the page number(s). ` +
          `If it is not covered by the book, still solve it step by step in the user's language.`
        : augmentedSystemPrompt;

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
      const handled = await handleChatFileFlow({ userId, threadId: activeThreadId, messages: messages as Array<{ role: string; content?: string | Array<Record<string, unknown>>; parts?: Array<Record<string, unknown>> }>, res });
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

    // ---- Step 8: Persist user message (with attachment metadata) ----
    const lastUserRawParts = (() => {
      const lastUser = [...(messages as Array<{ role?: string; parts?: unknown }>)]
        .reverse()
        .find((m) => m?.role === "user");
      return lastUser?.parts;
    })();
    await withTimeout(
      persistLastUserMessage({ activeThreadId, userId, coreMessages, rawParts: lastUserRawParts }),
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
        threadId: activeThreadId ?? threadId,
        selectedModel,
      }),
      {
        timeoutMs: TIMEOUTS.PIPELINE_STEP,
        operationName: 'context_window',
        errorMessage: 'Context window management timed out',
      }
    );

    // ---- Step 10: UI fast-passes ----
    const fastPass = await withTimeout(
      runUIFastPasses({ res, coreMessages, userId, threadId: activeThreadId }),
      {
        timeoutMs: TIMEOUTS.PIPELINE_STEP,
        operationName: 'ui_fastpass',
        errorMessage: 'UI fast-pass timed out',
      }
    );
    if (fastPass.terminal) return;
    metrics.uiActionInjected = fastPass.injected;

    // ---- Step 10: Stream final response ----
    const enabledTools = buildEnabledTools(userId, intentResult.intent, ragResult.hasTextbookChunks, {
      res,
      activeThreadId,
    }, webSearchEnabled);
    
    // Include model fallback information in the response
    const responseMetadata = validation.modelFallback 
      ? { modelFallback: validation.modelFallback }
      : {};
    
    await generateAndStreamResponse({
      client,
      modelName,
      effort: selectedEffort,
      finalMessages,
      finalSystemPrompt: systemPromptForGeneration,
      basePersona,
      enabledTools,
      activeThreadId,
      userId,
      coreMessages,
      conversationSummary,
      augmentedSystemPrompt: systemPromptForGeneration,
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
