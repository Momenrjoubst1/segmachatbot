/**
 * Streaming Summarization Service
 * خدمة التلخيص التدفقي
 * 
 * Produces summaries incrementally as messages arrive, enabling
 * real-time context management without blocking the main pipeline.
 * Uses a sliding window approach with incremental updates.
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { MemoryConfig } from '../../config/memory.config.js';
import { createLogger } from '../../utils/logger.js';
import { estimateTokens } from './token-estimator.js';
import { contextCache } from './context-cache.service.js';

const log = createLogger('streaming-summarizer');

// ==========================================
// Types
// ==========================================

export interface Message {
  role: string;
  content: string;
  id?: string;
  timestamp?: number;
}

export interface StreamingSummaryState {
  userId: string;
  threadId?: string;
  lastSummary: string;
  lastSummaryTokens: number;
  messageCount: number;
  lastProcessedIndex: number;
  windowSize: number;
  overlap: number;
  updatedAt: number;
}

export interface StreamingSummaryResult {
  summary: string;
  tokensEstimate: number;
  isIncremental: boolean;
  newMessagesProcessed: number;
  totalMessages: number;
}

export interface StreamingConfig {
  /** Number of messages per summarization window */
  windowSize: number;
  /** Overlap between windows for continuity */
  overlap: number;
  /** Minimum new messages before triggering incremental update */
  minNewMessages: number;
  /** Maximum summary tokens */
  maxSummaryTokens: number;
  /** Language for summary */
  language: 'ar' | 'en';
  /** Style: brief or detailed */
  style: 'brief' | 'detailed';
}

// ==========================================
// Default Configuration
// ==========================================

const DEFAULT_CONFIG: StreamingConfig = {
  windowSize: 10,
  overlap: 2,
  minNewMessages: 3,
  maxSummaryTokens: 500,
  language: 'ar',
  style: 'brief',
};

// ==========================================
// State Management (In-Memory with Cache Persistence)
// ==========================================

const summaryStates = new Map<string, StreamingSummaryState>();

/**
 * Get state key for a user/thread combination
 */
function getStateKey(userId: string, threadId?: string): string {
  return `summary:${userId}:${threadId ?? 'global'}`;
}

/**
 * Load state from cache
 */
async function loadState(userId: string, threadId?: string): Promise<StreamingSummaryState | null> {
  const key = getStateKey(userId, threadId);
  
  // Try in-memory first
  if (summaryStates.has(key)) {
    return summaryStates.get(key)!;
  }

  // Try persistent cache
  try {
    const cacheResult = await contextCache.get(userId, key);
    if (cacheResult.found && cacheResult.content) {
      const state = JSON.parse(cacheResult.content) as StreamingSummaryState;
      summaryStates.set(key, state);
      return state;
    }
  } catch {
    // Ignore cache errors
  }

  return null;
}

/**
 * Save state to cache
 */
async function saveState(state: StreamingSummaryState): Promise<void> {
  const key = getStateKey(state.userId, state.threadId);
  summaryStates.set(key, state);
  
  try {
    await contextCache.set(state.userId, JSON.stringify(state), {
      type: 'streaming_summary_state',
      threadId: state.threadId,
      timestamp: Date.now(),
    });
  } catch {
    // Ignore cache errors
  }
}

/**
 * Clear state
 */
async function clearState(userId: string, threadId?: string): Promise<void> {
  const key = getStateKey(userId, threadId);
  summaryStates.delete(key);
  try {
    await contextCache.delete(userId, key);
  } catch {}
}

// ==========================================
// Core Streaming Summarization
// ==========================================

/**
 * Incrementally update summary with new messages
 * Returns updated summary if enough new messages accumulated
 */
