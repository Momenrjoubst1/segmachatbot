/**
 * Response Generator Service
 *
 * Extracted from chat.routes.ts — streaming and response generation:
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
} from "../../routes/chat/chat-shared.js";
import { moderateOutput } from "./moderation.service.js";
import { responseCache, CacheMetadata } from "./response-cache.service.js";
import { checkGrounding } from "./grounding-check.js";
import { buildCriticSystemPrompt } from "../../prompts/multi-agent.js";
import type { ToolDefinition } from "../../tools/shared/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamOptions {
  client: ReturnType<typeof createProviderClient>;
  modelName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finalMessages: any[];
  finalSystemPrompt: string;
  basePersona: string;
  enabledTools: Record<string, ToolDefinition>;
  activeThreadId: string | undefined;
  userId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coreMessages: any[];
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

  const MULTI_AGENT_ENABLED = process.env.MULTI_AGENT_ENABLED === "true";

  // ---- Model Fallback state (declared early for use in streamOptions) ----
  let currentModelName = modelName;
  let currentClient = client;
  // isFallback state is tracked for logging only

  // Build the system prompt â€” self-reflection for single model, or multi-agent protocol
  const resolvedSystemPrompt = MULTI_AGENT_ENABLED
    ? `${augmentedSystemPrompt}\n\n=========================================\nðŸ¤– MULTI-AGENT PROTOCOL: MAIN AGENT DRAFTING\n=========================================\n${MAIN_AGENT_SYSTEM_PROMPT}`
    : `${augmentedSystemPrompt}\n\n**QUALITY GUIDELINES:**\n- Double-check facts and citations before responding\n- Use clear, well-structured Markdown\n- Ensure accuracy and completeness\n- Keep responses concise but thorough`;

  const streamOptions: Parameters<typeof streamText>[0] = {
    model: currentClient.chat(currentModelName),
    messages: finalMessages,
    system: resolvedSystemPrompt,
    maxOutputTokens: 4096,
    abortSignal: AbortSignal.timeout(120_000),
    onFinish: async ({
      text,
      usage,
      finishReason,
    }: {
      text?: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      finishReason?: string;
    }) => {
      reqMetrics.totalTimeMs = Date.now() - (reqMetrics.startTime as number);

      log.info("chat_metrics", {
        event: "chat_metrics",
        timestamp: new Date().toISOString(),
        metrics: reqMetrics,
        usage: usage || {},
        finishReason: finishReason,
        session_id: activeThreadId,
        mode: MULTI_AGENT_ENABLED ? "multi-agent" : "single-model",
      });

      if (activeThreadId && text) {
        // ---- Grounding Check (verify response is backed by RAG sources) ----
        if (options.retrievedDocsForGrounding && options.retrievedDocsForGrounding.length > 0) {
          try {
            const groundingResult = checkGrounding(text, options.retrievedDocsForGrounding);
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
        modelRouter.reportSuccess(currentModelName);
        // Output safety filter
        const safeResponseText = await moderateOutput(
          text,
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
            },
          ]);
        if (astErr)
          log.error("Error saving assistant message", {
            error: astErr.message,
          });

        // Trigger automatic chat titling after saving response
        triggerChatTitlingAsync(activeThreadId);

        // Advanced Memory Extraction (Background)
        // NOTE: fire-and-forget â€” must attach .catch() so that any failure inside
        // tryExtractAndStore (e.g. DB timeout) is logged and never surfaces as an
        // UnhandledPromiseRejection that would crash the Node.js process.
        if (userId) {
          tryExtractAndStore(userId, coreMessages, activeThreadId).catch((err) => {
            log.error("Background memory extraction failed", {
              error: (err as Error)?.message,
              userId,
              threadId: activeThreadId,
            });
          });

          if (MemoryConfig.memoryBank.enabled) {
            try {
              const messagesWithResponse = [
                ...finalMessages,
                { role: "assistant", content: text },
              ];
              const extracted = await enhancedMemory.extractMemories(
                userId,
                messagesWithResponse,
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
        if (cacheMetadata && !cacheMetadata.bypassed && text) {
          try {
            await responseCache.cacheResponse(
              cacheMetadata.queryText,
              cacheMetadata.queryEmbedding,
              text,
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
          messages: finalMessages,
          system: resolvedSystemPrompt,
          maxOutputTokens: 4096,
          abortSignal: AbortSignal.timeout(120_000),
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
            ...finalMessages,
            {
              // FIX: Use system role for draft review instead of user role
              role: "system" as const,
              content: `[Main Agent Draft â€” Review and polish before outputting to user]\n\n${mainAgentDraft}`,
            },
          ],
          system: criticSystemPrompt,
          maxOutputTokens: 4096,
          abortSignal: AbortSignal.timeout(120_000),
          onFinish: streamOptions.onFinish,
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
          currentClient = createProviderClient(fallbackProvider);
          currentModelName = fallbackModelName;
          // isFallback = true (tracked for logging only)

          log.info(`Falling back to model: ${nextModel}`, {
            previousModel: modelName,
            fallbackModel: nextModel,
          });

          // Update stream options for the new model
          streamOptions.model = currentClient.chat(currentModelName);

          // Graceful degradation notice for user — surfaced via the same
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
          // No more fallbacks â€” wait before retry
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
