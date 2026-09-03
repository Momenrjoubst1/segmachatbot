import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { updateArtifact, getArtifact } from "../create-artifact/artifact-store.js";

/**
 * Apply sequential find/replace edits against the current content.
 * Exported pure so the tool logic is unit-testable without a DB.
 *
 * Every `find` must exist exactly once unless `replace_all` is set —
 * ambiguity silently corrupting unrelated sections is worse than failing.
 */
export function applyReplacements(
  content: string,
  edits: Array<{ find: string; replace: string; replace_all?: boolean; occurrence?: number }>,
): { content: string; applied: number } {
  let result = content;
  let applied = 0;

  for (const edit of edits) {
    const occurrences = result.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `The text to replace was not found: "${truncate(edit.find, 80)}". Read the current artifact (route GET /api/artifacts/:id or ask the user to show the code) and try again with exactly matching text.`,
      );
    }
    if (edit.replace_all || edit.occurrence === undefined) {
      result = edit.replace_all
        ? result.split(edit.find).join(edit.replace)
        : result.replace(edit.find, edit.replace);
    } else {
      const idx = indexOfOccurrence(result, edit.find, edit.occurrence);
      if (idx === -1) {
        throw new Error(`Occurrence number ${edit.occurrence} does not exist for the text: "${truncate(edit.find, 80)}".`);
      }
      result = result.slice(0, idx) + edit.replace + result.slice(idx + edit.find.length);
    }
    applied++;
  }

  return { content: result, applied };
}

function indexOfOccurrence(haystack: string, needle: string, occurrence: number): number {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

registerTool("update_artifact", {
  description:
    "Edit an existing artifact instead of recreating it — previous versions are preserved and every edit is recorded as a new version. " +
    "Pass `content` to replace the entire content, or `find_replace` for precise localized edits (preferred for long files), " +
    "or `title` to rename only. You can combine them in a single call.",
  inputSchema: z.object({
    artifact_id: z.string().describe("ID of the artifact to edit (from the create_artifact result)"),
    title: z.string().optional().describe("Optional new title"),
    content: z.string().optional().describe("Full new content (replaces the old content)"),
    find_replace: z.array(z.object({
      find: z.string().describe("Existing text to match exactly (including whitespace and lines)"),
      replace: z.string().describe("Replacement text"),
      replace_all: z.boolean().optional().describe("Replace all occurrences (by default only the first occurrence is replaced)"),
      occurrence: z.number().int().positive().optional().describe("Number of the occurrence to replace (1-based)"),
    })).optional().describe("Sequential localized edits applied to the current content"),
    change_summary: z.string().optional().describe("Short description of the change shown in the version history"),
  }),
  execute: async (args: {
    artifact_id: string;
    title?: string;
    content?: string;
    find_replace?: Array<{ find: string; replace: string; replace_all?: boolean; occurrence?: number }>;
    change_summary?: string;
    __userId?: string;
  }) => {
    const { artifact_id, title, content, find_replace, change_summary, __userId } = args;
    try {
      if (!__userId) {
        return JSON.stringify({ status: "error", message: "Cannot edit an artifact without a registered user." });
      }
      if (!title && !content && (!find_replace || find_replace.length === 0)) {
        return JSON.stringify({
          status: "error",
          message: "No changes provided. Pass at least one of content, find_replace, or title.",
        });
      }

      const current = await getArtifact(artifact_id, __userId);
      if (!current) {
        return JSON.stringify({ status: "error", message: `Artifact ${artifact_id} does not exist or is not accessible.` });
      }

      // Composition order: full replacement first, then targeted edits run
      // on top of the NEW content — so "rewrite it and fix these strings"
      // works as one intuitive call.
      let baseContent = current.content;
      if (content !== undefined) {
        baseContent = content;
      }
      let finalContent = baseContent;
      let replacementsApplied = 0;
      if (find_replace && find_replace.length > 0) {
        const result = applyReplacements(baseContent, find_replace);
        finalContent = result.content;
        replacementsApplied = result.applied;
      }

      const updated = await updateArtifact(artifact_id, __userId, {
        ...(title !== undefined ? { title } : {}),
        content: finalContent,
        changeSummary: change_summary ?? (replacementsApplied > 0 ? `${replacementsApplied} targeted edit(s)` : undefined),
        author: "assistant",
      });

      return JSON.stringify({
        status: "success",
        artifact_id: updated.id,
        version: updated.version,
        previous_version: current.version,
        title: updated.title,
        replacements_applied: replacementsApplied,
        message: `Updated "${updated.title}" — version ${updated.version}.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({
        status: "error",
        message: err instanceof Error ? err.message : "Artifact update failed",
      });
    }
  },
});

createToolMetadata(
  "update_artifact",
  "Edit an existing artifact with full-content or targeted find/replace changes; every save creates a restorable version",
  { requiresUserId: true, category: "files", enabledByDefault: true },
);
