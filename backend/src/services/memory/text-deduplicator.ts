/**
 * Text Deduplication Utility
 * أداة إزالة التكرار من النصوص
 * 
 * Provides intelligent text deduplication using multiple strategies:
 * - Exact string matching
 * - Jaccard similarity for token overlap
 * - Semantic similarity (when embeddings available)
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('text-deduplicator');

export type DeduplicationStrategy = 'exact' | 'jaccard' | 'semantic';

export interface DeduplicationOptions {
  strategy: DeduplicationStrategy;
  threshold: number; // 0-1, higher means more strict deduplication
  minLength?: number; // Minimum text length to consider for deduplication
}

const DEFAULT_OPTIONS: DeduplicationOptions = {
  strategy: 'jaccard',
  threshold: 0.7,
  minLength: 20,
};

/**
 * Simple tokenizer for text comparison
 */
function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return new Set(tokens);
}

/**
 * Calculate Jaccard similarity between two texts
 * Jaccard = (intersection) / (union)
 */
function jaccardSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);
  
  if (tokens1.size === 0 && tokens2.size === 0) return 1.0;
  if (tokens1.size === 0 || tokens2.size === 0) return 0.0;
  
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);
  
  return intersection.size / union.size;
}

/**
 * Check if two texts are similar enough to be considered duplicates
 */
function isDuplicate(
  text1: string, 
  text2: string, 
  options: DeduplicationOptions
): boolean {
  // Skip short texts
  if (options.minLength && text1.length < options.minLength && text2.length < options.minLength) {
    return false;
  }
  
  // Exact match
  if (text1 === text2) return true;
  
  // Substring match (one contains the other)
  if (text1.includes(text2) || text2.includes(text1)) {
    const shorter = text1.length < text2.length ? text1 : text2;
    const longer = text1.length < text2.length ? text2 : text1;
    if (shorter.length / longer.length > 0.8) {
      return true;
    }
  }
  
  // Jaccard similarity
  if (options.strategy === 'jaccard' || options.strategy === 'semantic') {
    const similarity = jaccardSimilarity(text1, text2);
    return similarity >= options.threshold;
  }
  
  return false;
}

/**
 * Deduplicate an array of texts using the specified strategy
 */
export function deduplicateTexts(
  texts: string[], 
  options: Partial<DeduplicationOptions> = {}
): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const unique: string[] = [];
  
  for (const text of texts) {
    const isDuplicateOf = unique.some(existing => 
      isDuplicate(text, existing, opts)
    );
    
    if (!isDuplicateOf) {
      unique.push(text);
    } else {
      log.debug('Deduplicated text', { 
        textLength: text.length, 
        strategy: opts.strategy 
      });
    }
  }
  
  return unique;
}

/**
 * Check if a text is already contained in a collection
 */
export function containsDuplicate(
  text: string, 
  existingTexts: string[], 
  options: Partial<DeduplicationOptions> = {}
): boolean {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return existingTexts.some(existing => isDuplicate(text, existing, opts));
}

/**
 * Extract unique sentences from a text while preserving order
 */
export function deduplicateSentences(
  text: string, 
  options: Partial<DeduplicationOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sentences = text.split(/[.!?。！？]/).filter(s => s.trim().length > 0);
  const uniqueSentences = deduplicateTexts(sentences, opts);
  return uniqueSentences.join('. ');
}

/**
 * Advanced deduplication for memory system
 * Specifically designed for memory facts and context
 */
export interface MemoryDeduplicationResult {
  uniqueTexts: string[];
  duplicatesRemoved: number;
  similarityScores: number[];
}

export function deduplicateMemoryContexts(
  contexts: string[],
  options: Partial<DeduplicationOptions> = {}
): MemoryDeduplicationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const unique: string[] = [];
  const similarityScores: number[] = [];
  
  for (const context of contexts) {
    let bestScore = 0;
    
    for (let i = 0; i < unique.length; i++) {
      const score = jaccardSimilarity(context, unique[i]);
      if (score > bestScore) {
        bestScore = score;
      }
    }
    
    if (bestScore >= opts.threshold) {
      // Found a duplicate, log the similarity score
      similarityScores.push(bestScore);
      log.debug('Memory context deduplicated', { 
        similarity: bestScore, 
        threshold: opts.threshold 
      });
    } else {
      unique.push(context);
    }
  }
  
  return {
    uniqueTexts: unique,
    duplicatesRemoved: contexts.length - unique.length,
    similarityScores,
  };
}