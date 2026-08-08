/**
 * Unified Memory Manager
 * منسق الذاكرة الموحد - يجمع كل أنظمة الذاكرة في واجهة واحدة
 * 
 * Consolidates:
 * - Session Memory (short-term, within conversation)
 * - Cross-Session Memory (long-term, across conversations)
 * - Enhanced Memory Bank (facts, preferences)
 * - Context Cache (conversation summaries)
 * 
 * Provides:
 * - Single entry point for all memory operations
 * - Consistent retrieval scoring
 * - TTL-based memory tiers
 * - Background extraction coordination
 */

import { createLogger } from '../../utils/logger.js';
import { MemoryConfig } from '../../config/memory.config.js';
import { buildMemoryContext, tryExtractAndStore, resetExtractionCounter } from './memory-context-builder.js';
import { contextCache } from './context-cache.service.js';
import { enhancedMemory } from './enhanced-memory.service.js';
import { crossSession } from './cross-session.service.js';

const log = createLogger('unified-memory');

// ==========================================
// Memory Tiers
// ==========================================

export enum MemoryTier {
  SESSION = 'session',       // Current conversation only
  SHORT_TERM = 'short_term', // Last few hours
  LONG_TERM = 'long_term',   // Cross-session facts
  PERMANENT = 'permanent',   // User preferences, critical info
}

export interface MemoryRetrievalOptions {
  userId: string;
  threadId?: string;
  query?: string;
  maxResults?: number;
  includeSession?: boolean;
  includeCrossSession?: boolean;
  includeFacts?: boolean;
  minRelevance?: number; // 0-1
}

export interface MemoryRetrievalResult {
  tier: MemoryTier;
  content: string;
  relevance: number;
  source: string;
  timestamp: number;
}

export interface UnifiedMemoryContext {
  sessionContext: string;
  longTermFacts: string;
  crossSessionContext: string;
  customInstructions: string;
  retrievalStats: {
    sessionHits: number;
    crossSessionHits: number;
    factsCount: number;
    totalTimeMs: number;
  };
}

// ==========================================
// Unified Memory Manager
// ==========================================

class UnifiedMemoryManager {
  private static instance: UnifiedMemoryManager;
  
  private constructor() {}
  
  static getInstance(): UnifiedMemoryManager {
    if (!UnifiedMemoryManager.instance) {
      UnifiedMemoryManager.instance = new UnifiedMemoryManager();
    }
    return UnifiedMemoryManager.instance;
  }
  
  /**
   * Build complete memory context for a chat request
   * Single entry point that coordinates all memory systems
   */
  async buildContext(options: MemoryRetrievalOptions): Promise<UnifiedMemoryContext> {
    const startTime = Date.now();
    const result: UnifiedMemoryContext = {
      sessionContext: '',
      longTermFacts: '',
      crossSessionContext: '',
      customInstructions: '',
      retrievalStats: {
        sessionHits: 0,
        crossSessionHits: 0,
        factsCount: 0,
        totalTimeMs: 0,
      },
    };
    
    const { userId, threadId, query, maxResults: _maxResults = 10 } = options;
    const parallelOps: Promise<void>[] = [];
    
    // 1. Long-term facts (Enhanced Memory Bank)
    if (options.includeFacts !== false && MemoryConfig.memoryBank.enabled) {
      parallelOps.push(
        buildMemoryContext(userId).then(ctx => {
          result.longTermFacts = ctx.facts;
          result.customInstructions = ctx.customInstructions;
          if (ctx.facts) {
            result.retrievalStats.factsCount = ctx.facts.split('\n').filter(l => l.trim()).length;
          }
        }).catch(err => {
          log.warn('Failed to build memory context', { error: err.message });
        })
      );
    }
    
    // 2. Cross-session context
    if (options.includeCrossSession !== false && MemoryConfig.crossSession.enabled && query && query.length > 10) {
      parallelOps.push(
        crossSession.buildCrossSessionContext(userId, query, threadId).then(ctx => {
          result.crossSessionContext = ctx;
          if (ctx) {
            result.retrievalStats.crossSessionHits++;
          }
        }).catch(err => {
          log.warn('Failed to build cross-session context', { error: err.message });
        })
      );
    }
    
    // Execute all memory retrievals in parallel
    await Promise.all(parallelOps);
    
    result.retrievalStats.totalTimeMs = Date.now() - startTime;
    
    if (MemoryConfig.debug.enabled) {
      log.info('Memory context built', {
        userId,
        threadId,
        stats: result.retrievalStats,
        hasSession: !!result.sessionContext,
        hasFacts: !!result.longTermFacts,
        hasCrossSession: !!result.crossSessionContext,
        hasInstructions: !!result.customInstructions,
      });
    }
    
    return result;
  }
  
