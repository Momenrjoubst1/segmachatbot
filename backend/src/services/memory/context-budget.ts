/**
 * Context Budget Allocation System
 * نظام تخصيص ميزانية السياق
 * 
 * Dynamically allocates token budget across prompt layers based on:
 * - Model's actual context window (from model-catalog)
 * - Reserved output tokens
 * - Priority-weighted distribution
 * - Runtime adaptation based on available context
 */

import { getModelContextWindow, getModelInfo, MAX_OUTPUT_TOKENS, type ModelContextInfo } from './model-context.js';
import { estimateTokens } from './token-estimator.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('context-budget');

// Type for model ID (using string since we use a local registry)
export type KnownModelId = string;

// ==========================================
// Types
// ==========================================

export interface ContextBudgetConfig {
  /** Model ID to determine max context window */
  modelId: string;
  /** Reserved tokens for model output (default: 4096) */
  reservedOutputTokens?: number;
  /** Minimum tokens to keep for system prompt base layers */
  minSystemPromptTokens?: number;
  /** Enable dynamic rebalancing when layers exceed allocation */
  enableDynamicRebalancing?: boolean;
}

export interface LayerBudget {
  name: string;
  priority: number;           // Higher = more protected from trimming
  minTokens: number;          // Minimum guaranteed allocation
  maxTokens: number;          // Maximum allocation (soft cap)
  allocatedTokens: number;    // Actual allocated tokens
  actualTokens: number;       // Measured actual usage
  content: string;            // The actual prompt content
  isRequired: boolean;        // Cannot be trimmed (base persona, etc.)
}

export interface ContextBudget {
  modelId: string;
  maxContextTokens: number;
  reservedOutputTokens: number;
  availableForPrompt: number;
  layers: LayerBudget[];
  totalAllocated: number;
  totalActual: number;
  utilizationPercent: number;
  isOverBudget: boolean;
  overflowTokens: number;
}

export interface BudgetAllocationResult {
  budget: ContextBudget;
  finalPrompt: string;
  trimmedLayers: string[];
  warnings: string[];
}

// ==========================================
// Default Layer Definitions (in priority order - highest first)
// ==========================================

const DEFAULT_LAYERS: Omit<LayerBudget, 'allocatedTokens' | 'actualTokens' | 'content'>[] = [
  {
    name: 'base_persona',
    priority: 100,
    minTokens: 150,
    maxTokens: 300,
    isRequired: true,
  },
  {
    name: 'identity_guard',
    priority: 95,
    minTokens: 50,
    maxTokens: 100,
    isRequired: true,
  },
  {
    name: 'formatting_rules',
    priority: 90,
    minTokens: 80,
    maxTokens: 150,
    isRequired: true,
  },
  {
    // Carries enrolled-course context AND attached thread-file text — on
    // million-token windows this can hold a large document, not just a summary.
    name: 'user_courses',
    priority: 70,
    minTokens: 0,
    maxTokens: 32_768,
    isRequired: false,
  },
  {
    name: 'tool_instructions',
    priority: 65,
    minTokens: 0,
    maxTokens: 2000,
    isRequired: false,
  },
  {
    name: 'rag_context',
    priority: 60,
    minTokens: 0,
    maxTokens: 4000,
    isRequired: false,
  },
  {
    name: 'memory_context',
    priority: 55,
    minTokens: 0,
    maxTokens: 1500,
    isRequired: false,
  },
  {
    name: 'multi_agent',
    priority: 50,
    minTokens: 0,
    maxTokens: 400,
    isRequired: false,
  },
];

// ==========================================
// Core Budget Calculator
// ==========================================

/**
 * Calculate context budget for a given model and prompt layers
 */
