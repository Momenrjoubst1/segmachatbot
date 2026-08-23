/**
 * The `material://` card convention — the single contract between the
 * backend (tool results / fast-pass canned replies) and the frontend
 * markdown renderer.
 *
 * A material card is a markdown link whose href uses a synthetic scheme:
 *
 *   [📄 {fileName}](material://textbook/{id}?name=...&course=...&pages=...&status=...)
 *
 * react-markdown hands the href to our custom link renderer, which turns it
 * into an interactive card that opens the in-app MaterialViewerDialog.
 * Because it is plain markdown text, cards survive streaming, response
 * caching and persistence to chat_messages with zero extra plumbing.
 */

import type { MaterialMatch } from "./search-textbooks.js";

export const MATERIAL_LINK_PREFIX = "material://textbook/";

/**
 * Characters that would break the markdown link syntax if they appear in
 * the display text. They are stripped from generated snippets only; the
 * viewer always shows the authoritative file name fetched from the API.
 */
function sanitizeLinkText(text: string): string {
  return text.replace(/[[\]()<>]/g, "").trim();
}

export function buildMaterialHref(match: {
  id: string;
  fileName: string;
  courseName?: string | null;
  totalPages?: number | null;
  status?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("name", match.fileName);
  if (match.courseName) params.set("course", match.courseName);
  if (match.totalPages != null) params.set("pages", String(match.totalPages));
  if (match.status) params.set("status", match.status);
  return `${MATERIAL_LINK_PREFIX}${encodeURIComponent(match.id)}?${params.toString()}`;
}

/** Ready-to-emit markdown snippet the LLM copies verbatim into its reply. */
export function buildMaterialCardMarkdown(match: MaterialMatch): string {
  return `[📄 ${sanitizeLinkText(match.fileName)}](${buildMaterialHref(match)})`;
}
