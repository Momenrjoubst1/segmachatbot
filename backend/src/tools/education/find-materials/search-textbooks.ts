/**
 * Material library search used by the `find_materials` chat tool and the
 * material fast-pass.
 *
 * The ranking/matching half is pure so it can be unit-tested without a
 * database; only `searchUserMaterials` touches Supabase.
 */

import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("find-materials");

export interface MaterialMatch {
  id: string;
  fileName: string;
  courseName: string | null;
  status: string;
  totalPages: number | null;
  sizeBytes: number | null;
  createdAt: string | null;
  /** Raw row kept internally for ranking; stripped before tool output. */
  fileUrl?: string;
}

interface TextbookRow {
  id: string;
  file_name: string;
  file_url: string | null;
  status: string | null;
  total_pages: number | null;
  file_size_bytes: number | null;
  course_id: string | null;
  created_at: string | null;
}

// ── Arabic-aware normalization (pure) ───────────────────────────────────────

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

// ── Ranking (pure) ──────────────────────────────────────────────────────────

export type MatchReason = "name_exact" | "name_prefix" | "name_contains" | "course_match";

export interface RankedMatch {
  match: MaterialMatch;
  score: number;
  reason: MatchReason;
}

/**
 * Rank textbook rows against a query. Higher score = better. When `query`
 * is empty, rows keep recency order (rows arrive newest-first) with score 0.
 * Course-name matches rank below any direct name match but above nothing.
 */
export function rankMaterialMatches(
  rows: MaterialMatch[],
  query: string
): RankedMatch[] {
  const q = normalizeMaterialText(query);
  if (!q) return rows.map((match) => ({ match, score: 0, reason: "name_contains" as const }));

  const ranked: RankedMatch[] = [];
  for (const match of rows) {
    const name = normalizeMaterialText(match.fileName);
    // Drop a trailing .pdf so "الرياضيات pdf" still matches name-exact
    const nameNoExt = name.replace(/\s*pdf\s*$/i, "").trim();
    const course = normalizeMaterialText(match.courseName || "");
    const qNoExt = q.replace(/\s*pdf\s*$/i, "").trim() || q;

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
      // Completed books outrank in-flight duplicates of the same book
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
    const key = normalizeMaterialText(r.match.fileName).replace(/\s*pdf\s*$/i, "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── DB access ───────────────────────────────────────────────────────────────

/** How many recent textbooks to pull before in-memory ranking. */
const RECENT_POOL_SIZE = 40;

/**
 * Fetch the user's textbooks (+ course names via a second query — avoids
 * relying on an FK join hint) and rank them against `query`.
 * Empty query returns the most recent materials.
 */
export async function searchUserMaterials(
  userId: string,
  query: string,
  limit = 5
): Promise<MaterialMatch[]> {
  const { data: textbooks, error } = await supabase
    .from("textbooks")
    .select("id, file_name, file_url, status, total_pages, file_size_bytes, course_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_POOL_SIZE);

  if (error) {
    log.error("Failed to load user textbooks", { userId, error: error.message });
    throw new Error(error.message);
  }
  const rows = (textbooks || []) as TextbookRow[];

  let courseNameById = new Map<string, string>();
  const { data: courses } = await supabase
    .from("student_courses")
    .select("id, course_name")
    .eq("user_id", userId);
  if (courses) {
    courseNameById = new Map(
      (courses as Array<{ id: string; course_name: string }>).map((c) => [c.id, c.course_name])
    );
  }

  const matches: MaterialMatch[] = rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    courseName: r.course_id ? courseNameById.get(r.course_id) || null : null,
    status: r.status || "unknown",
    totalPages: r.total_pages,
    sizeBytes: r.file_size_bytes,
    createdAt: r.created_at,
    fileUrl: r.file_url || "",
  }));

  const ranked = dedupeMaterialMatches(rankMaterialMatches(matches, query));
  return ranked.slice(0, limit).map((r) => r.match);
}