export function calculateContextBudget(
  config: ContextBudgetConfig,
  layerContents: Record<string, string>
): ContextBudget {
  const modelId = config.modelId as KnownModelId;
  const maxContextTokens = getModelContextWindow(modelId);
  // Reserve headroom for the response output, scaling with the window but
  // never exceeding the configured max output tokens (default 64k).
  const reservedOutputTokens =
    config.reservedOutputTokens ?? Math.min(MAX_OUTPUT_TOKENS, Math.floor(maxContextTokens * 0.1));
  const availableForPrompt = maxContextTokens - reservedOutputTokens;

  // Build layer budgets with actual content
  const layers: LayerBudget[] = DEFAULT_LAYERS.map((def) => {
    const content = layerContents[def.name] ?? '';
    const actualTokens = estimateTokens(content);
    return {
      ...def,
      allocatedTokens: 0,
      actualTokens,
      content,
    };
  });

  // Calculate required minimum for required layers
  const requiredMinTokens = layers
    .filter((l) => l.isRequired)
    .reduce((sum, l) => sum + l.minTokens, 0);

  // Available for optional layers after required minimums
  let remainingBudget = availableForPrompt - requiredMinTokens;

  // Allocate to required layers first (at their minimums)
  for (const layer of layers) {
    if (layer.isRequired) {
      layer.allocatedTokens = Math.min(layer.maxTokens, Math.max(layer.minTokens, layer.actualTokens));
      remainingBudget -= layer.allocatedTokens;
    }
  }

  // Allocate to optional layers by priority
  const optionalLayers = layers.filter((l) => !l.isRequired).sort((a, b) => b.priority - a.priority);

  for (const layer of optionalLayers) {
    if (remainingBudget <= 0) {
      layer.allocatedTokens = 0;
      continue;
    }

    // Allocate up to actual tokens or max, whichever is smaller, but not more than remaining
    const desiredAllocation = Math.min(layer.actualTokens, layer.maxTokens);
    layer.allocatedTokens = Math.min(desiredAllocation, Math.max(0, remainingBudget));
    remainingBudget -= layer.allocatedTokens;
  }

  // Dynamic rebalancing if enabled and over budget
  const totalAllocated = layers.reduce((sum, l) => sum + l.allocatedTokens, 0);
  const totalActual = layers.reduce((sum, l) => sum + l.actualTokens, 0);

  let finalLayers = layers;
  if (config.enableDynamicRebalancing !== false && totalAllocated > availableForPrompt) {
    finalLayers = rebalanceBudget(layers, availableForPrompt);
  }

  const finalTotalAllocated = finalLayers.reduce((sum, l) => sum + l.allocatedTokens, 0);
  const finalTotalActual = finalLayers.reduce((sum, l) => sum + l.actualTokens, 0);
  const utilizationPercent = Math.round((finalTotalActual / availableForPrompt) * 100);
  const isOverBudget = finalTotalActual > availableForPrompt;
  const overflowTokens = Math.max(0, finalTotalActual - availableForPrompt);

  return {
    modelId,
    maxContextTokens,
    reservedOutputTokens,
    availableForPrompt,
    layers: finalLayers,
    totalAllocated: finalTotalAllocated,
    totalActual: finalTotalActual,
    utilizationPercent,
    isOverBudget,
    overflowTokens,
  };
}

/**
 * Rebalance budget when over allocation - trim lowest priority layers first
 */
function rebalanceBudget(layers: LayerBudget[], availableForPrompt: number): LayerBudget[] {
  // Sort by priority (lowest first for trimming)
  const sorted = [...layers].sort((a, b) => a.priority - b.priority);
  let currentTotal = sorted.reduce((sum, l) => sum + l.allocatedTokens, 0);

  for (const layer of sorted) {
    if (currentTotal <= availableForPrompt) break;
    if (layer.isRequired) continue; // Never trim required layers

    const excess = currentTotal - availableForPrompt;
    const canTrim = layer.allocatedTokens - layer.minTokens;
    const trimAmount = Math.min(excess, canTrim);
    
    layer.allocatedTokens -= trimAmount;
    currentTotal -= trimAmount;
  }

  // Restore original order
  return layers.map((l) => {
    const rebalanced = sorted.find((s) => s.name === l.name);
    return rebalanced ? { ...l, allocatedTokens: rebalanced.allocatedTokens } : l;
  });
}

/**
 * Apply budget to generate final prompt with trimming
 */
export function applyBudget(budget: ContextBudget): BudgetAllocationResult {
  const trimmedLayers: string[] = [];
  const warnings: string[] = [];
  const finalParts: string[] = [];

  for (const layer of budget.layers) {
    if (layer.allocatedTokens === 0) {
      if (!layer.isRequired && layer.actualTokens > 0) {
        trimmedLayers.push(layer.name);
        warnings.push(`Layer "${layer.name}" trimmed entirely (${layer.actualTokens} tokens)`);
      }
      continue;
    }

    let content = layer.content;
    if (layer.actualTokens > layer.allocatedTokens) {
      content = trimContentToBudget(content, layer.allocatedTokens, layer.name);
      trimmedLayers.push(layer.name);
      warnings.push(`Layer "${layer.name}" trimmed from ${layer.actualTokens} to ${layer.allocatedTokens} tokens`);
    }

    finalParts.push(content);
  }

  const finalPrompt = finalParts.filter(Boolean).join('\n\n');

  // Final verification
  const finalTokens = estimateTokens(finalPrompt);
  if (finalTokens > budget.availableForPrompt) {
    warnings.push(`WARNING: Final prompt (${finalTokens} tokens) still exceeds budget (${budget.availableForPrompt})`);
  }

  log.info('Context budget applied', {
    modelId: budget.modelId,
    availableForPrompt: budget.availableForPrompt,
    finalTokens,
    utilization: budget.utilizationPercent,
    trimmedLayers: trimmedLayers.length,
    isOverBudget: budget.isOverBudget,
  });

  return {
    budget,
    finalPrompt,
    trimmedLayers,
    warnings,
  };
}

