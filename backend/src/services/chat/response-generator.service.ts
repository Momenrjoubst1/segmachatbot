/**
 * Response Generator Service
 *
 * Extracted from chat.routes.ts - streaming and response generation:
 * - Single model streaming
 * - Multi-agent mode (main agent + critic)
 * - Retry logic with exponential backoff
 * - Error chunk writing
 */

import { Response } from "express";
import { stepCountIs, streamText, generateText } from "ai";
import { triggerChatTitlingAsync } from "../chat-title-generator.service.js";
import { tryExtractAndStore } from "../memory/memory-context-builder.js";
import { MemoryConfig } from "../../config/memory.config.js";
import { getModelMaxOutputTokens } from "../memory/model-context.js";
import { contextCache } from "../memory/context-cache.service.js";
import { enhancedMemory } from "../memory/enhanced-memory.service.js";
import {
  log,
  createProviderClient,
  createSecondModelClient,
  MAIN_AGENT_SYSTEM_PROMPT,
  modelRouter,
  getGracefulDegradationMessage,
  getProviderAndModel,
  mapGoogleThinking,
  stripThinkTags,
} from "../../routes/chat/chat-shared.js";
import { moderateOutput } from "./moderation.service.js";
import { responseCache, CacheMetadata } from "./response-cache.service.js";
import { checkGrounding } from "./grounding-check.js";
import { buildCriticSystemPrompt } from "../../prompts/multi-agent.js";
import type { ToolDefinition } from "../../tools/shared/types.js";
import type { CoreMessage } from "./moderation.service.js";