  /**
   * FIX-09: Build FULL memory context from ALL THREE systems in parallel
   * with a 3-second timeout and deduplication.
   * Combines: manager.buildMemoryContext + enhancedMemory + crossSession
   */
  async buildFullMemoryContext(
    userId: string,
    query: string,
    threadId?: string
  ): Promise<{ prompt: string; stats: { factsCount: number; crossSessionHits: number; totalTimeMs: number } }> {
    const startTime = Date.now();
    const TIMEOUT_MS = 3000;

    let longTermFacts = '';
    let customInstructions = '';
    let enhancedContext = '';
    let crossSessionCtx = '';

    const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
      ]);

    const parallelOps = [
      // 1. Basic facts + custom instructions
      withTimeout(
        buildMemoryContext(userId).catch(err => {
          log.warn('buildMemoryContext failed', { error: err.message });
          return { facts: '', customInstructions: '' };
        }),
        { facts: '', customInstructions: '' }
      ).then(ctx => {
        longTermFacts = ctx.facts;
        customInstructions = ctx.customInstructions;
      }),

      // 2. Enhanced memory bank
      ...(MemoryConfig.memoryBank.enabled ? [
        withTimeout(
          enhancedMemory.buildMemoryContext(userId).catch(err => {
            log.warn('enhancedMemory failed', { error: err.message });
            return '';
          }),
          ''
        ).then(ctx => { enhancedContext = ctx; })
      ] : []),

      // 3. Cross-session recall
      ...(MemoryConfig.crossSession.enabled && query.length > 10 ? [
        withTimeout(
          crossSession.buildCrossSessionContext(userId, query, threadId).catch(err => {
            log.warn('crossSession failed', { error: err.message });
            return '';
          }),
          ''
        ).then(ctx => { crossSessionCtx = ctx; })
      ] : []),
    ];

    await Promise.all(parallelOps);

    // Deduplicate: if enhancedMemory content overlaps with longTermFacts, skip enhanced
    const parts: string[] = [];

    if (longTermFacts) {
      parts.push(`**About the User (Remembered across sessions):**\n${longTermFacts}\n\nUse these facts to personalize your responses. Do not mention these facts unless relevant.\nIf a fact seems outdated, ignore it - the user will correct you.`);
    }
    if (customInstructions) {
      parts.push(`**User's Custom Instructions:**\n${customInstructions}`);
    }
    if (enhancedContext && !longTermFacts.includes(enhancedContext.substring(0, 50))) {
      parts.push(`**معلومات محفوظة عن المستخدم:**\n${enhancedContext}`);
    }
    if (crossSessionCtx) {
      parts.push(`**Relevant context from previous conversations:**\n${crossSessionCtx}`);
    }

    if (parts.length > 0) {
      parts.push(`**ملاحظة:** استخدم هذه المعلومات لتخصيص ردودك. لا تذكرها إلا إذا كانت ذات صلة بالسؤال.`);
    }

    const totalTimeMs = Date.now() - startTime;
    const factsCount = longTermFacts ? longTermFacts.split('\n').filter(l => l.trim()).length : 0;

    log.info('Full memory context built (parallel)', {
      userId,
      factsCount,
      hasEnhanced: !!enhancedContext,
      hasCrossSession: !!crossSessionCtx,
      totalTimeMs,
    });

    return {
      prompt: parts.join('\n\n'),
      stats: { factsCount, crossSessionHits: crossSessionCtx ? 1 : 0, totalTimeMs },
    };
  }
  
  /**
   * Format unified memory context into a system prompt augmentation
   */
  formatForPrompt(context: UnifiedMemoryContext): string {
    const parts: string[] = [];
    
    if (context.longTermFacts) {
      parts.push(`**About the User (Remembered across sessions):**\n${context.longTermFacts}\n\nUse these facts to personalize your responses. Do not mention these facts unless relevant.`);
    }
    
    if (context.customInstructions) {
      parts.push(`**User's Custom Instructions:**\n${context.customInstructions}`);
    }
    
    if (context.crossSessionContext) {
      parts.push(`**Relevant context from previous conversations:**\n${context.crossSessionContext}`);
    }
    
    if (context.sessionContext) {
      parts.push(`**Current session context:**\n${context.sessionContext}`);
    }
    
    if (parts.length === 0) return '';
    
    return parts.join('\n\n');
  }
  
  /**
   * Extract and store memories from a completed conversation turn
   * Coordinated background extraction across all memory tiers
   */
  async extractFromTurn(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    threadId?: string,
    options?: {
      includeEnhanced?: boolean;
      includeCache?: boolean;
    }
  ): Promise<{ extracted: number; cached: boolean }> {
    let extracted = 0;
    let cached = false;
    
    const ops: Promise<void>[] = [];
    
    // 1. Basic fact extraction
    ops.push(
      tryExtractAndStore(userId, messages, threadId).catch(err => {
        log.warn('Basic memory extraction failed', { error: err.message });
      })
    );
    
    // 2. Enhanced memory extraction
    if (options?.includeEnhanced !== false && MemoryConfig.memoryBank.enabled) {
      ops.push(
        enhancedMemory.extractMemories(userId, messages, threadId).then(results => {
          if (results.length > 0) {
            extracted += results.length;
            log.info('Enhanced memories extracted', { count: results.length });
          }
        }).catch(err => {
          log.warn('Enhanced memory extraction failed', { error: err.message });
        })
      );
    }
    
    await Promise.all(ops);
    
    return { extracted, cached };
  }
  
  /**
   * Cache a conversation summary
   */
  async cacheSummary(userId: string, summary: string, threadId?: string): Promise<boolean> {
    if (!MemoryConfig.caching.enabled || !summary) return false;
    
    try {
      const result = await contextCache.set(userId, summary, {
        type: 'conversation_summary',
        sessionId: threadId,
        timestamp: Date.now(),
      });
      return result.cached;
    } catch (err) {
      log.warn('Failed to cache summary', { error: (err as Error)?.message });
      return false;
    }
  }
  
  /**
   * Clear all memory for a user (across all tiers)
   */
  async clearAll(userId: string): Promise<{ cleared: number }> {
    let cleared = 0;
    
    // Clear context cache
    const cacheCount = await contextCache.clearUserCache(userId);
    cleared += cacheCount;
    
    // Reset extraction counter
    resetExtractionCounter(userId);
    
    log.info('Cleared all memory for user', { userId, cacheCount });
    
    return { cleared };
  }
  
  /**
   * Get memory statistics
   */
  async getStats(_userId?: string): Promise<{
    cacheStats: any;
    config: any;
  }> {
    const cacheStats = await contextCache.getStats();
    
    return {
      cacheStats,
      config: {
        contextWindow: MemoryConfig.contextWindow,
        summarization: MemoryConfig.summarization,
        caching: { enabled: MemoryConfig.caching.enabled, ttl: MemoryConfig.caching.ttl },
        memoryBank: { enabled: MemoryConfig.memoryBank.enabled, maxFacts: MemoryConfig.memoryBank.maxFactsPerUser },
        crossSession: { enabled: MemoryConfig.crossSession.enabled, maxChats: MemoryConfig.crossSession.maxPreviousChats },
      },
    };
  }
}

// Export singleton
export const unifiedMemory = UnifiedMemoryManager.getInstance();
export { UnifiedMemoryManager };