/**
 * Trim content to fit within token budget
 * Preserves structure - tries to keep complete sections
 */
function trimContentToBudget(content: string, maxTokens: number, layerName: string): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) return content;

  const ratio = maxTokens / currentTokens;
  const targetChars = Math.floor(content.length * ratio * 0.95); // 5% safety margin

  // Try to trim at natural boundaries
  const boundaries = [
    '\n\n## ',      // Markdown headers
    '\n\n### ',
    '\n\n- ',       // List items
    '\n\n',         // Paragraphs
    '. ',           // Sentences
    ' ',            // Words
  ];

  for (const boundary of boundaries) {
    const parts = content.split(boundary);
    if (parts.length > 1) {
      let result = parts[0];
      for (let i = 1; i < parts.length; i++) {
        const candidate = result + boundary + parts[i];
        if (estimateTokens(candidate) <= maxTokens) {
          result = candidate;
        } else {
          break;
        }
      }
      if (estimateTokens(result) <= maxTokens && result.length > targetChars * 0.5) {
        return result + (layerName === 'rag_context' ? '\n\n[...context trimmed due to budget...]' : '');
      }
    }
  }

  // Fallback: hard truncate at character level
  const truncated = content.substring(0, targetChars);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > targetChars * 0.8 ? truncated.substring(0, lastNewline) : truncated) 
    + '\n\n[...trimmed...]';
}

// ==========================================
// Prompt Layer Token Accounting
// ==========================================

export interface LayerTokenReport {
  layerName: string;
  tokens: number;
  chars: number;
  percentageOfBudget: number;
  isRequired: boolean;
  priority: number;
}

export interface PromptTokenAccounting {
  totalTokens: number;
  totalChars: number;
  layers: LayerTokenReport[];
  budget: ContextBudget;
  recommendations: string[];
}

/**
 * Generate detailed token accounting report for all prompt layers
 */
export function generateTokenAccounting(
  budget: ContextBudget,
  layerContents: Record<string, string>
): PromptTokenAccounting {
  const layers: LayerTokenReport[] = budget.layers.map((layer) => ({
    layerName: layer.name,
    tokens: layer.actualTokens,
    chars: layer.content.length,
    percentageOfBudget: budget.availableForPrompt > 0 
      ? Math.round((layer.actualTokens / budget.availableForPrompt) * 100) 
      : 0,
    isRequired: layer.isRequired,
    priority: layer.priority,
  }));

  const totalTokens = layers.reduce((sum, l) => sum + l.tokens, 0);
  const totalChars = layers.reduce((sum, l) => sum + l.chars, 0);

  const recommendations: string[] = [];
  
  // Check for layers consuming disproportionate budget
  for (const layer of layers) {
    if (layer.percentageOfBudget > 50 && !layer.isRequired) {
      recommendations.push(
        `Layer "${layer.layerName}" consumes ${layer.percentageOfBudget}% of prompt budget. ` +
        `Consider reducing content or increasing model context window.`
      );
    }
  }

  if (budget.isOverBudget) {
    recommendations.push(
      `Total prompt (${totalTokens} tokens) exceeds available budget (${budget.availableForPrompt}). ` +
      `Enable dynamic rebalancing or use a model with larger context window.`
    );
  }

  // Suggest model upgrade if utilization high
  if (budget.utilizationPercent > 85) {
    recommendations.push(
      `High budget utilization (${budget.utilizationPercent}%). ` +
      `Consider upgrading to a model with larger context window for better context retention.`
    );
  }

  return {
    totalTokens,
    totalChars,
    layers,
    budget,
    recommendations,
  };
}

/**
 * Quick utility to measure tokens for a single layer
 */
export function measureLayerTokens(layerName: string, content: string): LayerTokenReport {
  const def = DEFAULT_LAYERS.find((l) => l.name === layerName);
  return {
    layerName,
    tokens: estimateTokens(content),
    chars: content.length,
    percentageOfBudget: 0, // Will be calculated in context of full budget
    isRequired: def?.isRequired ?? false,
    priority: def?.priority ?? 0,
  };
}

export { DEFAULT_LAYERS };