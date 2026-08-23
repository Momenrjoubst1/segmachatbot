/**
 * Token Estimation Utility
 * تقدير عدد التوكنات بدقة كافية لإدارة Context Window
 * 
 * Uses js-tiktoken (cl100k_base) for accurate token counting,
 * with heuristic fallback if tiktoken fails to load.
 */

import { getEncoding, Tiktoken } from 'js-tiktoken';
import { createLogger } from '../../utils/logger.js';
import { MEMORY_CONFIG } from '../../config/constants.js';
import { getModelContextWindow, getModelInfo, MODEL_CONTEXT_WINDOWS } from './model-context.js';

const log = createLogger('token-estimator');

// ==========================================
// Tiktoken Encoder Singleton
// ==========================================
let encoder: Tiktoken | null = null;
let encoderLoadAttempted = false;

function getEncoder(): Tiktoken | null {
  if (!encoderLoadAttempted) {
    encoderLoadAttempted = true;
    try {
      encoder = getEncoding('cl100k_base');
      log.info('tiktoken cl100k_base encoder loaded successfully');
    } catch (e) {
      log.warn('Failed to load tiktoken, using heuristic fallback', { error: String(e) });
    }
  }
  return encoder;
}

// ==========================================
// Language-aware Character Ratios (heuristic fallback)
// ==========================================
const CHARS_PER_TOKEN = {
  english: 4,
  arabic: 2.5,
  mixed: 3,
  code: 3.5,
} as const;

// ==========================================
// Arabic Detection
// ==========================================
const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

function detectPrimaryLanguage(text: string): 'english' | 'arabic' | 'mixed' {
  if (!text) return 'english';
  
  const arabicChars = (text.match(ARABIC_REGEX) || []).length;
  const totalChars = text.replace(/\s+/g, '').length;
  
  if (totalChars === 0) return 'english';
  
  const arabicRatio = arabicChars / totalChars;
  
  if (arabicRatio > 0.5) return 'arabic';
  if (arabicRatio > 0.15) return 'mixed';
  return 'english';
}

// ==========================================
// Code Detection
// ==========================================
const CODE_INDICATORS = /^(import |export |const |let |var |function |class |interface |type |def |async |await |=>|\{|\}|\/\/|\/\*|#\s|```)/m;

function isLikelyCode(text: string): boolean {
  return CODE_INDICATORS.test(text);
}

// ==========================================
// Core Token Estimation
// ==========================================

/**
 * Heuristic token estimation (fallback when tiktoken is unavailable)
 */
export function estimateTokensHeuristic(text: string): number {
  if (!text) return 0;
  
  const lang = detectPrimaryLanguage(text);
  const ratio = isLikelyCode(text) 
    ? CHARS_PER_TOKEN.code 
    : CHARS_PER_TOKEN[lang];
  
  // Add overhead for special tokens, formatting markers, etc.
  const overhead = 1.05; // 5% overhead
  
  return Math.ceil((text.length / ratio) * overhead);
}

/**
 * Estimate token count for a single string using tiktoken when available,
 * falling back to heuristic estimation otherwise.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch (e) {
      // If encoding fails for any reason, fall back to heuristic
if (MEMORY_CONFIG.debug.enabled) {
        log.warn('tiktoken encode failed, using heuristic fallback', { error: String(e) });
      }
      return estimateTokensHeuristic(text);
    }
  }
  
  return estimateTokensHeuristic(text);
}

/**
 * Estimate tokens for a structured message
 */
export function estimateMessageTokens(message: {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  toolCalls?: unknown[];
  toolInvocations?: unknown[];
}): number {
  let tokens = 4; // Base overhead for message structure (role, etc.)
  
  const content = message.content;
  
  if (typeof content === 'string') {
    tokens += estimateTokens(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'text' && typeof part.text === 'string') {
        tokens += estimateTokens(part.text);
      } else if (part.type === 'image') {
        // Image tokens depend on resolution, estimate conservatively
        tokens += IMAGE_TOKEN_COST;
      } else if (part.type === 'file') {
        // File content already extracted as text
        const fileText = String(part.data || '').substring(0, 50000);
        tokens += estimateTokens(fileText) + 20; // +20 for metadata
      } else if (part.type === 'tool-result') {
        const resultText = typeof part.result === 'string' 
          ? part.result 
          : JSON.stringify(part.result || '');
        tokens += estimateTokens(resultText);
      }
    }
  }
  
  // Tool calls overhead
  if (message.toolCalls?.length) {
    tokens += message.toolCalls.length * 30; // ~30 tokens per tool call
  }
  
  return tokens;
}

/**
 * Estimate total tokens for a conversation (array of messages)
 */
export function estimateConversationTokens(messages: Array<{
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  toolCalls?: unknown[];
  toolInvocations?: unknown[];
}>): number {
  // Base overhead: 3 tokens per message for role markers + system overhead
  let total = 3;
  
  for (const msg of messages) {
    total += estimateMessageTokens(msg) + 3; // +3 for message boundary tokens
  }
  
  return total;
}

/**
 * Context Window Manager - Model Aware
 * Decides when to trigger summarization based on actual token usage
 */
