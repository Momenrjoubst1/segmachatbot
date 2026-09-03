import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import {
  buildFontsCatalogPrompt,
  injectFontsIntoHtml,
  listFonts,
  resolveFontLinks,
} from "./library.js";

/**
 * apply_fonts — apply Google Fonts to an existing HTML/SVG/Markdown snippet
 *
 * The bot uses this when it already generated an artifact and wants to
 * retro-fit it with a specific font set, OR to inspect the available fonts.
 */
registerTool("apply_fonts", {
  description:
    "Apply Google Fonts to existing HTML/SVG/Markdown content, or list the fonts available in the font library. " +
    "Use when generating content that needs a specific font (Arabic, Latin, mono, decorative, handwriting). " +
    "The content is wrapped in a full HTML document with a Google Fonts <link> and a suitable font-family.",
  inputSchema: z.object({
    action: z.enum(["apply", "list", "resolve"]).describe(
      "Action: 'apply' to apply fonts to content, 'list' to show available fonts, 'resolve' to get CSS info for specific fonts.",
    ),
    fonts: z.array(z.string()).optional().describe(
      "Requested font names (e.g. ['Cairo', 'JetBrains Mono']). Aliases and partial names are accepted.",
    ),
    content: z.string().optional().describe(
      "HTML/SVG/Markdown content to apply fonts to (required when action='apply').",
    ),
    bodyFontFamily: z.string().optional().describe(
      "Optional CSS font-family value applied to body (used when it differs from the requested fonts).",
    ),
    category: z
      .enum(["arabic", "sans", "serif", "mono", "display", "handwriting", "all"])
      .optional()
      .describe("Filter by category when action='list'."),
    maxItems: z.number().int().min(1).max(200).optional().describe("Maximum number of items for action='list'."),
  }),
  execute: async (args: {
    action: "apply" | "list" | "resolve";
    fonts?: string[];
    content?: string;
    bodyFontFamily?: string;
    category?: "arabic" | "sans" | "serif" | "mono" | "display" | "handwriting" | "all";
    maxItems?: number;
    __userId?: string;
  }) => {
    try {
      const { action, fonts, content, bodyFontFamily, category, maxItems } = args;

      if (action === "list") {
        const { count, byCategory } = listFonts();
        if (category && category !== "all") {
          const items = byCategory[category] || [];
          return JSON.stringify({
            status: "success",
            count: items.length,
            category,
            fonts: items.slice(0, maxItems ?? 100),
            prompt: buildFontsCatalogPrompt(),
            message: `There are ${items.length} fonts in the '${category}' category.`,
          });
        }
        return JSON.stringify({
          status: "success",
          count,
          byCategory,
          prompt: buildFontsCatalogPrompt(),
          message: `${count} fonts available in total across ${Object.keys(byCategory).length} categories.`,
        });
      }

      if (action === "resolve") {
        if (!fonts || fonts.length === 0) {
          return JSON.stringify({ status: "error", message: "fonts is required when action='resolve'." });
        }
        const resolved = resolveFontLinks(fonts);
        return JSON.stringify({
          status: "success",
          requested: fonts,
          names: resolved.names,
          missing: resolved.missing,
          categories: resolved.categories,
          linkHref: resolved.linkHref,
          familyStack: resolved.familyStack,
          usage: {
            htmlLink: `<link rel="stylesheet" href="${resolved.linkHref}">`,
            cssFamily: `font-family: ${resolved.familyStack};`,
            tailwindFamily: `font-['${resolved.names.join("','")}']`,
          },
          message:
            resolved.missing.length > 0
              ? `Resolved ${resolved.names.length} fonts. Not found: ${resolved.missing.join(", ")}.`
              : `Successfully resolved ${resolved.names.length} fonts.`,
        });
      }

      // action === "apply"
      if (!fonts || fonts.length === 0) {
        return JSON.stringify({ status: "error", message: "fonts is required when action='apply'." });
      }
      if (!content) {
        return JSON.stringify({ status: "error", message: "content is required when action='apply'." });
      }

      const resolved = resolveFontLinks(fonts);
      if (!resolved.linkHref) {
        return JSON.stringify({
          status: "error",
          message: "None of the provided font names could be found.",
          missing: resolved.missing,
        });
      }

      const finalHtml = injectFontsIntoHtml(content, resolved.names, bodyFontFamily);

      return JSON.stringify({
        status: "success",
        applied: resolved.names,
        missing: resolved.missing,
        linkHref: resolved.linkHref,
        familyStack: resolved.familyStack,
        html: finalHtml,
        message:
          resolved.missing.length > 0
            ? `Applied ${resolved.names.length} fonts. Warning: ${resolved.missing.join(", ")} not found.`
            : `Successfully applied ${resolved.names.length} fonts.`,
      });
    } catch (err: unknown) {
      return JSON.stringify({ status: "error", message: "Font application failed", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
