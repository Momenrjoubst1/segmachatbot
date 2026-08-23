/**
 * Material library search used by the `find_materials` chat tool and the
 * material fast-pass. Ranking lives in the pure `match-materials.ts`;
 * only this module touches Supabase.
 */

import { supabase } from "../../../services/rag/rag-supabase-client.js";
import { createLogger } from "../../../utils/logger.js";
import {
  dedupeMaterialMatches,
  rankMaterialMatches,
  type MaterialMatch,
} from "./match-materials.js";

const log = createLogger("find-materials");

export type { MaterialMatch };

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

/** How many recent textbooks to pull before in-memory ranking. */
const RECENT_POOL_SIZE = 100;

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