export interface ContextWindowStatus {
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
  shouldSummarize: boolean;
  urgency: 'ok' | 'warning' | 'critical';
  recommendation: 'keep_all' | 'summarize_middle' | 'aggressive_trim';
  modelId: string;
  modelName: string;
}

export function getContextWindowStatus(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
    toolCalls?: unknown[];
    toolInvocations?: unknown[];
  }>,
  modelId: string = 'gpt-4o-mini'
): ContextWindowStatus {
  const maxTokens = getModelContextWindow(modelId);
  const modelInfo = getModelInfo(modelId);
  const totalTokens = estimateConversationTokens(messages);
  const usagePercent = Math.round((totalTokens / maxTokens) * 100);
  
  let urgency: 'ok' | 'warning' | 'critical';
  let shouldSummarize: boolean;
  let recommendation: 'keep_all' | 'summarize_middle' | 'aggressive_trim';
  
  if (usagePercent >= 90) {
    urgency = 'critical';
    shouldSummarize = true;
    recommendation = 'aggressive_trim';
  } else if (usagePercent >= 70) {
    urgency = 'warning';
    shouldSummarize = true;
    recommendation = 'summarize_middle';
  } else {
    urgency = 'ok';
    shouldSummarize = false;
    recommendation = 'keep_all';
  }
  
  if (MEMORY_CONFIG.debug.enabled) {
    log.info('Context window status', {
      messageCount: messages.length,
      totalTokens,
      maxTokens,
      usagePercent,
      urgency,
      recommendation,
      modelId,
      modelName: modelInfo?.value,
    });
  }
  
  return { totalTokens, maxTokens, usagePercent, shouldSummarize, urgency, recommendation, modelId, modelName: modelInfo?.value ?? modelId };
}

// ==========================================
// Message Importance Scoring
// ==========================================

export interface MessageImportance {
  index: number;
  score: number;        // 0-1, higher = more important
  reason: string;
  shouldKeep: boolean;  // true = never summarize away
}

/**
 * Score message importance for intelligent trimming decisions.
 * Messages with high scores are preserved; low scores are summarization candidates.
 */
export function scoreMessageImportance(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
    toolCalls?: unknown[];
    toolInvocations?: unknown[];
    is_pinned?: boolean;
    id?: string;
  }>,
  options?: { pinnedMessageIds?: string[] }
): MessageImportance[] {
  const pinnedIds = new Set(options?.pinnedMessageIds ?? []);
  const results: MessageImportance[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgId = msg.id;
    let score = 0.4; // default
    let reason = 'standard message';
    let shouldKeep = false;

    // 1. Pinned messages: highest priority
    if (msg.is_pinned || (msgId && pinnedIds.has(msgId))) {
      score = 1.0;
      reason = 'pinned message';
      shouldKeep = true;
    }
    // 2. First message (system context)
    else if (i === 0) {
      score = 0.9;
      reason = 'system / first message';
      shouldKeep = true;
    }
    // 3. Last 3 messages (recent context)
    else if (i >= messages.length - 3) {
      score = 0.8;
      reason = 'recent message (last 3)';
      shouldKeep = true;
    }
    // 4. Messages with tool calls/results
    else if (hasToolContext(msg)) {
      score = 0.7;
      reason = 'contains tool calls or results';
      shouldKeep = false;
    }
    // 5. Messages with code blocks
    else if (hasCodeBlocks(msg)) {
      score = 0.6;
      reason = 'contains code blocks';
      shouldKeep = false;
    }
    // 6. Short acknowledgments
    else if (isAcknowledgment(msg)) {
      score = 0.1;
      reason = 'short acknowledgment';
      shouldKeep = false;
    }
    // 7. Default
    else {
      score = 0.4;
      reason = 'standard message';
      shouldKeep = false;
    }

    results.push({ index: i, score, reason, shouldKeep });
  }

  return results;
}

/** Check if a message contains tool calls or tool results */
function hasToolContext(msg: {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  toolCalls?: unknown[];
  toolInvocations?: unknown[];
}): boolean {
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  if (msg.toolInvocations && msg.toolInvocations.length > 0) return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      part => part.type === 'tool-result' || part.type === 'tool-call'
    );
  }
  return false;
}

/** Check if a message contains code blocks */
function hasCodeBlocks(msg: {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}): boolean {
  const text = extractTextContent(msg);
  return /```[\s\S]*?```/.test(text);
}

/** Check if a message is a short acknowledgment */
function isAcknowledgment(msg: {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}): boolean {
  const text = extractTextContent(msg).trim().toLowerCase();
  if (text.length > 20) return false; // too long to be an acknowledgment
  const ackPatterns = /^(شكرا?|ok|okay|تمام|أهلا?|نعم|لا|thanks|thank you|got it|sounds good|sure|yes|no|صحيح|ممتاز|جيد|حسنا?)$/i;
  return ackPatterns.test(text);
}

/** Extract plain text from a message */
function extractTextContent(msg: {
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text!)
      .join(' ');
  }
  return '';
}

// ==========================================
// Smart Trimming Plan (importance-aware)
// ==========================================

