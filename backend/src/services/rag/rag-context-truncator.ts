/**
 * RAG Context Truncation System
 * نظام اقتطاع سياق RAG لكل مصدر
 * 
 * Distributes token budget across retrieved sources proportionally
 * based on relevance scores, with per-source truncation preserving
 * semantic boundaries (paragraphs, sections).
 */

import { estimateTokens } from '../memory/token-estimator.js';
import { createLogger } from '../../utils/logger.js';
import type { RankedDoc } from '../chat/pipeline/types.js';

const log = createLogger('rag-context-truncator');

// ==========================================
// Types
// ==========================================

export interface RAGSource {
  id: string | number;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  rerankScore: number;
  sourceName: string;
}

export interface RAGTruncationConfig {
  /** Total token budget for ALL RAG context */
  totalBudgetTokens: number;
  /** Minimum tokens per source (to keep at least something) */
  minTokensPerSource: number;
  /** Maximum tokens per source (cap) */
  maxTokensPerSource: number;
  /** Reserve tokens for source headers/formatting */
  headerOverheadTokens: number;
  /** Allocation strategy */
  strategy: 'proportional' | 'equal' | 'priority' | 'hybrid';
  /** Enable semantic boundary preservation */
  preserveBoundaries: boolean;
}

export interface TruncatedSource {
  original: RAGSource;
  truncatedContent: string;
  originalTokens: number;
  truncatedTokens: number;
  wasTruncated: boolean;
  truncationRatio: number;
}

export interface RAGTruncationResult {
  sources: TruncatedSource[];
  totalOriginalTokens: number;
  totalTruncatedTokens: number;
  budgetTokens: number;
  utilizationPercent: number;
  contextText: string;
  sourceNames: string[];
  warnings: string[];
}

// ==========================================
// Default Configuration
// ==========================================

const DEFAULT_CONFIG: RAGTruncationConfig = {
  totalBudgetTokens: 3000,
  minTokensPerSource: 100,
  maxTokensPerSource: 1500,
  headerOverheadTokens: 50,
  strategy: 'hybrid',
  preserveBoundaries: true,
};

// ==========================================
// Core Truncation Logic
// ==========================================

/**
 * Truncate RAG sources to fit within token budget
 * Uses proportional allocation based on relevance scores
 */