export async function updateStreamingSummary(
  userId: string,
  allMessages: Message[],
  threadId?: string,
  config: Partial<StreamingConfig> = {}
): Promise<StreamingSummaryResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Load existing state
  let state = await loadState(userId, threadId);
  const now = Date.now();

  if (!state) {
    // Initialize new state
    state = {
      userId,
      threadId,
      lastSummary: '',
      lastSummaryTokens: 0,
      messageCount: 0,
      lastProcessedIndex: 0,
      windowSize: finalConfig.windowSize,
      overlap: finalConfig.overlap,
      updatedAt: now,
    };
  }

  // Check if we have new messages
  const newMessages = allMessages.slice(state.lastProcessedIndex);
  
  if (newMessages.length < finalConfig.minNewMessages && state.lastSummary) {
    // Not enough new messages, return existing summary
    return {
      summary: state.lastSummary,
      tokensEstimate: state.lastSummaryTokens,
      isIncremental: false,
      newMessagesProcessed: 0,
      totalMessages: allMessages.length,
    };
  }

  // Process new messages in windows
  const { summary, tokensEstimate } = await processIncrementalSummary(
    state,
    newMessages,
    finalConfig
  );

  // Update state
  state.lastSummary = summary;
  state.lastSummaryTokens = tokensEstimate;
  state.messageCount = allMessages.length;
  state.lastProcessedIndex = allMessages.length;
  state.updatedAt = now;

  await saveState(state);

  return {
    summary,
    tokensEstimate,
    isIncremental: true,
    newMessagesProcessed: newMessages.length,
    totalMessages: allMessages.length,
  };
}

/**
 * Process incremental summary using sliding window
 */
async function processIncrementalSummary(
  state: StreamingSummaryState,
  newMessages: Message[],
  config: StreamingConfig
): Promise<{ summary: string; tokensEstimate: number }> {
  // If we have an existing summary, we only need to summarize the new messages
  // and merge with the existing summary
  
  if (state.lastSummary && newMessages.length <= config.windowSize) {
    // Small incremental update: merge new messages into existing summary
    return await mergeSummaryWithNewMessages(
      state.lastSummary,
      newMessages,
      config
    );
  }

  // Larger update: use sliding window on all messages since last summary
  // Get messages from the last processed index minus overlap
  // (In practice, we'd need to store the full message history or fetch it)
  // For now, summarize all new messages and merge
  
  return await mergeSummaryWithNewMessages(
    state.lastSummary,
    newMessages,
    config
  );
}

/**
 * Merge existing summary with new messages
 */
async function mergeSummaryWithNewMessages(
  existingSummary: string,
  newMessages: Message[],
  config: StreamingConfig
): Promise<{ summary: string; tokensEstimate: number }> {
  if (newMessages.length === 0) {
    return {
      summary: existingSummary,
      tokensEstimate: estimateTokens(existingSummary),
    };
  }

  // Format new messages
  const newContent = newMessages
    .map(m => `${m.role === 'user' ? 'المستخدم' : 'المساعد'}: ${m.content}`)
    .join('\n\n');

  const prompt = config.language === 'ar'
    ? `لديك ملخص سابق للمحادثة ورسائل جديدة. حدث الملخص ليشمل المعلومات الجديدة مع الحفاظ على الإيجاز والترتيب الزمني.

**الملخص السابق:**
${existingSummary}

**الرسائل الجديدة:**
${newContent}

**الملخص المحدث:**`
    : `You have a previous conversation summary and new messages. Update the summary to include new information while maintaining brevity and chronological order.

**Previous Summary:**
${existingSummary}

**New Messages:**
${newContent}

**Updated Summary:`;

  try {
    const model = getSummaryModel();
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: config.maxSummaryTokens,
      temperature: 0.3,
    });

    const summary = text.trim();
    return {
      summary,
      tokensEstimate: estimateTokens(summary),
    };
  } catch (error) {
    log.error('[StreamingSummarizer] Error merging summary', { error });
    // Fallback: append new messages to existing summary
    return {
      summary: existingSummary + '\n\n[تحديث] ' + newMessages.slice(-2).map(m => m.content.substring(0, 100)).join('، '),
      tokensEstimate: estimateTokens(existingSummary) + 100,
    };
  }
}

