import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { createToolMetadata } from "../../tool-metadata.js";
import { createArtifact } from "./artifact-store.js";
import { injectFontsIntoHtml, resolveFontLinks } from "../../utils/fonts/library.js";

// Both registries are required: tool-registry powers the LLM schema,
// tool-metadata drives userId injection and startup validation.
registerTool("create_artifact", {
  description:
    "Create interactive content in the side panel (Artifact). Use for web pages, charts, interactive code, tables, " +
    "mind maps, quizzes, educational content, or an integrated development environment (IDE). The content appears in a separate panel beside the chat. " +
    "Supports passing `fonts` to inject Google Fonts (Arabic/Latin/mono/decorative/handwriting) into HTML and React. " +
    "When using type='ide', a complete development environment is created with a code editor, file tree, and terminal. " +
    "To modify an existing artifact, use update_artifact instead of recreating it.",
  inputSchema: z.object({
    type: z.enum(["html", "svg", "mermaid", "markdown", "code", "chart", "quiz", "react", "ide"]).describe("Content type: html, svg, mermaid, markdown, code, chart, quiz, react, ide"),
    title: z.string().describe("Title of the artifact"),
    content: z.string().describe("Artifact content (HTML, SVG, Mermaid, Markdown, code, JSON for charts/quizzes/ide)"),
    language: z.string().optional().describe("Code language if type is 'code' (e.g. python, javascript, typescript, java)"),
    projectFiles: z.array(z.object({
      name: z.string(),
      type: z.enum(["file", "folder"]),
      content: z.string().optional(),
      path: z.string(),
      children: z.any().optional(),
    })).optional().describe("Project files for the IDE (required when type='ide')"),
    fonts: z.array(z.string()).optional().describe(
      "Optional: Google Fonts names to apply on HTML/React (e.g. ['Cairo', 'JetBrains Mono']). Aliases are accepted. Google Fonts are automatically injected into <head>.",
    ),
    bodyFontFamily: z.string().optional().describe(
      "Optional: CSS font-family value applied to body when no explicit fonts are present.",
    ),
  }),
  execute: async (args: {
    type: string;
    title: string;
    content: string;
    language?: string;
    fonts?: string[];
    bodyFontFamily?: string;
    projectFiles?: Array<{ name: string; path: string; content?: string } | Record<string, unknown>>;
    __userId?: string;
    __threadId?: string | null;
  }) => {
    const { type, title, content, language, fonts, bodyFontFamily, projectFiles, __userId, __threadId } = args;
    try {
      if (!__userId) {
        return JSON.stringify({ status: "error", message: "Cannot create an artifact without a registered user." });
      }

      let finalContent = content;
      let appliedFonts: string[] = [];
      let missingFonts: string[] = [];
      let linkHref = '';

      // Handle IDE type with project files
      if (type === "ide" && projectFiles) {
        finalContent = JSON.stringify({
          projectName: title,
          files: projectFiles,
        });
      }

      // Auto-inject Google Fonts for HTML/React artifacts when fonts are requested
      if (fonts && fonts.length > 0 && (type === "html" || type === "react")) {
        const resolved = resolveFontLinks(fonts);
        appliedFonts = resolved.names;
        missingFonts = resolved.missing;
        linkHref = resolved.linkHref;
        if (linkHref) {
          finalContent = injectFontsIntoHtml(content, resolved.names, bodyFontFamily);
        }
      }

      const artifact = await createArtifact({
        ownerId: __userId,
        threadId: __threadId ?? null,
        type,
        title,
        content: finalContent,
        language,
        author: "assistant",
      });

      return JSON.stringify({
        status: "success",
        artifact_id: artifact.id,
        version: artifact.version,
        type: artifact.type,
        title: artifact.title,
        applied_fonts: appliedFonts,
        missing_fonts: missingFonts,
        fonts_link: linkHref || undefined,
        message:
          missingFonts.length > 0
            ? `Successfully created "${title}" and saved it permanently. Warning: unknown fonts: ${missingFonts.join(", ")}.`
            : appliedFonts.length > 0
              ? `Created "${title}" with fonts: ${appliedFonts.join(", ")}.`
              : `Successfully created "${title}" and saved it permanently.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (/exceeds/i.test(message)) {
        return JSON.stringify({ status: "error", message: `Artifact creation failed: ${message}. Split or shorten the content.` });
      }
      return JSON.stringify({ status: "error", message: "Artifact creation failed", error: message });
    }
  },
});

createToolMetadata(
  "create_artifact",
  "Create interactive side-panel content (web pages, charts, diagrams, quizzes, IDEs) persisted to the user's library",
  { requiresUserId: true, category: "files", enabledByDefault: true },
);