export function truncateRAGSources(
  rankedDocs: RankedDoc[],
  config: Partial<RAGTruncationConfig> = {}
): RAGTruncationResult {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const warnings: string[] = [];

  if (rankedDocs.length === 0) {
    return {
      sources: [],
      totalOriginalTokens: 0,
      totalTruncatedTokens: 0,
      budgetTokens: finalConfig.totalBudgetTokens,
      utilizationPercent: 0,
      contextText: '',
      sourceNames: [],
      warnings,
    };
  }

  // Convert to RAGSource format with cleaned names
  const sources: RAGSource[] = rankedDocs.map((doc, idx) => {
    const sourceName = cleanSourceName(
      typeof doc.metadata?.source === 'string' ? doc.metadata.source :
      typeof doc.metadata?.source_url === 'string' ? doc.metadata.source_url :
      typeof doc.metadata?.file_name === 'string' ? doc.metadata.file_name : undefined
    );
    const pageHint = doc.metadata?.page_number ? ` (page ${doc.metadata.page_number})` : '';
    const sectionHint = typeof doc.metadata?.structure_path === 'string' && doc.metadata.structure_path
      ? ` [${doc.metadata.structure_path}]` : '';
    const fullSourceName = `${sourceName}${pageHint}${sectionHint}`;

    return {
      id: doc.id,
      content: doc.content,
      metadata: doc.metadata,
      similarity: doc.similarity || 0,
      rerankScore: doc.rerankScore || 0,
      sourceName: fullSourceName,
    };
  });

  // Calculate scores for allocation (hybrid of similarity and rerank)
  const scores = sources.map((s) => {
    const similarityWeight = 0.6;
    const rerankWeight = 0.4;
    return (s.similarity * similarityWeight) + (s.rerankScore * rerankWeight);
  });

  // Allocate budget per source
  const allocations = allocateBudgetProportional(scores, sources.length, finalConfig);

  // Truncate each source
  const truncatedSources: TruncatedSource[] = sources.map((source, idx) => {
    const allocatedTokens = allocations[idx];
    const headerTokens = finalConfig.headerOverheadTokens;
    const contentBudget = Math.max(0, allocatedTokens - headerTokens);
    
    const originalTokens = estimateTokens(source.content);
    
    if (originalTokens <= contentBudget) {
      return {
        original: source,
        truncatedContent: source.content,
        originalTokens,
        truncatedTokens: originalTokens,
        wasTruncated: false,
        truncationRatio: 1.0,
      };
    }

    // Truncate with boundary preservation
    const truncatedContent = truncateWithBoundaries(
      source.content,
      contentBudget,
      finalConfig.preserveBoundaries
    );
    const truncatedTokens = estimateTokens(truncatedContent);

    return {
      original: source,
      truncatedContent,
      originalTokens,
      truncatedTokens,
      wasTruncated: true,
      truncationRatio: truncatedTokens / originalTokens,
    };
  });

  // Build final context text
  const contextParts: string[] = [];
  const sourceNames: string[] = [];
  let totalTruncatedTokens = 0;

  for (const ts of truncatedSources) {
    const header = `[Source: ${ts.original.sourceName}]`;
    const headerTokens = estimateTokens(header);
    const contentWithHeader = `${header}\n${ts.truncatedContent}`;
    
    // Verify we're within allocation
    const actualTokens = estimateTokens(contentWithHeader);
    if (actualTokens > allocations[truncatedSources.indexOf(ts)] + 50) {
      warnings.push(`Source "${ts.original.sourceName}" exceeds allocation (${actualTokens} vs ${allocations[truncatedSources.indexOf(ts)]})`);
    }

    contextParts.push(contentWithHeader);
    sourceNames.push(ts.original.sourceName);
    totalTruncatedTokens += ts.truncatedTokens;
  }

  const contextText = contextParts.join('\n\n');
  const totalOriginalTokens = truncatedSources.reduce((sum, ts) => sum + ts.originalTokens, 0);
  const utilizationPercent = finalConfig.totalBudgetTokens > 0 
    ? Math.round((totalTruncatedTokens / finalConfig.totalBudgetTokens) * 100) 
    : 0;

  if (utilizationPercent > 100) {
    warnings.push(`RAG context (${totalTruncatedTokens} tokens) exceeds budget (${finalConfig.totalBudgetTokens} tokens) by ${utilizationPercent - 100}%`);
  }

  log.info('RAG context truncated', {
    sourceCount: sources.length,
    totalOriginalTokens,
    totalTruncatedTokens,
    budget: finalConfig.totalBudgetTokens,
    utilizationPercent,
    truncatedCount: truncatedSources.filter(ts => ts.wasTruncated).length,
  });

  return {
    sources: truncatedSources,
    totalOriginalTokens,
    totalTruncatedTokens,
    budgetTokens: finalConfig.totalBudgetTokens,
    utilizationPercent,
    contextText,
    sourceNames,
    warnings,
  };
}

/**
 * Allocate budget proportionally based on relevance scores
 */
function allocateBudgetProportional(
  scores: number[],
  sourceCount: number,
  config: RAGTruncationConfig
): number[] {
  const { totalBudgetTokens, minTokensPerSource, maxTokensPerSource, strategy } = config;

  // Minimum allocation for all sources
  const minTotal = sourceCount * minTokensPerSource;
  if (minTotal >= totalBudgetTokens) {
    // Not enough budget for minimums - distribute equally
    const equalShare = Math.floor(totalBudgetTokens / sourceCount);
    return Array(sourceCount).fill(Math.max(equalShare, minTokensPerSource));
  }

  const remainingBudget = totalBudgetTokens - minTotal;

  let allocations: number[];

  switch (strategy) {
    case 'equal': {
      const equalShare = Math.floor(remainingBudget / sourceCount);
      allocations = scores.map(() => minTokensPerSource + equalShare);
      break;
    }
    case 'proportional': {
      const totalScore = scores.reduce((sum, s) => sum + s, 0);
      if (totalScore === 0) {
        const equalShare = Math.floor(remainingBudget / sourceCount);
        allocations = scores.map(() => minTokensPerSource + equalShare);
      } else {
        allocations = scores.map((score) => {
          const proportional = Math.floor((score / totalScore) * remainingBudget);
          return minTokensPerSource + proportional;
        });
      }
      break;
    }
    case 'priority': {
      // Top source gets more, rest get minimum
      const maxIdx = scores.indexOf(Math.max(...scores));
      allocations = scores.map((_, i) => 
        i === maxIdx ? minTokensPerSource + remainingBudget : minTokensPerSource
      );
      break;
    }
    case 'hybrid':
    default: {
      // Hybrid: proportional but with floor/ceiling
      const totalScore = scores.reduce((sum, s) => sum + s, 0);
      if (totalScore === 0) {
        const equalShare = Math.floor(remainingBudget / sourceCount);
        allocations = scores.map(() => minTokensPerSource + equalShare);
      } else {
        allocations = scores.map((score) => {
          const proportional = Math.floor((score / totalScore) * remainingBudget);
          // Ensure minimum meaningful allocation
          return minTokensPerSource + Math.max(proportional, Math.floor(remainingBudget * 0.1));
        });
      }
      break;
    }
  }

  // Apply max cap
  allocations = allocations.map((a) => Math.min(a, maxTokensPerSource));

  // Redistribute any excess from capping
  let excess = allocations.reduce((sum, a) => sum + a, 0) - totalBudgetTokens;
  while (excess > 0) {
    for (let i = 0; i < allocations.length && excess > 0; i++) {
      if (allocations[i] > minTokensPerSource) {
        const reduction = Math.min(excess, allocations[i] - minTokensPerSource);
        allocations[i] -= reduction;
        excess -= reduction;
      }
    }
    if (excess > 0) break; // Can't reduce further
  }

  return allocations;
}