/**
 * Generate initial summary from scratch (for first run or reset)
 */
export async function generateInitialStreamingSummary(
  userId: string,
  messages: Message[],
  threadId?: string,
  config: Partial<StreamingConfig> = {}
): Promise<StreamingSummaryResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (messages.length === 0) {
    return {
      summary: '',
      tokensEstimate: 0,
      isIncremental: false,
      newMessagesProcessed: 0,
      totalMessages: 0,
    };
  }

  // Use sliding window for initial summarization
  const summary = await generateSlidingWindowSummary(messages, finalConfig);
  const tokensEstimate = estimateTokens(summary);

  // Initialize state
  const state: StreamingSummaryState = {
    userId,
    threadId,
    lastSummary: summary,
    lastSummaryTokens: tokensEstimate,
    messageCount: messages.length,
    lastProcessedIndex: messages.length,
    windowSize: finalConfig.windowSize,
    overlap: finalConfig.overlap,
    updatedAt: Date.now(),
  };

  await saveState(state);

  return {
    summary,
    tokensEstimate,
    isIncremental: false,
    newMessagesProcessed: messages.length,
    totalMessages: messages.length,
  };
}

/**
 * Generate summary using sliding window (for initial summarization)
 */
async function generateSlidingWindowSummary(
  messages: Message[],
  config: StreamingConfig
): Promise<string> {
  if (messages.length <= config.windowSize) {
    return await summarizeSingleWindow(messages, config);
  }

  const miniSummaries: string[] = [];

  for (let start = 0; start < messages.length; start += (config.windowSize - config.overlap)) {
    const end = Math.min(start + config.windowSize, messages.length);
    const windowMessages = messages.slice(start, end);

    if (windowMessages.length < 2 && start > 0) break;

    const windowLabel = config.language === 'ar'
      ? `[الجزء ${start + 1}-${end}]`
      : `[Part ${start + 1}-${end}]`;

    const windowSummary = await summarizeSingleWindow(windowMessages, config);
    miniSummaries.push(`${windowLabel}\n${windowSummary}`);

    if (end >= messages.length) break;
  }

  // Combine if multiple windows
  if (miniSummaries.length > 1) {
    return await combineMiniSummaries(miniSummaries, config);
  }

  return miniSummaries[0] || '';
}

/**
 * Summarize a single window of messages
 */
async function summarizeSingleWindow(
  messages: Message[],
  config: StreamingConfig
): Promise<string> {
  const content = messages
    .map(m => `${m.role === 'user' ? 'المستخدم' : 'المساعد'}: ${m.content}`)
    .join('\n\n');

  const prompt = config.language === 'ar'
    ? `لخص المحادثة التالية بشكل ${config.style === 'brief' ? 'مختصر' : 'مفصل'}:

${content}

**الملخص:**`
    : `Summarize the following conversation in a ${config.style} manner:

${content}

**Summary:`;

  try {
    const model = getSummaryModel();
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: config.maxSummaryTokens,
      temperature: 0.3,
    });
    return text.trim();
  } catch (error) {
    log.error('[StreamingSummarizer] Error summarizing window', { error });
    return messages.slice(-2).map(m => m.content.substring(0, 80)).join('، ');
  }
}

/**
 * Combine multiple mini-summaries into one
 */
async function combineMiniSummaries(
  miniSummaries: string[],
  config: StreamingConfig
): Promise<string> {
  const combined = miniSummaries.join('\n\n');

  const prompt = config.language === 'ar'
    ? `ادمج الملخصات الجزئية التالية في ملخص واحد متماسك مع الحفاظ على الترتيب الزمني:

${combined}

**الملخص الموحد:**`
    : `Merge the following partial summaries into one cohesive summary while preserving temporal order:

${combined}

**Combined Summary:`;

  try {
    const model = getSummaryModel();
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: config.maxSummaryTokens,
      temperature: 0.3,
    });
    return text.trim();
  } catch (error) {
    log.error('[StreamingSummarizer] Error combining summaries', { error });
    return miniSummaries.join('\n\n---\n\n');
  }
}