// Re-export CoreMessage type from moderation for convenience
export type { CoreMessage };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamOptions {
  client: ReturnType<typeof createProviderClient>;
  modelName: string;
  /** Reasoning effort for this request (OpenAI-style), when requested. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  finalMessages: CoreMessage[];
  finalSystemPrompt: string;
  basePersona: string;
  enabledTools: Record<string, ToolDefinition>;
  activeThreadId: string | undefined;
  userId: string | undefined;
  coreMessages: CoreMessage[];
  conversationSummary: string;
  augmentedSystemPrompt: string;
  reqMetrics: Record<string, string | number | boolean | string[] | undefined>;
  res: Response;
  cacheMetadata?: CacheMetadata;
  retrievedDocsForGrounding?: Array<{ content: string; metadata?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate and stream the AI response to the client.
 * Handles single-model and multi-agent modes, retry logic, and error recovery.
 */
export async function generateAndStreamResponse(
  options: StreamOptions,
): Promise<void> {
    const {
      client,
      modelName,
      effort,
      finalMessages,
    finalSystemPrompt: _finalSystemPrompt,
    basePersona,
    enabledTools,
    activeThreadId,
    userId,
    coreMessages,
    conversationSummary,
    augmentedSystemPrompt,
    reqMetrics,
    res,
    cacheMetadata,
  } = options;

  // ── Abort when the client disconnects OR after a hard timeout ──────────
  // Without this the LLM call (and the entire async onFinish pipeline)
  // continues running even after the user clicks "Stop generating" -
  // wasting provider tokens and server CPU.
  const clientAbort = new AbortController();
  const timeoutAbort = AbortSignal.timeout(120_000);
  const combinedSignal = AbortSignal.any([clientAbort.signal, timeoutAbort]);
  let clientDisconnected = false;
  /** Set once onFinish ran — its path owns persistence for completed replies. */
  let streamCompleted = false;
  /**
   * Visible text streamed so far. When the client cuts the connection
   * mid-reply (Stop button, voice barge-in, tab close), this partial IS
   * everything that was said — persisting it keeps the next turn's context
   * truthful instead of amnesiac (the aborted stream never reaches onFinish).
   */
  let partialVisibleText = "";

  /**
   * Persist the truncated reply. Claude-style truncate semantics: the model
   * said exactly these words before the cut, so they belong in history —
   * nothing more, nothing less. Skips titling/memory/semantic-cache on
   * purpose: a truncated answer must never poison the response cache.
   */
  const persistInterruptedPartial = async (): Promise<void> => {
    if (streamCompleted) return;
    const partial = stripThinkTags(partialVisibleText).trim();
    if (!activeThreadId || partial.length < 2) return;
    try {
      let safePartial = partial;
      try {
        safePartial = await moderateOutput(partial, userId || "", activeThreadId);
      } catch (modErr) {
        log.warn("Interrupted-partial moderation failed — saving unmoderated", {
          error: (modErr as Error)?.message,
        });
      }
      const { supabase } = await import("../rag/rag-supabase-client.js");
      const { error: astErr } = await supabase
        .from("chat_messages")
        .insert([
          {
            session_id: activeThreadId,
            role: "assistant",
            content: safePartial,
            model: currentModelName,
          },
        ]);
      if (astErr) {
        log.error("Error saving interrupted assistant message", { error: astErr.message });
      } else {
        log.info("Persisted interrupted partial reply", {
          session_id: activeThreadId,
          chars: safePartial.length,
        });
      }
    } catch (err) {
      log.error("persistInterruptedPartial failed", { error: (err as Error)?.message });
    }
  };

  res.on("close", () => {
    if (streamCompleted) return; // normal end-of-stream teardown
    clientDisconnected = true;
    clientAbort.abort();
    void persistInterruptedPartial();
  });

  const MULTI_AGENT_ENABLED = process.env.MULTI_AGENT_ENABLED === "true";

  // ---- Model Fallback state (declared early for use in streamOptions) ----
  let currentModelName = modelName;
  let currentClient = client;
  // isFallback state is tracked for logging only

  // Build the system prompt — self-reflection for single model, or multi-agent protocol
  const resolvedSystemPrompt = MULTI_AGENT_ENABLED
    ? `${augmentedSystemPrompt}\n\n=========================================\n🤖 MULTI-AGENT PROTOCOL: MAIN AGENT DRAFTING\n=========================================\n${MAIN_AGENT_SYSTEM_PROMPT}`
    : `${augmentedSystemPrompt}\n\n**QUALITY GUIDELINES:**\n- Double-check facts and citations before responding\n- Use clear, well-structured Markdown\n- Ensure accuracy and completeness\n- Keep responses concise but thorough`;

  // Track the model used for the current attempt so onFinish logs the correct name
  let attemptModelName = currentModelName;

  const streamOptions: Parameters<typeof streamText>[0] = {
    model: currentClient.chat(currentModelName),
    messages: finalMessages as any[],
    system: resolvedSystemPrompt,
    maxOutputTokens: getModelMaxOutputTokens(currentModelName),
    abortSignal: combinedSignal,
    // Surface model reasoning ("thoughts") to the client when the provider
    // supports it (e.g. Gemini thinking). Other providers ignore this key.
    // When an effort was requested, map it onto Gemini's thinking controls —
    // OpenAI-compatible providers get their effort via the fetch wrapper in
    // createProviderClient instead.
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          ...(effort ? mapGoogleThinking(currentModelName, effort) : {}),
        },
      },
    },
    // Accumulate visible text for interrupted-partial persistence. Only
    // text deltas count — reasoning deltas are invisible to the user.
    onChunk: ({ chunk }) => {
      const c = chunk as { type?: string; text?: unknown };
      if ((c.type === "text-delta" || c.type === "text") && typeof c.text === "string") {
        partialVisibleText += c.text;
      }
    },
    onFinish: async ({
      text,
      usage,
      finishReason,
    }: {
      text?: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      finishReason?: string;
    }) => {
      streamCompleted = true;
      reqMetrics.totalTimeMs = Date.now() - (reqMetrics.startTime as number);

      // Reasoning tap: <think>…</think> blocks are UI-only — strip them before
      // grounding checks, moderation, persistence, and caching.
      const visibleText = text ? stripThinkTags(text) : text;

      log.info("chat_metrics", {
        event: "chat_metrics",
        timestamp: new Date().toISOString(),
        metrics: reqMetrics,
        usage: usage || {},
        finishReason: finishReason,
        session_id: activeThreadId,
        mode: MULTI_AGENT_ENABLED ? "multi-agent" : "single-model",
        model: attemptModelName,
      });

      if (activeThreadId && visibleText) {
        // ---- Grounding Check (verify response is backed by RAG sources) ----
        if (options.retrievedDocsForGrounding && options.retrievedDocsForGrounding.length > 0) {
          try {
            const groundingResult = checkGrounding(visibleText, options.retrievedDocsForGrounding);
            log.info("Grounding check result", {
              isGrounded: groundingResult.isGrounded,
              percentage: `${groundingResult.groundedPercentage}%`,
              ungroundedClaims: groundingResult.ungroundedClaims.length,
            });
          } catch (groundingErr) {
            log.warn("Grounding check failed", {
              error: (groundingErr as Error)?.message,
            });
          }
        }

        // Report success to model router (resets circuit breaker)
        modelRouter.reportSuccess(attemptModelName);
        // Output safety filter
        const safeResponseText = await moderateOutput(
          visibleText,
          userId || "",
          activeThreadId,
        );

        // Save assistant response
        const { supabase } = await import("../rag/rag-supabase-client.js");
        const { error: astErr } = await supabase
          .from("chat_messages")
          .insert([
            {
              session_id: activeThreadId,
              role: "assistant",
              content: safeResponseText,
              model: currentModelName,
            },
          ]);
        if (astErr)
          log.error("Error saving assistant message", {
            error: astErr.message,
          });

        // Trigger automatic chat titling after saving response
        triggerChatTitlingAsync(activeThreadId);

        // Advanced Memory Extraction (Background)
        // NOTE: fire-and-forget â€" must attach .catch() so that any failure inside
        // tryExtractAndStore (e.g. DB timeout) is logged and never surfaces as an
        // UnhandledPromiseRejection that would crash the Node.js process.
        if (userId) {
          tryExtractAndStore(userId, coreMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })), activeThreadId).catch((err) => {
            log.error("Background memory extraction failed", {
              error: (err as Error)?.message,
              userId,
              threadId: activeThreadId,
            });
          });

          if (MemoryConfig.memoryBank.enabled) {
            try {
              const messagesWithResponse = [
                ...finalMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
                { role: "assistant", content: visibleText },
              ];
              const extracted = await enhancedMemory.extractMemories(
                userId,
                messagesWithResponse as { role: string; content: string }[],
                activeThreadId,
              );
              if (extracted.length > 0) {
                log.info("Extracted new memories", {
                  count: extracted.length,
                });
              }
            } catch (memError) {
              log.error("Error extracting memories (enhanced)", {
                error: (memError as Error)?.message,
              });
            }
          }

          if (conversationSummary && MemoryConfig.caching.enabled) {
            try {
              await contextCache.set(userId, conversationSummary, {
                type: "conversation_summary",
                sessionId: activeThreadId,
                timestamp: Date.now(),
              });
              log.info("Conversation summary cached");
            } catch (cacheError) {
              log.error("Error caching summary", {
                error: (cacheError as Error)?.message,
              });
            }
          }
        }

        // ---- Semantic Response Cache: Store new response ----
        // Cache the response for future similar questions
        // Skip if cache was bypassed or if tools were used (dynamic responses)
        if (cacheMetadata && !cacheMetadata.bypassed && visibleText) {
          try {
            await responseCache.cacheResponse(
              cacheMetadata.queryText,
              cacheMetadata.queryEmbedding,
              visibleText,
              {
                model: cacheMetadata.model,
                ragSources: cacheMetadata.ragSources,
              },
              cacheMetadata.userId,
            );
          } catch (cacheErr) {
            log.warn("Failed to cache response", {
              error: (cacheErr as Error)?.message,
            });
          }
        }
        // ---- End Semantic Response Cache ----
      }
    },
  };

  if (Object.keys(enabledTools).length > 0) {
    streamOptions.tools = enabledTools;
    streamOptions.stopWhen = stepCountIs(15);
    log.info("Tools enabled", { tools: Object.keys(enabledTools) });
  }

  // ---- Streaming with Model Fallback & Error Recovery ----
  let streamAttempts = 0;
  const MAX_STREAM_ATTEMPTS = 3;

  while (streamAttempts < MAX_STREAM_ATTEMPTS) {
    streamAttempts++;
    // Capture model name for this attempt so onFinish logs correctly after fallback
    attemptModelName = currentModelName;
    try {
      log.info(
        `Streaming response (attempt ${streamAttempts}/${MAX_STREAM_ATTEMPTS})`,
        {
          mode: MULTI_AGENT_ENABLED ? "multi-agent" : "single-model",
        },
      );

      if (MULTI_AGENT_ENABLED) {
        const mainAgentResult = await generateText({
          model: currentClient.chat(currentModelName),
    messages: finalMessages as any[],
          system: resolvedSystemPrompt,
          maxOutputTokens: getModelMaxOutputTokens(currentModelName),
          abortSignal: combinedSignal,
          ...(Object.keys(enabledTools).length > 0
            ? { tools: enabledTools, stopWhen: stepCountIs(15) }
            : {}),
        });

        const mainAgentDraft = mainAgentResult.text || "";
        reqMetrics.mainAgentUsage = mainAgentResult.usage as unknown as string;

        // Stream through critic agent for final polish
        const secondModelClient = createSecondModelClient();
        const secondModelName =
          process.env.SECOND_MODEL_NAME || "gpt-4o-mini";
        let criticModel = secondModelClient
          ? secondModelClient.chat(secondModelName)
          : currentClient.chat(currentModelName);

        // FIX: Use buildCriticSystemPrompt for proper system-level review
        const criticSystemPrompt = buildCriticSystemPrompt(basePersona);

        const result = streamText({
          model: criticModel,
          messages: [
            ...finalMessages as any[],
            {
              // FIX: Use system role for draft review instead of user role
              role: "system" as const,
              content: `[Main Agent Draft - Review and polish before outputting to user]\n\n${mainAgentDraft}`,
            },
          ],
          system: criticSystemPrompt,
          maxOutputTokens: getModelMaxOutputTokens(secondModelName),
          abortSignal: combinedSignal,
          onFinish: streamOptions.onFinish,
          onChunk: streamOptions.onChunk,
          providerOptions: streamOptions.providerOptions,
        });

        // Use pipeUIMessageStreamToResponse for Express response streaming in AI SDK v6
        result.pipeUIMessageStreamToResponse(res);
      } else {
        // Single-model mode: stream directly (fastest path)
        const result = streamText(streamOptions);

        // Use pipeUIMessageStreamToResponse for Express response streaming in AI SDK v6
        result.pipeUIMessageStreamToResponse(res);
      }

      // Stream started successfully, break out of retry loop
      break;
    } catch (streamError) {
      log.error(`Streaming attempt ${streamAttempts} failed (model: ${currentModelName})`, {
        error: (streamError as Error)?.message,
        stack: (streamError as Error)?.stack,
      });

      // Report failure to model router (triggers circuit breaker after threshold)
      modelRouter.reportFailure(currentModelName);

      if (streamAttempts < MAX_STREAM_ATTEMPTS) {
        // Try fallback model before giving up
        const fallbackChain = modelRouter.getFallbackChain(modelName);
        const nextModel = fallbackChain[streamAttempts]; // index 1+ for fallbacks

        if (nextModel && nextModel !== currentModelName) {
          const { provider: fallbackProvider, modelName: fallbackModelName } =
            getProviderAndModel(nextModel);
          currentClient = createProviderClient(fallbackProvider, { reasoningTap: true });
          currentModelName = fallbackModelName;
          // isFallback = true (tracked for logging only)

          log.info(`Falling back to model: ${nextModel}`, {
            previousModel: modelName,
            fallbackModel: nextModel,
          });

          // Update stream options for the new model
          streamOptions.model = currentClient.chat(currentModelName);

          // Graceful degradation notice for user - surfaced via the same
          // X-Model-Fallback header the pipeline uses for validation-time
          // fallbacks, so the frontend can render it before the stream starts.
          if (!res.headersSent) {
            const degradationMsg = getGracefulDegradationMessage(modelName, nextModel);
            log.info("Graceful degradation", { message: degradationMsg });
            res.setHeader(
              "X-Model-Fallback",
              JSON.stringify({ from: modelName, to: nextModel }),
            );
          }
        } else {
          // No more fallbacks â€" wait before retry
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * streamAttempts),
          );
          log.info(`Retrying stream in ${500 * streamAttempts}ms...`);
        }
      } else {
        log.error(
          "All streaming attempts exhausted. Sending error response.",
        );

        if (!res.headersSent) {
          res.status(500).json({
            error:
              "عذراً، حدث خطأ أثناء توليد الرد. يرجى المحاولة مرة أخرى.",
          });
        } else {
          try {
            const errorChunk = `3:${JSON.stringify({
              error: "Streaming failed after multiple attempts. Please try again.",
              code: "STREAM_FAILED",
            })}\n`;
            res.write(errorChunk);
            res.end();
          } catch (writeErr) {
            log.error("Failed to write error chunk to response", {
              error: writeErr,
            });
          }
        }
      }
    }
  }
}
