// Modular system prompt builder combining persona, tools, RAG, memory, and multi-agent layers.

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

// Trim the system prompt to a token budget via character approximation.
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

// Resolve a user's A/B test variant deterministically from their user ID.
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

// Build the persona matching the selected A/B test variant.
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

// Build the final system prompt from the enabled modular layers.
export function buildSystemPrompt(options: PromptBuildOptions): string {
  // Schema-driven system (2026-08-30): the system prompt is intentionally
  // empty. All model-facing knowledge lives in the tool schemas themselves
  // (see tools/tool-registry.ts usage notes + general discipline), the way
  // Claude/GPT/Gemini ship tool awareness.
  void options;
  return '';
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
