// Message processing (Step 2) and input moderation (Step 3) of the chat pipeline.

import { processMessages, type ProcessedMessages } from "../message-processor.service.js";
import { moderateInput, type CoreMessage } from "../moderation.service.js";
import { log } from "../../../routes/chat/chat-shared.js";
import type { RequestMetrics } from "./types.js";

export interface InputProcessingResult {
  coreMessages: CoreMessage[];
  hasImages: boolean;
  /** Video/audio attachments resolved for the answering model. */
  mediaCount: number;
  blocked: boolean;
  blockError?: string;
}

export async function processAndModerate(
  messages: Array<Record<string, unknown>>,
  selectedModel: string,
  metrics: RequestMetrics,
  userId?: string,
): Promise<InputProcessingResult> {
  // Step 2: process the raw messages into coreMessages.
  const processed: ProcessedMessages = await processMessages(messages, selectedModel, userId);
  let coreMessages: CoreMessage[] = processed.coreMessages as CoreMessage[];

  if (processed.imageAnalysisFailed) {
    metrics.imageAnalysisFailed = true;
    metrics.imageAnalysisError = processed.imageAnalysisError;
  }

  // Step 3: moderate the input messages.
  const modResult = await moderateInput(coreMessages);
  if (modResult.blocked) {
    return {
      coreMessages,
      hasImages: processed.hasImages,
      mediaCount: processed.mediaCount,
      blocked: true,
      blockError: modResult.error,
    };
  }
  coreMessages = modResult.messages;

  log.debug("Core messages mapped", { count: coreMessages.length });

  return {
    coreMessages,
    hasImages: processed.hasImages,
    mediaCount: processed.mediaCount,
    blocked: false,
  };
}
