/**
 * Tool Router — builds the enabled tools map for the response generator.
 * محوّل الأدوات — يبني خريطة الأدوات المفعّلة لمولّد الردود
 *
 * Filters tools by intent to prevent token overflows.
 */

import type { Response } from "express";
import { getToolDefinitions } from "../../../tools/tool-definitions-aggregator.js";
import { isWebSearchAvailable } from "../../../tools/web/search/index.js";
import { isEmailAvailable } from "../../../tools/email/send/index.js";
import type { ToolDefinition } from "../../../tools/shared/types.js";
import { getToolsRequiringUserId } from "../../../tools/tool-metadata.js";
import { injectUIActionToStream, panelOpenArtifacts } from "../ui-action-emitter.js";

/**
 * Builds the `enabledTools` map for the response generator.
 * Filtered by intent to prevent token overflows.
 */
export function buildEnabledTools(
  userId: string,
  intent?: string,
  hasTextbookChunks?: boolean,
  streamHooks?: { res?: Response; activeThreadId?: string | null },
  webSearchEnabled = true,
): Record<string, ToolDefinition> {
  const TOOLS_NEEDING_USER_ID: ReadonlySet<string> = new Set(getToolsRequiringUserId());

  // For small talk or knowledge queries without specific tool needs, send NO tools to save tokens
  if (intent === "small_talk") {
    return {};
  }

  // If no specific intent detected, send a minimal tool set to stay under TPM limits
  const isSpecificIntent = intent && intent !== "small_talk" && intent !== "general";

  const enabled: Record<string, ToolDefinition> = {};
  for (const [name, def] of Object.entries(getToolDefinitions()) as Array<[string, ToolDefinition]>) {
    if (name === "web_search" && (!isWebSearchAvailable() || !webSearchEnabled)) continue;
    if (name === "send_email" && !isEmailAvailable()) continue;

    // Artifact tools survive the general-intent filter so page requests still work
    const ARTIFACT_TOOLS = new Set(["create_artifact", "update_artifact"]);

    // For general queries, only send essential tools to reduce token usage
    if (!isSpecificIntent) {
      const ESSENTIAL_TOOLS = new Set(["get_time", "get_weather", "calculator", "web_search"]);
      // Education tools always pass when textbook chunks are present
      const EDUCATION_TOOLS = new Set(["record_quiz_result", "generate_flashcards", "generate_quiz"]);
      if (!ESSENTIAL_TOOLS.has(name) && !ARTIFACT_TOOLS.has(name) && !(hasTextbookChunks && EDUCATION_TOOLS.has(name))) continue;
    }

    if (TOOLS_NEEDING_USER_ID.has(name)) {
      // Per-request dedupe for the auto-open action below.
      const openedArtifactIds = new Set<string>();
      enabled[name] = {
        ...def,
        execute: async (args: Record<string, unknown>) => {
          const result = await def.execute({
            ...args,
            __userId: userId,
            __threadId: streamHooks?.activeThreadId ?? null,
          });
          // When a tool yields an artifact mid-stream, pop its panel open once
          if (streamHooks?.res && typeof result === "string") {
            try {
              const parsed = JSON.parse(result) as { status?: string; artifact_id?: string };
              if (
                parsed?.status === "success" &&
                parsed.artifact_id &&
                !openedArtifactIds.has(parsed.artifact_id)
              ) {
                openedArtifactIds.add(parsed.artifact_id);
                injectUIActionToStream(streamHooks.res, panelOpenArtifacts(parsed.artifact_id));
              }
            } catch {
              // non-JSON tool results have no artifacts to focus
            }
          }
          return result;
        },
      };
    } else {
      enabled[name] = def;
    }
  }
  return enabled;
}
