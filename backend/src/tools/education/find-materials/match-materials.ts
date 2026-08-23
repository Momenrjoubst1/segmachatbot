/**
 * Pure matching/ranking logic for the material library search.
 * No database imports here — this module must stay trivially testable
 * (see src/__tests__/find-materials.test.ts).
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface MaterialMatch {
  id: string;
  fileName: string;
  courseName: string | null;
  status: string;
  totalPages: number | null;
  sizeBytes: number | null;
  createdAt: string | null;
  /** Raw storage reference kept internally for ranking/viewability checks. */
  fileUrl?: string;
}

export type MatchReason = "name_exact" | "name_prefix" | "name_contains" | "course_match";

export interface RankedMatch {
  match: MaterialMatch;
  score: number;
  reason: MatchReason;
}

// ── Arabic-aware normalization ──────────────────────────────────────────────

/**
 * Normalize Arabic/Latin text for fuzzy matching:
 * lowercase, strip diacritics/tatweel, unify alef/ya/teh-marbuta forms,
 * collapse whitespace, drop punctuation.
 */
export function normalizeMaterialText(input: string): string {
  if (!input) return "";
  let s = input.toLowerCase();
  // Strip Arabic diacritics + tatweel
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, "");
  // Unify alef variants → ا, ya/alef maqsura → ي, teh marbuta → ه
  s = s.replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه");
  // Drop characters that carry no matching signal (keep letters/digits/spaces)
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

function stripPdfSuffix(s: string): string {
  return s.replace(/\s*pdf\s*$/i, "").trim();
}

// ── Ranking ─────────────────────────────────────────────────────────────────

/**
 * Rank textbook rows against a query. Higher score = better. When `query`
 * is empty, rows keep recency order (rows arrive newest-first) with score 0.
 * Course-name matches rank below any direct name match. Completed books get
 * a small boost over in-flight duplicates of the same upload.
 */
export function rankMaterialMatches(
  rows: MaterialMatch[],
  query: string
): RankedMatch[] {
  const q = normalizeMaterialText(query);
  if (!q) return rows.map((match) => ({ match, score: 0, reason: "name_contains" as const }));

  const qNoExt = stripPdfSuffix(q) || q;
  const ranked: RankedMatch[] = [];

  for (const match of rows) {
    const name = normalizeMaterialText(match.fileName);
    const nameNoExt = stripPdfSuffix(name);
    const course = normalizeMaterialText(match.courseName || "");

    let score = -1;
    let reason: MatchReason = "name_contains";

    if (name === q || nameNoExt === qNoExt) {
      score = 100;
      reason = "name_exact";
    } else if (name.startsWith(q) || nameNoExt.startsWith(qNoExt)) {
      score = 80;
      reason = "name_prefix";
    } else if (name.includes(q) || (qNoExt.length >= 3 && name.includes(qNoExt))) {
      score = 60;
      reason = "name_contains";
    } else if (course && (course === q || course.includes(q) || q.includes(course))) {
      score = 40;
      reason = "course_match";
    }

    if (score > 0) {
      if (match.status === "completed") score += 5;
      ranked.push({ match, score, reason });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Dedupe near-identical rows (same normalized name), keeping the best-ranked. */
export function dedupeMaterialMatches(ranked: RankedMatch[]): RankedMatch[] {
  const seen = new Set<string>();
  const out: RankedMatch[] = [];
  for (const r of ranked) {
    const key = stripPdfSuffix(normalizeMaterialText(r.match.fileName));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
