/**
 * Step 9 — Context window management
 *
 * When token usage crosses 70% of the model window, summarises the
 * middle of the conversation history.  Falls back to simple trimming
 * if the summarizer is disabled or fails.
 */

import { memLog } from "../../../routes/chat/chat-shared.js";
import { summarizer } from "../../memory/summarizer.service.js";
import { streamingSummarizer, shouldTriggerStreamingSummary } from "../../memory/streaming-summarizer.js";
import { contextCache } from "../../memory/context-cache.service.js";
import { MemoryConfig } from "../../../config/memory.config.js";
import {
  estimateTokens,
  getContextWindowStatus,
  calculateTrimPlan,
} from "../../memory/token-estimator.js";
import type { CoreMessage } from "./types.js";

export interface SummarizationResult {
  finalMessages: CoreMessage[];
  conversationSummary: string;
}

import { extractText } from '../../../utils/message-utils/extract-text.js';

function detectLanguage(messages: CoreMessage[]): "ar" | "en" {
  const sample = messages
    .slice(-3)
    .map((m) => extractText(m.content))
    .join(" ");
  const arabicChars = (sample.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = sample.replace(/\s/g, "").length || 1;
  return arabicChars / totalChars > 0.3 ? "ar" : "en";
}

export async function manageContextWindow(args: {
  coreMessages: CoreMessage[];
  userId: string;
  threadId?: string;
  selectedModel?: string;
}): Promise<SummarizationResult> {
  const { coreMessages, userId, threadId, selectedModel = 'gpt-4o-mini' } = args;
  const ctxStatus = getContextWindowStatus(coreMessages, selectedModel);
  memLog.info("Context window status", {
    messages: coreMessages.length,
    tokens: ctxStatus.totalTokens,
    max: ctxStatus.maxTokens,
    usage: `${ctxStatus.usagePercent}%`,
    urgency: ctxStatus.urgency,
    recommendation: ctxStatus.recommendation,
    modelId: ctxStatus.modelId,
    modelName: ctxStatus.modelName,
  });

  // No summarisation needed
  if (!ctxStatus.shouldSummarize || ctxStatus.totalTokens <= ctxStatus.maxTokens * 0.7) {
    // Check if we should update streaming summary
    const { shouldTrigger, state } = await shouldTriggerStreamingSummary(userId, coreMessages.length, threadId);
    if (shouldTrigger) {
      try {
        const streamingResult = await streamingSummarizer.updateStreamingSummary(
          userId,
          coreMessages.map((m, idx) => ({ role: m.role, content: extractText(m.content), id: `msg_${idx}_${Date.now()}` })),
          threadId,
          { language: detectLanguage(coreMessages) as 'ar' | 'en' }
        );
        memLog.info("Streaming summary updated", {
          userId,
          newMessagesProcessed: streamingResult.newMessagesProcessed,
          summaryTokens: streamingResult.tokensEstimate,
        });
        return { finalMessages: coreMessages, conversationSummary: streamingResult.summary };
      } catch (err) {
        memLog.warn("Streaming summary update failed", { error: (err as Error)?.message });
      }
    }
    return { finalMessages: coreMessages, conversationSummary: "" };
  }

  const trimPlan = calculateTrimPlan(coreMessages, selectedModel);
  memLog.info("Trim plan calculated", {
    keepFirst: trimPlan.keepFirst,
    keepLast: trimPlan.keepLast,
    summarizeMiddle: trimPlan.summarizeMiddle,
    estimatedTokensAfter: trimPlan.estimatedTokensAfter,
  });

  if (trimPlan.summarizeMiddle === 0) {
    return { finalMessages: coreMessages, conversationSummary: "" };
  }

  // Try streaming summarization first (for incremental updates)
  try {
    const streamingResult = await streamingSummarizer.updateStreamingSummary(
      userId,
      coreMessages.map((m, idx) => ({ role: m.role, content: extractText(m.content), id: `msg_${idx}_${Date.now()}` })),
      threadId,
      { 
        language: detectLanguage(coreMessages) as 'ar' | 'en',
        windowSize: 15,
        overlap: 3,
      }
    );
    
    // If streaming summary is fresh and comprehensive, use it
    if (streamingResult.isIncremental && streamingResult.summary.length > 100) {
      const firstMessages = coreMessages.slice(0, trimPlan.keepFirst);
      const lastMessages = coreMessages.slice(-trimPlan.keepLast);
      
      const summaryLabel =
        detectLanguage(coreMessages) === "ar"
          ? `**ملخص المحادثة السابقة (محدث تدريجياً):**\n${streamingResult.summary}\n\n[تم تلخيص ${coreMessages.length - trimPlan.keepFirst - trimPlan.keepLast} رسالة لتوفير المساحة]`
          : `**Previous conversation summary (incrementally updated):**\n${streamingResult.summary}\n\n[${coreMessages.length - trimPlan.keepFirst - trimPlan.keepLast} messages summarized to save space]`;

      const finalMessages: CoreMessage[] = [
        ...firstMessages,
        { role: "system", content: summaryLabel },
        ...lastMessages,
      ];

      memLog.info("Used streaming summary for context window", {
        before: coreMessages.length,
        after: finalMessages.length,
        summaryTokens: streamingResult.tokensEstimate,
      });

      return { finalMessages, conversationSummary: streamingResult.summary };
    }
  } catch (streamErr) {
    memLog.warn("Streaming summarization failed, falling back to batch", { error: (streamErr as Error)?.message });
  }

  // Fallback: Batch summarization
  if (MemoryConfig.summarization.enabled) {
    try {
      const firstMessages = coreMessages.slice(0, trimPlan.keepFirst);
      const lastMessages = coreMessages.slice(-trimPlan.keepLast);
      const middleMessages = coreMessages.slice(
        trimPlan.keepFirst,
        coreMessages.length - trimPlan.keepLast,
      );

      if (middleMessages.length === 0) {
        return { finalMessages: coreMessages, conversationSummary: "" };
      }

      const detectedLang = detectLanguage(middleMessages);
      memLog.info("Summarizing middle messages (token-based)", {
        count: middleMessages.length,
        tokensBefore: middleMessages.reduce(
          (sum, m) => sum + estimateTokens(extractText(m.content)),
          0,
        ),
        detectedLang,
      });

      const summaryResult = await summarizer.summarizeMessages(
        middleMessages.map((m) => ({ role: m.role, content: extractText(m.content) })),
        userId,
        { language: detectedLang, style: "detailed", includeContext: true },
      );

      const summaryLabel =
        detectedLang === "ar"
          ? `**ملخص المحادثة السابقة:**\n${summaryResult.summary}\n\n[تم تلخيص ${middleMessages.length} رسالة لتوفير المساحة]`
          : `**Previous conversation summary:**\n${summaryResult.summary}\n\n[${middleMessages.length} messages summarized to save space]`;

      const finalMessages: CoreMessage[] = [
        ...firstMessages,
        { role: "system", content: summaryLabel },
        ...lastMessages,
      ];

      memLog.info("Summarized messages (token-based)", {
        before: coreMessages.length,
        after: finalMessages.length,
        tokensSaved: summaryResult.tokensEstimate,
      });

      if (userId && summaryResult.cacheHash) {
        await contextCache.set(userId, summaryResult.summary, {
          type: "conversation_summary",
          originalCount: middleMessages.length,
          timestamp: Date.now(),
        });
      }

      // Also update streaming state with this summary
      try {
        await streamingSummarizer.generateInitialStreamingSummary(
          userId,
          coreMessages.map((m, idx) => ({ 
            role: m.role, 
            content: extractText(m.content), 
            id: `msg_${idx}_${Date.now()}` 
          })),
          threadId,
          { language: detectedLang as 'ar' | 'en' }
        );
      } catch {}

      return { finalMessages, conversationSummary: summaryResult.summary };
    } catch (err) {
      memLog.error("Summarizer error, falling back to simple trimming", {
        error: (err as Error)?.message,
      });
      // Fall through to simple trim
    }
  }

  // Simple trim fallback
  const finalMessages: CoreMessage[] = [
    ...coreMessages.slice(0, MemoryConfig.contextWindow.keepFirstMessages),
    { role: "assistant", content: "[تم إخفاء بعض الرسائل القديمة لتوفير المساحة]" },
    ...coreMessages.slice(-MemoryConfig.contextWindow.keepLastMessages),
  ];
  memLog.info("Trimmed messages (summarization disabled)", {
    before: coreMessages.length,
    after: finalMessages.length,
  });
  return { finalMessages, conversationSummary: "" };
}
