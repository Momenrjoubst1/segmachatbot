// Assembles the final system prompt from persona, RAG, memory, courses, and tools.

import { buildBasePersona } from "../../../prompts/base-persona.js";
import { buildSystemPrompt, resolveABVariant, buildPersonaWithVariant, type PromptBuildOptions, type PersonaVariant } from "../../../prompts/index.js";
import { UI_ACTION_SYSTEM_PROMPT } from "../ui-action-emitter.js";
import { isWebSearchAvailable } from "../../../tools/web/search/index.js";
import { isEmailAvailable } from "../../../tools/email/send/index.js";
import { getToolDefinitions } from "../../../tools/tool-definitions-aggregator.js";
import { PROMPT_CONFIG } from "../../../config/constants.js";
import { createLogger } from "../../../utils/logger.js";
import { recordPromptMetrics } from "../../metrics/prompt-metrics.js";
import type { RagContextData } from "./types.js";

const log = createLogger('system-prompt');

export interface AssemblePromptResult {
  systemPrompt: string;
  basePersona: string;
  /** Resolved A/B variant for this request */
  promptVariant: PersonaVariant;
  /** System prompt length in chars */
  promptLength: number;
  /** Estimated tokens (≈ chars/4) */
  promptTokensEstimate: number;
  /** Build time in ms */
  buildTimeMs: number;
}

export function assembleSystemPrompt(args: {
  ragContext: RagContextData | undefined;
  userCoursesContext: string;
  memoryPrompt: string;
  /** User ID for deterministic A/B assignment */
  userId?: string;
  /** Selected model ID — enables model-aware context budgeting */
  selectedModel?: string;
  /** Force a specific variant (overrides env + auto) — for testing */
  forceVariant?: PersonaVariant;
  /** Override max tokens for this request */
  maxSystemTokens?: number;
}): AssemblePromptResult {
  const t0 = Date.now();

  const enabledTools = Object.keys(getToolDefinitions()).filter((name) => {
    if (name === "web_search" && !isWebSearchAvailable()) return false;
    if (name === "send_email" && !isEmailAvailable()) return false;
    return true;
  });

  // Resolve A/B variant: forceVariant > env force > env variant > auto > default
  let abVariant: PersonaVariant = 'default';
  let abConfig: PromptBuildOptions['abTest'] | undefined;

  if (PROMPT_CONFIG.AB_ENABLED || args.forceVariant || args.userId) {
    const variantFromEnv = PROMPT_CONFIG.AB_FORCE_VARIANT ?? (PROMPT_CONFIG.AB_VARIANT !== 'auto' ? PROMPT_CONFIG.AB_VARIANT as PersonaVariant : undefined);

    if (args.forceVariant) {
      abVariant = args.forceVariant;
      abConfig = { forceVariant: args.forceVariant };
    } else if (variantFromEnv) {
      abVariant = variantFromEnv;
      abConfig = { forceVariant: variantFromEnv };
    } else if (PROMPT_CONFIG.AB_ENABLED && args.userId) {
      abVariant = resolveABVariant({ userId: args.userId, variant: 'auto' });
      abConfig = { userId: args.userId, variant: 'auto' };
    }
  }

  // Base persona must match the variant used in the system prompt
  const basePersona = abConfig ? buildPersonaWithVariant(abVariant) : buildBasePersona();

  const promptOptions: PromptBuildOptions = {
    userCoursesContext: args.userCoursesContext || undefined,
    ragContext: args.ragContext,
    memoryContext: args.memoryPrompt || undefined,
    enabledTools,
    language: "ar",
    maxSystemTokens: args.maxSystemTokens ?? PROMPT_CONFIG.MAX_SYSTEM_TOKENS,
    modelId: args.selectedModel,
    abTest: abConfig,
  };

  let systemPrompt = buildSystemPrompt(promptOptions);

  if (process.env.OCTOPUS_UI_ACTIONS === "true") {
    systemPrompt += "\n\n" + UI_ACTION_SYSTEM_PROMPT;
  }

  const buildTimeMs = Date.now() - t0;
  const promptLength = systemPrompt.length;
  const promptTokensEstimate = Math.ceil(promptLength / 4);

  log.info('prompt assembled', {
    variant: abVariant,
    promptLength,
    promptTokensEstimate,
    buildTimeMs,
    hasRag: !!args.ragContext?.hasContext,
    hasMemory: !!args.memoryPrompt,
    hasCourses: !!args.userCoursesContext,
    toolCount: enabledTools.length,
  });

  if (args.userId) {
    recordPromptMetrics({
      variant: abVariant,
      promptLength,
      promptTokensEstimate,
      buildTimeMs,
      userId: args.userId,
      hasRag: !!args.ragContext?.hasContext,
      hasMemory: !!args.memoryPrompt,
      hasCourses: !!args.userCoursesContext,
      toolCount: enabledTools.length,
      multiAgent: false,
    });
  }

  return { systemPrompt, basePersona, promptVariant: abVariant, promptLength, promptTokensEstimate, buildTimeMs };
}
