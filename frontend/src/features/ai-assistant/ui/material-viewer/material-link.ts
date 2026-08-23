/**
 * Parsing/building for the `material://textbook/{id}?name=...&course=...`
 * markdown-link convention. Mirrors
 * backend/src/tools/education/find-materials/material-card.ts — the bot's
 * replies embed these links and this module turns them into viewer refs.
 *
 * Pure functions (no React, no network) so they are trivially testable.
 */

export const MATERIAL_LINK_PREFIX = "material://textbook/";

/** A reference to one of the user's uploaded study materials. */
export interface MaterialRef {
  /** textbook row id — the only required piece. */
  id: string;
  /** Display name (fallback until the viewer fetches authoritative data). */
  name?: string;
  course?: string;
  pages?: number;
  status?: string;
}

/**
 * Parse a markdown link href into a MaterialRef.
 * Returns null for anything that is not a well-formed material:// link.
 */
export function parseMaterialHref(href: string | undefined | null): MaterialRef | null {
  if (!href || typeof href !== "string") return null;
  if (!href.startsWith(MATERIAL_LINK_PREFIX)) return null;

  const rest = href.slice(MATERIAL_LINK_PREFIX.length);
  const qIndex = rest.indexOf("?");
  const rawId = qIndex === -1 ? rest : rest.slice(0, qIndex);

  let id = "";
  try {
    id = decodeURIComponent(rawId).trim();
  } catch {
    id = rawId.trim();
  }
  // Sanity check only — real authorization happens server-side. Reject
  // anything that smells like traversal rather than pinning an exact id
  // shape (uuid today, but don't break on other key types).
  const looksUnsafe =
    !id || id.length > 64 || id.includes("/") || id.includes("\\") || id.includes("..");
  if (looksUnsafe) return null;

  const ref: MaterialRef = { id };

  if (qIndex !== -1) {
    const params = new URLSearchParams(rest.slice(qIndex + 1));
    const name = params.get("name");
    const course = params.get("course");
    const pages = params.get("pages");
    const status = params.get("status");
    if (name) ref.name = name;
    if (course) ref.course = course;
    if (pages && Number.isFinite(Number(pages)) && Number(pages) > 0) {
      ref.pages = Math.floor(Number(pages));
    }
    if (status) ref.status = status;
  }

  return ref;
}

/**
 * True when a markdown <a> should render as an interactive material card.
 * Malformed material:// hrefs return false so they fall back to a plain
 * (harmless) link instead of a broken card.
 */
export function isMaterialHref(href: string | undefined | null): boolean {
  return parseMaterialHref(href) !== null;
}
