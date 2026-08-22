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
import {
  calculateContextBudget,
  applyBudget,
  type BudgetAllocationResult,
} from '../services/memory/context-budget.js';

/** A/B Test variant for persona variations */
export type PersonaVariant = 'default' | 'concise' | 'detailed' | 'motivational';

/** A/B Test configuration */
export interface ABTestConfig {
  /** Variant to use (or 'auto' for random assignment) */
  variant?: PersonaVariant | 'auto';
  /** User ID for consistent assignment */
  userId?: string;
  /** Override random assignment with specific variant */
  forceVariant?: PersonaVariant;
}

export interface PromptBuildOptions {
  /** Student courses context string (pre-built from Redis cache) */
  userCoursesContext?: string;
  /** RAG context options — if absent, no RAG layer is added */
  ragContext?: {
    hasContext: boolean;
    contextText: string;
    sourceNames: string[];
    retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'structure_scope' | 'curriculum';
  };
  /** Memory context string (pre-built from unified memory) */
  memoryContext?: string;
  /** List of enabled tool names (from TOOL_DEFINITIONS keys) */
  enabledTools?: string[];
  /** Whether multi-agent mode is active */
  multiAgentMode?: boolean;
  /** Language preference */
  language?: 'ar' | 'en';
  /** Maximum tokens for the system prompt (approximate, 1 token ≈ 4 chars) */
  maxSystemTokens?: number;
  /** Model ID — enables model-aware context budgeting (from model-context registry) */
  modelId?: string;
  /** Tokens reserved for model output when model-aware budgeting is active */
  reservedOutputTokens?: number;
  /** A/B Test configuration for persona variations */
  abTest?: ABTestConfig;
}

/**
 * Trims the system prompt to fit within the token budget.
 * Uses a simple character-based approximation (1 token ≈ 4 chars).
 * Preserves layer order, truncating from the end (optional layers first).
 */
export function trimToTokenBudget(prompt: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (prompt.length <= maxChars) return prompt;

  // Split by layer boundaries (double newline)
  const layers = prompt.split('\n\n').filter(Boolean);
  let result = '';
  for (const layer of layers) {
    const candidate = result ? result + '\n\n' + layer : layer;
    if (candidate.length > maxChars) break;
    result = candidate;
  }
  return result || prompt.slice(0, maxChars);
}

/**
 * Resolves A/B test variant for a user.
 * Uses deterministic hashing for consistent assignment.
 */
function resolveABVariant(config: ABTestConfig): PersonaVariant {
  if (config.forceVariant) return config.forceVariant;
  if (config.variant && config.variant !== 'auto') return config.variant;
  if (!config.userId) return 'default';

  // Deterministic hash for consistent assignment
  let hash = 0;
  for (let i = 0; i < config.userId.length; i++) {
    hash = ((hash << 5) - hash) + config.userId.charCodeAt(i);
    hash |= 0;
  }
  const variants: PersonaVariant[] = ['default', 'concise', 'detailed', 'motivational'];
  return variants[Math.abs(hash) % variants.length];
}

/**
 * Builds persona with A/B test variant applied.
 */
function buildPersonaWithVariant(variant: PersonaVariant, language?: 'ar' | 'en'): string {
  switch (variant) {
    case 'concise':
      return buildConcisePersona(language);
    case 'detailed':
      return buildDetailedPersona(language);
    case 'motivational':
      return buildMotivationalPersona(language);
    default:
      return buildBasePersona({ language });
  }
}

/** Concise persona - shorter, more direct responses */
function buildConcisePersona(_language?: 'ar' | 'en'): string {
  return `# Identity — الهوية

You are 'Sigma,' the intelligent AI assistant and official study supporter on the Sigma AI Chatbot platform.
Your primary goal is to help students academically, socially, and organizationally.

# Roles — الأدوار

Adhere to the following roles in your responses:
- **Academic Advisor**: Help students understand complex material and summarize lectures. Be concise.
- **Challenge Maker**: Create mock exams at student request to train them. Focus on key concepts.
- **Personal Organizer**: Help students design effective schedules. Prioritize actionable steps.
- **Study Supporter**: Guide users on how to use Sigma AI and organize their learning. Keep it brief.
- **Psychological Motivator**: Maintain a positive, supportive tone. Encourage progress, not perfection.
- **Automated Interface**: Help users manage their time effectively. Give direct recommendations.

# Style — الأسلوب
- Keep responses under 200 words when possible.
- Use bullet points over paragraphs.
- Lead with the answer, then explain if needed.`;
}

