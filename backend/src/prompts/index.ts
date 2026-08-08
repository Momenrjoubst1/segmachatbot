/**
 * Prompt Architecture — بنية المطالبة
 *
 * Modular system prompt builder. Each layer is independent and can be
 * toggled or customized. The final system prompt is assembled from
 * these layers in a defined order:
 *
 *  1. Base Persona     — identity & roles
 *  2. Identity Guard   — prevents identity leakage
 *  3. Formatting Rules — Markdown & bilingual rules
 *  4. User Courses     — student course context (optional)
 *  5. Tool Instructions — only for enabled tools (optional)
 *  6. RAG Instructions  — retrieved context (optional)
 *  7. Memory Context    — conversation memory (optional)
 *  8. Multi-Agent       — main agent drafting mode (optional)
 *
 * Key improvement goals:
 * - Reduce total token usage by ~20% (remove redundant instructions)
 * - Tool instructions only included when relevant
 * - Easy to test individual layers
 * - Easy to A/B test different persona variations
 */

import { buildBasePersona } from './base-persona.js';
import { buildIdentityGuard } from './identity-guard.js';
import { buildFormattingRules } from './formatting-rules.js';
import { buildToolInstructions } from './tool-instructions.js';
import { buildRAGInstructions } from './rag-instructions.js';
import { buildMultiAgentInstructions } from './multi-agent.js';

export interface PromptBuildOptions {
  /** Student courses context string (pre-built from Redis cache) */
  userCoursesContext?: string;
  /** RAG context options — if absent, no RAG layer is added */
  ragContext?: {
    hasContext: boolean;
    contextText: string;
    sourceNames: string[];
    retrievalMethod: 'vector' | 'bm25' | 'hybrid';
  };
  /** Memory context string (pre-built from unified memory) */
  memoryContext?: string;
  /** List of enabled tool names (from TOOL_DEFINITIONS keys) */
  enabledTools?: string[];
  /** Whether multi-agent mode is active */
  multiAgentMode?: boolean;
  /** Language preference (for future A/B persona testing) */
  language?: 'ar' | 'en';
}

/**
 * Builds the complete system prompt from modular layers.
 * Each layer is independent and can be toggled/customized.
 */
export function buildSystemPrompt(options: PromptBuildOptions): string {
  const layers: string[] = [];

  // Layer 1: Base Persona (always present)
  layers.push(buildBasePersona({ language: options.language }));

  // Layer 2: Identity Guard (always present)
  layers.push(buildIdentityGuard());

  // Layer 3: Formatting Rules (always present)
  layers.push(buildFormattingRules());

  // Layer 4: User Courses Context (optional)
  if (options.userCoursesContext) {
    layers.push(options.userCoursesContext);
  }

  // Layer 5: Tool Instructions (only when tools are enabled)
  if (options.enabledTools && options.enabledTools.length > 0) {
    const toolInstructions = buildToolInstructions(options.enabledTools);
    if (toolInstructions) {
      layers.push(toolInstructions);
    }
  }

  // Layer 6: RAG Instructions (optional — when RAG is enabled)
  if (options.ragContext) {
    layers.push(buildRAGInstructions(options.ragContext));
  }

  // Layer 7: Memory Context (optional)
  if (options.memoryContext) {
    layers.push(options.memoryContext);
  }

  // Layer 8: Multi-Agent Instructions (optional)
  if (options.multiAgentMode) {
    layers.push(buildMultiAgentInstructions());
  }

  return layers.filter(Boolean).join('\n\n');
}

// Re-export individual builders for direct testing / composition
export { buildBasePersona } from './base-persona.js';
export { buildIdentityGuard } from './identity-guard.js';
export { buildFormattingRules } from './formatting-rules.js';
export { buildToolInstructions, resolveToolGroups, type ToolGroup } from './tool-instructions.js';
export { buildRAGInstructions, type RAGOptions } from './rag-instructions.js';
export {
  buildMultiAgentInstructions,
  buildCriticSystemPrompt,
  MAIN_AGENT_SYSTEM_PROMPT,
  CRITIC_AGENT_SYSTEM_PROMPT,
} from './multi-agent.js';