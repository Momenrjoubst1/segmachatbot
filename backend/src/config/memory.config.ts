// Advanced memory system configuration.

import { createLogger } from "../utils/logger.js";
import {
  MAX_CHAT_HISTORY_MESSAGES,
  KEEP_FIRST_MESSAGES,
  KEEP_LAST_MESSAGES,
} from "./constants.js";

const log = createLogger('memory-config');

export const MemoryConfig = {
  // Context window management settings.
  contextWindow: {
    // Max messages before summarization; the large window holds far more history.
    maxMessages: parseInt(process.env.MEMORY_MAX_MESSAGES || String(MAX_CHAT_HISTORY_MESSAGES)),

    // First messages always kept in context.
    keepFirstMessages: parseInt(process.env.MEMORY_KEEP_FIRST || String(KEEP_FIRST_MESSAGES)),

    // Last messages always kept in context.
    keepLastMessages: parseInt(process.env.MEMORY_KEEP_LAST || String(KEEP_LAST_MESSAGES)),
    
    // Minimum messages before summarization starts.
    minMessagesForSummary: parseInt(process.env.MEMORY_MIN_FOR_SUMMARY || '12'),
  },

  // Smart summarization settings.
  summarization: {
    // Enable or disable smart summarization.
    enabled: process.env.MEMORY_SUMMARIZATION_ENABLED !== 'false',
    
    // Model used for summarization (cheap and fast).
    model: process.env.MEMORY_SUMMARY_MODEL || 'gpt-4o-mini',
    
    // Maximum summary length in tokens.
    maxSummaryTokens: parseInt(process.env.MEMORY_SUMMARY_MAX_TOKENS || '500'),
    
    // Messages included in each summarization pass.
    messagesPerSummary: parseInt(process.env.MEMORY_MESSAGES_PER_SUMMARY || '10'),
    
    // Minimum message length to include in a summary.
    minMessageLength: parseInt(process.env.MEMORY_MIN_MESSAGE_LENGTH || '10'),
  },

  // Context caching settings.
  caching: {
    // Enable or disable context caching.
    enabled: process.env.MEMORY_CACHING_ENABLED !== 'false',
    
    // Cache retention period in seconds.
    ttl: parseInt(process.env.MEMORY_CACHE_TTL || '3600'), // ساعة واحدة
    
    // Minimum content size for caching, in characters.
    minContentSize: parseInt(process.env.MEMORY_CACHE_MIN_SIZE || '1000'),
    
    // Maximum cache size in MB.
    maxCacheSize: parseInt(process.env.MEMORY_CACHE_MAX_SIZE || '100'),
  },

  // Persistent memory bank settings.
  memoryBank: {
    // Enable or disable the persistent memory bank.
    enabled: process.env.MEMORY_BANK_ENABLED !== 'false',

    // Maximum facts stored per user.
    maxFactsPerUser: parseInt(process.env.MEMORY_MAX_FACTS || '100'),

    // Minimum messages before fact extraction runs.
    minMessagesForExtraction: parseInt(process.env.MEMORY_MIN_FOR_EXTRACTION || '6'),

    // Maximum extraction passes per session.
    maxExtractionsPerSession: parseInt(process.env.MEMORY_MAX_EXTRACTIONS || '5'),

    // Fact age limit in days before cleanup.
    maxFactAgeDays: parseInt(process.env.MEMORY_MAX_FACT_AGE_DAYS || '90'),

    // Supported fact categories.
    categories: [
      'personal',      // معلومات شخصية
      'academic',      // معلومات أكاديمية
      'preference',    // تفضيلات
      'context',       // سياق
      'goal',          // أهداف
      'schedule',      // جدول
      'behavior',      // سلوك
    ] as const,
  },

  // Cross-session recall settings.
  crossSession: {
    // Enable or disable recall across chats.
    enabled: process.env.MEMORY_CROSS_SESSION_ENABLED !== 'false',

    // Previous chats to search.
    maxPreviousChats: parseInt(process.env.MEMORY_MAX_PREVIOUS_CHATS || '10'),

    // Maximum chat age to search, in days.
    maxChatAgeDays: parseInt(process.env.MEMORY_MAX_CHAT_AGE_DAYS || '30'),

    // Cross-session entry age in days before cleanup.
    maxEntryAgeDays: parseInt(process.env.MEMORY_CROSS_SESSION_MAX_AGE_DAYS || '30'),

    // Results taken from each previous chat.
    resultsPerChat: parseInt(process.env.MEMORY_RESULTS_PER_CHAT || '3'),
  },

  // Performance and optimization settings.
  performance: {
    // Enable compression of long messages.
    compressionEnabled: process.env.MEMORY_COMPRESSION_ENABLED !== 'false',
    
    // Minimum message length that triggers compression.
    compressionThreshold: parseInt(process.env.MEMORY_COMPRESSION_THRESHOLD || '5000'),
    
    // Enable lazy loading of memory.
    lazyLoadingEnabled: process.env.MEMORY_LAZY_LOADING_ENABLED !== 'false',
    
    // Enable parallel processing of operations.
    parallelProcessing: process.env.MEMORY_PARALLEL_PROCESSING !== 'false',
  },

  // Debugging and monitoring settings.
  debug: {
    // Enable debug logging.
    enabled: process.env.MEMORY_DEBUG === 'true',
    
    // Enable performance metrics.
    performanceMetrics: process.env.MEMORY_METRICS === 'true',
    
    // Enable operation logging.
    logOperations: process.env.MEMORY_LOG_OPERATIONS === 'true',
  },
};

// Type definitions
export type MemoryCategory = typeof MemoryConfig.memoryBank.categories[number];

export interface MemoryMetrics {
  totalMessages: number;
  summarizedMessages: number;
  cachedItems: number;
  memoryFacts: number;
  crossSessionHits: number;
  processingTimeMs: number;
}

// Validation
export function validateMemoryConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (MemoryConfig.contextWindow.maxMessages < MemoryConfig.contextWindow.minMessagesForSummary) {
    errors.push('maxMessages must be >= minMessagesForSummary');
  }

  if (MemoryConfig.contextWindow.keepFirstMessages + MemoryConfig.contextWindow.keepLastMessages > MemoryConfig.contextWindow.maxMessages) {
    errors.push('keepFirstMessages + keepLastMessages must be <= maxMessages');
  }

  if (MemoryConfig.summarization.maxSummaryTokens < 100) {
    errors.push('maxSummaryTokens must be >= 100');
  }

  if (MemoryConfig.caching.ttl < 60) {
    errors.push('cache TTL must be >= 60 seconds');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Validate configuration on startup (skip in test environments)
if (process.env.NODE_ENV !== 'test') {
  const validation = validateMemoryConfig();
  if (!validation.valid) {
    log.error('Memory configuration errors', { errors: validation.errors });
    
    // In production, fail fast on critical configuration errors
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Invalid memory configuration: ${validation.errors.join(', ')}`);
    }
  }

  if (MemoryConfig.debug.enabled) {
    log.info('Advanced Memory System Configuration:', {
      contextWindow: MemoryConfig.contextWindow,
      summarization: MemoryConfig.summarization,
      caching: MemoryConfig.caching,
      memoryBank: MemoryConfig.memoryBank,
      crossSession: MemoryConfig.crossSession,
    });
    if (validation.valid) {
      log.info('Configuration valid');
    }
  }
}