/**
 * Smart message trimming based on token budget + importance scoring.
 * Keeps first N and last M messages, summarizes the middle,
 * while respecting importance scores.
 */
export interface TrimPlan {
  keepFirst: number;  // Number of messages to keep from start
  keepLast: number;   // Number of messages to keep from end
  summarizeMiddle: number; // Number of messages to summarize
  estimatedTokensAfter: number;
  /** Indices of messages that should be summarized (low importance) */
  summarizeIndices?: number[];
  /** Indices of messages that must be kept (high importance) */
  keepIndices?: number[];
}

export function calculateTrimPlan(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
    toolCalls?: unknown[];
    toolInvocations?: unknown[];
    is_pinned?: boolean;
    id?: string;
  }>,
  modelId: string = 'gpt-4o-mini',
  targetTokensRatio: number = 0.7, // Target 70% usage
  keepFirstMin = parseInt(process.env.MEMORY_KEEP_FIRST || '5'),
): TrimPlan {
  const maxTokens = getModelContextWindow(modelId);
  const targetTokens = Math.floor(maxTokens * targetTokensRatio);
  const totalTokens = estimateConversationTokens(messages);
  
  if (totalTokens <= targetTokens) {
    return {
      keepFirst: messages.length,
      keepLast: 0,
      summarizeMiddle: 0,
      estimatedTokensAfter: totalTokens,
      summarizeIndices: [],
      keepIndices: messages.map((_, i) => i),
    };
  }

  // Score all messages by importance
  const importanceScores = scoreMessageImportance(messages);
  
  // Reserve ~15% of target for summary placeholder
  const summaryBudget = Math.round(targetTokens * 0.15);
  const messageBudget = targetTokens - summaryBudget;
  
  // Keep first messages (system prompt, initial context)
  let firstTokens = 0;
  let keepFirst = 0;
  for (let i = 0; i < Math.min(keepFirstMin, messages.length); i++) {
    firstTokens += estimateMessageTokens(messages[i]) + 3;
    keepFirst++;
  }
  
  // Keep last messages (most recent context)
  let lastTokens = 0;
  let keepLast = 0;
  const remainingBudget = messageBudget - firstTokens;
  
  for (let i = messages.length - 1; i >= keepFirst && lastTokens < remainingBudget; i--) {
    const msgTokens = estimateMessageTokens(messages[i]) + 3;
    if (lastTokens + msgTokens > remainingBudget) break;
    lastTokens += msgTokens;
    keepLast++;
  }
  
  // Determine which middle messages to keep vs summarize based on importance
  const middleStart = keepFirst;
  const middleEnd = messages.length - keepLast;
  const summarizeIndices: number[] = [];
  const keepIndices: number[] = [];
  
  // First pass: identify must-keep messages in the middle
  const mustKeepMiddle: number[] = [];
  for (let i = middleStart; i < middleEnd; i++) {
    keepIndices.push(i); // track all initially kept
    const score = importanceScores[i];
    if (score.shouldKeep) {
      mustKeepMiddle.push(i);
    }
  }
  
  // If still over budget after keeping first/last, trim lowest importance middle messages
  let currentBudget = firstTokens + lastTokens;
  
  // Add must-keep middle messages to budget
  for (const idx of mustKeepMiddle) {
    currentBudget += estimateMessageTokens(messages[idx]) + 3;
  }
  
  // Sort remaining middle messages by score (ascending) for trimming
  const remainingMiddle = [];
  for (let i = middleStart; i < middleEnd; i++) {
    if (!mustKeepMiddle.includes(i)) {
      remainingMiddle.push({ index: i, score: importanceScores[i].score });
    }
  }
  remainingMiddle.sort((a, b) => a.score - b.score); // lowest score first
  
  // Add middle messages by importance until budget is exhausted
  for (const { index, score: _score } of remainingMiddle) {
    const msgTokens = estimateMessageTokens(messages[index]) + 3;
    if (currentBudget + msgTokens <= messageBudget) {
      currentBudget += msgTokens;
    } else {
      summarizeIndices.push(index);
      // Remove from keepIndices
      const kIdx = keepIndices.indexOf(index);
      if (kIdx !== -1) keepIndices.splice(kIdx, 1);
    }
  }
  
  const summarizeMiddle = summarizeIndices.length || Math.max(0, messages.length - keepFirst - keepLast);
  const estimatedTokensAfter = currentBudget + summaryBudget;
  
  return {
    keepFirst,
    keepLast,
    summarizeMiddle,
    estimatedTokensAfter,
    summarizeIndices: summarizeIndices.length > 0 ? summarizeIndices : undefined,
    keepIndices: keepIndices.length > 0 ? keepIndices : undefined,
  };
}

// ==========================================
// Constants
// ==========================================

// ==========================================
// Re-exports from model-context
// ==========================================

export { getModelContextWindow, getModelInfo, MODEL_CONTEXT_WINDOWS } from './model-context.js';

// Estimated token cost for an image (varies by model/resolution, this is conservative)
const IMAGE_TOKEN_COST = 85; // ~85 tokens for a typical image in GPT-4o