/** Detailed persona - comprehensive, thorough responses */
function buildDetailedPersona(_language?: 'ar' | 'en'): string {
  return `# Identity — الهوية

You are 'Sigma,' the intelligent AI assistant and official study supporter on the Sigma AI Chatbot platform.
Your primary goal is to help students academically, socially, and organizationally.

# Roles — الأدوار

Adhere to the following roles in your responses:
- **Academic Advisor**: Help students understand complex material and summarize lectures. Provide depth, examples, and analogies.
- **Challenge Maker**: Create mock exams at student request to train them. Include explanations for each answer.
- **Personal Organizer**: Help students design effective schedules. Explain the reasoning behind each recommendation.
- **Study Supporter**: Guide users on how to use Sigma AI and organize their learning. Share study techniques.
- **Psychological Motivator**: Maintain a positive, supportive, and encouraging tone. Acknowledge effort and progress.
- **Automated Interface**: Help users manage their time effectively. Provide structured frameworks.

# Style — الأسلوب
- Provide thorough, well-structured responses.
- Include examples, analogies, and step-by-step breakdowns.
- Explain the 'why' behind recommendations.`;
}

/** Motivational persona - extra encouraging, growth-focused */
function buildMotivationalPersona(_language?: 'ar' | 'en'): string {
  return `# Identity — الهوية

You are 'Sigma,' the intelligent AI assistant and official study supporter on the Sigma AI Chatbot platform.
Your primary goal is to help students academically, socially, and organizationally — and to believe in them.

# Roles — الأدوار

Adhere to the following roles in your responses:
- **Academic Advisor**: Help students understand complex material. Frame challenges as growth opportunities.
- **Challenge Maker**: Create mock exams at student request. Celebrate effort regardless of score.
- **Personal Organizer**: Help students design effective schedules. Build in wins and recovery time.
- **Study Supporter**: Guide users on how to use Sigma AI. Emphasize progress over perfection.
- **Psychological Motivator**: **This is your primary mode.** Every response must include encouragement. Normalize struggle. Highlight strengths.
- **Automated Interface**: Help users manage their time effectively. Suggest sustainable habits, not cramming.

# Style — الأسلوب
- Start with validation: "Great question," "I see you're working hard on this."
- End with a forward-looking, encouraging statement.
- Use "you can," "you're capable," "this is learnable" language.
- Share relevant growth mindset framing.`;
}

/**
 * Builds the complete system prompt from modular layers.
 * Each layer is independent and can be toggled/customized.
 */
export function buildSystemPrompt(options: PromptBuildOptions): string {
  // Resolve A/B variant if configured
  const variant = options.abTest ? resolveABVariant(options.abTest) : 'default';
  const persona = buildPersonaWithVariant(variant, options.language);

  // Layer contents keyed by the context-budget layer registry
  const layerContents: Record<string, string> = {
    base_persona: persona,
    identity_guard: buildIdentityGuard(),
    formatting_rules: buildFormattingRules(),
    user_courses: options.userCoursesContext ?? '',
    tool_instructions:
      options.enabledTools && options.enabledTools.length > 0
        ? (buildToolInstructions(options.enabledTools) ?? '')
        : '',
    rag_context: options.ragContext ? buildRAGInstructions(options.ragContext) : '',
    memory_context: options.memoryContext ?? '',
    multi_agent: options.multiAgentMode ? buildMultiAgentInstructions() : '',
  };

  let prompt: string;
  let budgetResult: BudgetAllocationResult | undefined;

  if (options.modelId) {
    // Model-aware context budgeting: allocate tokens per layer based on the
    // model's real context window, trimming lowest-priority layers first.
    budgetResult = applyBudget(
      calculateContextBudget(
        {
          modelId: options.modelId,
          reservedOutputTokens: options.reservedOutputTokens,
        },
        layerContents,
      ),
    );
    prompt = budgetResult.finalPrompt;
  } else {
    // Legacy path: simple char-approximation trim
    prompt = Object.values(layerContents).filter(Boolean).join('\n\n');
    if (options.maxSystemTokens && options.maxSystemTokens > 0) {
      prompt = trimToTokenBudget(prompt, options.maxSystemTokens);
    }
  }

  if (budgetResult && budgetResult.trimmedLayers.length > 0) {
    console.warn('[prompt-budget] layers trimmed to fit context window', {
      modelId: options.modelId,
      trimmedLayers: budgetResult.trimmedLayers,
      warnings: budgetResult.warnings,
    });
  }

  return prompt;
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

// A/B Testing exports (functions only — types already exported above)
export { resolveABVariant, buildPersonaWithVariant };
