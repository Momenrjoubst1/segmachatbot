import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { createLogger } from "../../../utils/logger.js";
import { searchUserMaterials } from "./search-textbooks.js";
import { buildMaterialCardMarkdown } from "./material-card.js";

const log = createLogger("find-materials");

createToolMetadata("find_materials", "Find the student's uploaded study materials (textbook library)", {
  requiresUserId: true,
  category: "education",
  enabledByDefault: true,
});

// ============================================
// Tool: find_materials
// ============================================
registerTool("find_materials", {
  description:
    "Search the student's personal library of uploaded study materials (textbook PDFs) and their courses. " +
    "USE WHENEVER the user asks to see, open, get or show a material/book/subject/file they previously added " +
    "(e.g. \"show my physics material\", \"open the chemistry book\", \"show my math book\"), even casually inside another request. " +
    "Also use when the user refers to one of their materials by name and showing it would help. " +
    "Call with an empty query to list their most recent materials. " +
    "AFTER calling: copy each ready-made markdown card line from result.cards into your reply EXACTLY as given, " +
    "one per line — never modify the material:// URLs. Wrap them in one short friendly sentence. " +
    "If count is 0, say you couldn't find that material and suggest adding it via the sidebar upload or by attaching the PDF here.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Material, book, file or course name to search for (Arabic or English). Omit or pass empty string to list recent materials."
      ),
  }),
  execute: async (args: { query?: string; __userId?: string }) => {
    try {
      const userId = args.__userId;
      if (!userId) {
        return JSON.stringify({ status: "error", message: "User not authenticated" });
      }

      const matches = await searchUserMaterials(userId, args.query?.trim() || "");
      const cards = matches.map(buildMaterialCardMarkdown);

      return JSON.stringify({
        status: "ok",
        count: matches.length,
        cards,
        materials: matches.map((m) => ({
          id: m.id,
          fileName: m.fileName,
          courseName: m.courseName,
          status: m.status,
          totalPages: m.totalPages,
          sizeBytes: m.sizeBytes,
        })),
        instructions:
          "Include every entry of `cards` verbatim on its own line in your reply (they render as clickable material cards). " +
          "Never edit the URLs. If count is 0, tell the user briefly and suggest uploading the material.",
      });
    } catch (err: unknown) {
      log.error("find_materials error:", err instanceof Error ? err : new Error(String(err)));
      return JSON.stringify({
        status: "error",
        message: "Failed to search the material library",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
