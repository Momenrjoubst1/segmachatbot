// Response generator service: streams AI replies in single- and multi-agent modes.

import { Response } from "express";
import { stepCountIs, streamText, generateText } from "ai";
import {
  log,
  createProviderClient,
  createSecondModelClient,
  MAIN_AGENT_SYSTEM_PROMPT,
  modelRouter,
  getGracefulDegradationMessage,
  getProviderAndModel,
  mapGoogleThinking,
} from "../../routes/chat/chat-shared.js";
import { getModelMaxOutputTokens } from "../memory/model-context.js";
import { buildCriticSystemPrompt } from "../../prompts/multi-agent.js";
import { handleOnFinish, persistInterruptedPartial } from "./response-generator.handlers.js";
import type { StreamOptions } from "./response-generator.types.js";
import { stripThinkTags } from "../../routes/chat/chat-shared.js";

export type { StreamOptions } from "./response-generator.types.js";
export type { CoreMessage } from "./response-generator.types.js";

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

  const clientAbort = new AbortController();
  const timeoutAbort = AbortSignal.timeout(120_000);
  const combinedSignal = AbortSignal.any([clientAbort.signal, timeoutAbort]);
  let clientDisconnected = false;
  let streamCompleted = false;
  let partialVisibleText = "";

  res.on("close", () => {
    if (streamCompleted) return;
    clientDisconnected = true;
    clientAbort.abort();
    void persistInterruptedPartial(partialVisibleText, streamCompleted, currentModelName, activeThreadId, userId);
  });

  const MULTI_AGENT_ENABLED = process.env.MULTI_AGENT_ENABLED === "true";

  let currentModelName = modelName;
  let currentClient = client;

  const resolvedSystemPrompt = MULTI_AGENT_ENABLED
    ? `${augmentedSystemPrompt}\n\n=========================================\n🤖 MULTI-AGENT PROTOCOL: MAIN AGENT DRAFTING\n=========================================\n${MAIN_AGENT_SYSTEM_PROMPT}`
    : `${augmentedSystemPrompt}\n\n**QUALITY GUIDELINES:**\n- Double-check facts and citations before responding\n- Use clear, well-structured Markdown\n- Ensure accuracy and completeness\n- Keep responses concise but thorough`;

  let attemptModelName = currentModelName;

  const onFinishCtx = {
    activeThreadId,
    userId,
    coreMessages,
    finalMessages,
    conversationSummary,
    cacheMetadata,
    retrievedDocsForGrounding: options.retrievedDocsForGrounding,
    reqMetrics,
    MULTI_AGENT_ENABLED,
  };

  const streamOptions: Parameters<typeof streamText>[0] = {
    model: currentClient.chat(currentModelName),
    messages: finalMessages as any[],
    system: resolvedSystemPrompt,
    maxOutputTokens: getModelMaxOutputTokens(currentModelName),
    abortSignal: combinedSignal,
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          ...(effort ? mapGoogleThinking(currentModelName, effort) : {}),
        },
      },
    },
    onChunk: ({ chunk }) => {
      const c = chunk as { type?: string; text?: unknown };
      if ((c.type === "text-delta" || c.type === "text") && typeof c.text === "string") {
        partialVisibleText += c.text;
      }
    },
    onFinish: async ({ text, usage, finishReason }) => {
      streamCompleted = true;
      await handleOnFinish(text, usage, finishReason, onFinishCtx, currentModelName);
    },
  };

  if (Object.keys(enabledTools).length > 0) {
    streamOptions.tools = enabledTools;
    streamOptions.stopWhen = stepCountIs(15);
    log.info("Tools enabled", { tools: Object.keys(enabledTools) });
  }

  let streamAttempts = 0;
  const MAX_STREAM_ATTEMPTS = 3;

  while (streamAttempts < MAX_STREAM_ATTEMPTS) {
    streamAttempts++;
    attemptModelName = currentModelName;
    try {
      log.info(`Streaming response (attempt ${streamAttempts}/${MAX_STREAM_ATTEMPTS})`, {
        mode: MULTI_AGENT_ENABLED ? "multi-agent" : "single-model",
      });

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

        const secondModelClient = createSecondModelClient();
        const secondModelName = process.env.SECOND_MODEL_NAME || "gpt-4o-mini";
        let criticModel = secondModelClient
          ? secondModelClient.chat(secondModelName)
          : currentClient.chat(currentModelName);

        const criticSystemPrompt = buildCriticSystemPrompt(basePersona);

        const result = streamText({
          model: criticModel,
          messages: [
            ...finalMessages as any[],
            {
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

        result.pipeUIMessageStreamToResponse(res);
      } else {
        const result = streamText(streamOptions);
        result.pipeUIMessageStreamToResponse(res);
      }

      break;
    } catch (streamError) {
      log.error(`Streaming attempt ${streamAttempts} failed (model: ${currentModelName})`, {
        error: (streamError as Error)?.message,
        stack: (streamError as Error)?.stack,
      });

      modelRouter.reportFailure(currentModelName);

      if (streamAttempts < MAX_STREAM_ATTEMPTS) {
        const fallbackChain = modelRouter.getFallbackChain(modelName);
        const nextModel = fallbackChain[streamAttempts];

        if (nextModel && nextModel !== currentModelName) {
          const { provider: fallbackProvider, modelName: fallbackModelName } =
            getProviderAndModel(nextModel);
          currentClient = createProviderClient(fallbackProvider, { reasoningTap: true });
          currentModelName = fallbackModelName;

          log.info(`Falling back to model: ${nextModel}`, {
            previousModel: modelName,
            fallbackModel: nextModel,
          });

          streamOptions.model = currentClient.chat(currentModelName);

          if (!res.headersSent) {
            const degradationMsg = getGracefulDegradationMessage(modelName, nextModel);
            log.info("Graceful degradation", { message: degradationMsg });
            res.setHeader(
              "X-Model-Fallback",
              JSON.stringify({ from: modelName, to: nextModel }),
            );
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500 * streamAttempts));
          log.info(`Retrying stream in ${500 * streamAttempts}ms...`);
        }
      } else {
        log.error("All streaming attempts exhausted. Sending error response.");

        if (!res.headersSent) {
          res.status(500).json({
            error: "عذراً، حدث خطأ أثناء توليد الرد. يرجى المحاولة مرة أخرى.",
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
            log.error("Failed to write error chunk to response", { error: writeErr });
          }
        }
      }
    }
  }
}