/**
 * Truncate content preserving semantic boundaries
 * Tries to keep complete paragraphs, sections, sentences
 */
function truncateWithBoundaries(
  content: string,
  maxTokens: number,
  preserveBoundaries: boolean
): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) return content;

  if (!preserveBoundaries) {
    // Hard truncate at character level (rough approximation)
    const ratio = maxTokens / currentTokens;
    const targetChars = Math.floor(content.length * ratio * 0.95);
    return content.substring(0, targetChars) + '\n\n[...truncated...]';
  }

  // Try boundaries in order of preference
  const boundaries = [
    { pattern: '\n\n## ', name: 'markdown h2' },
    { pattern: '\n\n### ', name: 'markdown h3' },
    { pattern: '\n\n#### ', name: 'markdown h4' },
    { pattern: '\n\n', name: 'paragraph' },
    { pattern: '. ', name: 'sentence' },
    { pattern: ' ', name: 'word' },
  ];

  for (const { pattern, name } of boundaries) {
    const parts = content.split(pattern);
    if (parts.length <= 1) continue;

    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const candidate = result + pattern + parts[i];
      if (estimateTokens(candidate) <= maxTokens) {
        result = candidate;
      } else {
        break;
      }
    }

    if (estimateTokens(result) <= maxTokens && result.length > content.length * 0.3) {
      return result + '\n\n[...truncated...]';
    }
  }

  // Fallback: hard truncate
  const ratio = maxTokens / currentTokens;
  const targetChars = Math.floor(content.length * ratio * 0.95);
  return content.substring(0, targetChars) + '\n\n[...truncated...]';
}

/**
 * Clean source name for display
 */
function cleanSourceName(source?: string): string {
  if (!source) return 'Knowledge Base';
  return source
    .replace(/^Textbook:\s*/i, '')
    .replace(/\.pdf$/i, '')
    .replace(/[_-]/g, ' ')
    .trim() || 'Knowledge Base';
}

/**
 * Calculate optimal RAG budget based on model context window
 */
export function calculateRAGBudget(modelId: string, reservedForPrompt: number): number {
  const maxContext = getModelContextWindow(modelId);
  // Reserve: output (4096) + system prompt (2000) + messages (variable)
  // Use 30% of remaining for RAG
  const available = maxContext - reservedForPrompt;
  return Math.max(1000, Math.floor(available * 0.3));
}

/**
 * Get model context window (re-export from token-estimator)
 */
import { getModelContextWindow } from '../memory/token-estimator.js';
export { getModelContextWindow };

/**
 * Quick utility to estimate tokens for RAG sources without truncation
 */
export function estimateRAGTokens(rankedDocs: RankedDoc[]): {
  totalTokens: number;
  perSource: Array<{ sourceName: string; tokens: number }>;
} {
  const perSource = rankedDocs.map((doc) => {
    const sourceName = cleanSourceName(
      typeof doc.metadata?.source === 'string' ? doc.metadata.source :
      typeof doc.metadata?.source_url === 'string' ? doc.metadata.source_url :
      typeof doc.metadata?.file_name === 'string' ? doc.metadata.file_name : undefined
    );
    const header = `[Source: ${sourceName}]`;
    const tokens = estimateTokens(header) + estimateTokens(doc.content) + 50; // overhead
    return { sourceName, tokens };
  });

  return {
    totalTokens: perSource.reduce((sum, s) => sum + s.tokens, 0),
    perSource,
  };
}

/**
 * Export truncateWithBoundaries for external use (e.g., final safety truncation)
 */
export { truncateWithBoundaries };