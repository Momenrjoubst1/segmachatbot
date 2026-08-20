/**
 * Step 6b — System Prompt Assembly
 *
 * Combines the base persona, RAG context, memory context, user courses
 * context, formatting rules, and tool instructions into the final
 * system prompt.
 */

import { buildBasePersona } from "../../../prompts/base-persona.js";
import { buildSystemPrompt, type PromptBuildOptions } from "../../../prompts/index.js";
import { UI_ACTION_SYSTEM_PROMPT } from "../ui-action-emitter.js";
import { isWebSearchAvailable } from "../../../tools/web/search/index.js";
import { isEmailAvailable } from "../../../tools/email/send/index.js";
import { getToolDefinitions } from "../../../tools/tool-definitions-aggregator.js";
import type { RagContextData } from "./types.js";

export interface AssemblePromptResult {
  systemPrompt: string;
  basePersona: string;
}

export function assembleSystemPrompt(args: {
  ragContext: RagContextData | undefined;
  userCoursesContext: string;
  memoryPrompt: string;
}): AssemblePromptResult {
  const basePersona = buildBasePersona();

  const enabledTools = Object.keys(getToolDefinitions()).filter((name) => {
    if (name === "web_search" && !isWebSearchAvailable()) return false;
    if (name === "send_email" && !isEmailAvailable()) return false;
    return true;
  });

  const promptOptions: PromptBuildOptions = {
    userCoursesContext: args.userCoursesContext || undefined,
    ragContext: args.ragContext,
    memoryContext: args.memoryPrompt || undefined,
    enabledTools,
    language: "ar",
  };

  let systemPrompt = buildSystemPrompt(promptOptions);

  if (process.env.OCTOPUS_UI_ACTIONS === "true") {
    systemPrompt += "\n\n" + UI_ACTION_SYSTEM_PROMPT;
  }

  return { systemPrompt, basePersona };
}