/**
 * Get the model for summarization
 */
function getSummaryModel() {
  const modelId = MemoryConfig.summarization.model;
  const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
  const azureEndpoint = process.env.AZURE_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;

  if (azureKey && azureEndpoint) {
    const cleanEndpoint = azureEndpoint.replace(/\/$/, '');
    return createOpenAI({
      baseURL: cleanEndpoint,
      apiKey: azureKey,
      headers: { "api-key": azureKey },
    }).chat(modelId);
  } else if (process.env.BIGMODEL_API_KEY) {
    // BigModel's OpenAI-compatible endpoint — OpenRouter accounts without
    // credits 402 on every summary merge, so prefer BigModel when available.
    return createOpenAI({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: process.env.BIGMODEL_API_KEY,
    }).chat('glm-4-flash');
  } else if (process.env.OPENROUTER_API_KEY) {
    return createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    }).chat(`openai/${modelId}`);
  }

  throw new Error('No AI provider configured for streaming summarization');
}

// ==========================================
// Pipeline Integration
// ==========================================

/**
 * Check if streaming summarization should be triggered
 * Called from the pipeline's context window management step
 */
export async function shouldTriggerStreamingSummary(
  userId: string,
  messageCount: number,
  threadId?: string
): Promise<{ shouldTrigger: boolean; state?: StreamingSummaryState }> {
  const state = await loadState(userId, threadId);
  
  if (!state) {
    // First run - trigger if we have enough messages
    return { shouldTrigger: messageCount >= DEFAULT_CONFIG.minNewMessages };
  }

  // Trigger if enough new messages since last summary
  const newMessages = messageCount - state.lastProcessedIndex;
  return { 
    shouldTrigger: newMessages >= DEFAULT_CONFIG.minNewMessages,
    state,
  };
}

/**
 * Get current summary state for monitoring
 */
export function getSummaryState(userId: string, threadId?: string): StreamingSummaryState | null {
  const key = getStateKey(userId, threadId);
  return summaryStates.get(key) ?? null;
}

/**
 * Reset summary state (e.g., on new conversation)
 */
export async function resetSummaryState(userId: string, threadId?: string): Promise<void> {
  await clearState(userId, threadId);
}

/**
 * Get summary statistics for monitoring
 */
export function getSummaryStats(): {
  activeStates: number;
  totalMessagesProcessed: number;
  avgSummaryTokens: number;
} {
  let totalMessages = 0;
  let totalTokens = 0;
  
  for (const state of summaryStates.values()) {
    totalMessages += state.messageCount;
    totalTokens += state.lastSummaryTokens;
  }

  return {
    activeStates: summaryStates.size,
    totalMessagesProcessed: totalMessages,
    avgSummaryTokens: summaryStates.size > 0 ? Math.round(totalTokens / summaryStates.size) : 0,
  };
}

/**
 * Database migration for streaming summary state (optional persistence):
 * 
 * CREATE TABLE streaming_summary_states (
 *   id BIGSERIAL PRIMARY KEY,
 *   user_id UUID NOT NULL REFERENCES auth.users(id),
 *   thread_id UUID REFERENCES chat_sessions(id),
 *   state JSONB NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   UNIQUE(user_id, thread_id)
 * );
 * 
 * CREATE INDEX ON streaming_summary_states (user_id);
 */

// Export singleton instance
export const streamingSummarizer = {
  updateStreamingSummary,
  generateInitialStreamingSummary,
  shouldTriggerStreamingSummary,
  getSummaryState,
  resetSummaryState,
  getSummaryStats,
};