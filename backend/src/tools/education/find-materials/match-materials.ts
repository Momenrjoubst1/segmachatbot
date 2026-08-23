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

// ── Explicit material-open request matching ─────────────────────────────────
// "افتح مادة الفيزياء" / "بدي الكيمياء pdf" / "open the physics book" —
// deterministic detection so the fast-pass can serve cards without waiting
// for the LLM. Deliberately NARROW: the WHOLE message must be a short
// imperative containing a material noun (or a trailing book/pdf suffix),
// otherwise it falls through to the normal pipeline so regular questions
// mentioning the word "مادة" are never hijacked. A phrasing match that finds
// no textbook also falls through, so over-broad captures stay harmless.

export interface MaterialOpenRequest {
  /** Search query; empty string = list recent materials. */
  query: string;
}

const OPEN_AR =
  "^(?:(?:افتحلي|افتح|اعرضلي|اعرض|وريني|ورني|هاات|هات|جيب(?:\\s+لي)?|بدي|بدّي|ابدّي|ابدي|أبغي|ابغي|أريد|اريد)(?:\\s+(?:لي|للي))?)";
const NOUN_AR = "(?:\\s+(?:ال)?(?:مادة|المادة|كتاب|الكتاب|ملف|الملف))";
const TITLE_AR = "([\\u0600-\\u06FF\\w][\\u0600-\\u06FF\\w\\s.-]{1,60})";

/** Verb → noun → title: «افتح مادة الفيزياء», «بدي كتاب الكيمياء». */
const MATERIAL_OPEN_AR = new RegExp(`${OPEN_AR}${NOUN_AR}\\s+(?:ال)?${TITLE_AR}$`);
/** Verb → title → trailing pdf: «افتح الفيزياء pdf». */
const MATERIAL_SUFFIX_AR = new RegExp(`${OPEN_AR}\\s+(?:ال)?([\\u0600-\\u06FF\\w][\\u0600-\\u06FF\\w\\s.-]{1,50}?)\\s+(?:pdf|PDF)$`);
/** Bare list-my-library requests. */
const MATERIAL_LIST_RE =
  /^(?:شو\s+موادي|موادي|وين\s+موادي|وريني\s+موادي|اعرض\s+موادي|قائمتي\s+المواد|show\s+my\s+materials|my\s+materials|list\s+my\s+materials)$/i;

const MATERIAL_OPEN_EN_NOUN_FIRST =
  /^(?:open|show(?:\s+me)?|get|bring)\s+(?:the\s+|my\s+)?(?:material|book|file|textbook)\s+([\w][\w\s.-]{1,60})$/i;
/** Natural English order: «open the physics book». */
const MATERIAL_OPEN_EN_SUFFIX =
  /^(?:open|show(?:\s+me)?|get|pull\s+up)\s+(?:the\s+|my\s+)?([\w][\w\s.'-]{1,48}?)\s+(?:book|textbook|material|pdf|file)$/i;

const MAX_FASTPASS_WORDS = 6;

/**
 * Match an explicit material-open request. Returns null unless the WHOLE
 * message is a short imperative — anything longer or more complex goes to
 * the LLM path (which can also emit material cards via find_materials).
 */
export function matchMaterialOpenRequest(rawText: string): MaterialOpenRequest | null {
  const text = rawText.trim().replace(/[.!؟?]+$/u, "").trim();
  if (!text || text.split(/\s+/).length > MAX_FASTPASS_WORDS) return null;

  if (MATERIAL_LIST_RE.test(text)) return { query: "" };

  const arNounFirst = text.match(MATERIAL_OPEN_AR);
  if (arNounFirst) return { query: arNounFirst[1].trim() };

  const enSuffix = text.match(MATERIAL_OPEN_EN_SUFFIX);
  if (enSuffix) return { query: enSuffix[1].trim() };

  const enNounFirst = text.match(MATERIAL_OPEN_EN_NOUN_FIRST);
  if (enNounFirst) return { query: enNounFirst[1].trim() };

  const arSuffix = text.match(MATERIAL_SUFFIX_AR);
  if (arSuffix) return { query: arSuffix[1].trim() };

  return null;
}
