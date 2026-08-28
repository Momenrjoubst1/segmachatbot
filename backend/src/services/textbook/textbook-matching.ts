// Textbook matching: structure tree and curriculum matching.

import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { structureCache, curriculumCache, sectionEmbeddingCache } from "./textbook-cache.js";

const log = createLogger("textbook-matching");

export interface StructureNode {
  level: string;
  title: string;
  page_start: number;
  page_end: number;
  children?: StructureNode[];
}

export interface MatchResult {
  matched: boolean;
  textbook_id: string;
  section_title: string;
  page_start: number;
  page_end: number;
  ambiguous: boolean;
  candidates?: string[];
}

export function fuzzyMatch(query: string, title: string): number {
  const q = query.toLowerCase().trim();
  const t = title.toLowerCase().trim();

  if (t.includes(q) || q.includes(t)) return 1.0;

  const qWords = q.split(/\s+/);
  const tWords = t.split(/\s+/);
  let matches = 0;
  for (const qw of qWords) {
    for (const tw of tWords) {
      if (tw.includes(qw) || qw.includes(tw)) {
        matches++;
        break;
      }
    }
  }
  return qWords.length > 0 ? matches / qWords.length : 0;
}

function matchTreeRecursive(
  node: StructureNode,
  query: string,
  textbookId: string
): Array<{ score: number; section: MatchResult }> {
  const results: Array<{ score: number; section: MatchResult }> = [];

  if (node.level !== "root" && node.level !== "content") {
    const score = fuzzyMatch(query, node.title);
    results.push({
      score,
      section: {
        matched: true,
        textbook_id: textbookId,
        section_title: node.title,
        page_start: node.page_start,
        page_end: node.page_end,
        ambiguous: false,
      },
    });
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...matchTreeRecursive(child, query, textbookId));
    }
  }

  return results;
}

export async function matchStructureTree(
  userId: string,
  question: string
): Promise<MatchResult | null> {
  const cacheKey = `structure:${userId}`;
  const cached = structureCache.get(cacheKey);

  let textbooks;
  if (cached) {
    textbooks = cached;
  } else {
    const { data } = await supabase
      .from("textbooks")
      .select("id, structure_tree")
      .eq("user_id", userId)
      .eq("status", "completed");
    textbooks = data || [];
    structureCache.set(cacheKey, textbooks);
  }

  if (!textbooks || textbooks.length === 0) return null;

  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const textbook of textbooks) {
    const tree = (textbook as unknown as { structure_tree?: StructureNode }).structure_tree;
    if (!tree || !tree.children) continue;

    const matches = matchTreeRecursive(tree, question, textbook.id);

    for (const { score, section } of matches) {
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ...section };
      } else if (score === bestScore && score > 0.3 && bestMatch) {
        if (!bestMatch.candidates) {
          bestMatch.candidates = [bestMatch.section_title];
        }
        bestMatch.candidates.push(section.section_title);
        bestMatch.ambiguous = true;
      }
    }
  }

  if (bestScore < 0.3) {
    return {
      matched: false,
      textbook_id: "",
      section_title: "",
      page_start: 0,
      page_end: 0,
      ambiguous: false,
    };
  }

  return bestMatch;
}

export async function matchCurriculumSection(
  userId: string,
  question: string
): Promise<MatchResult | null> {
  const cacheKey = `curriculum:${userId}`;
  let sections = curriculumCache.get(cacheKey);

  if (!sections) {
    const { data } = await supabase
      .from("textbook_sections")
      .select(
        `id, level, title, page_start, page_end, textbooks!inner (id, user_id, status)`
      )
      .eq("level", "lesson")
      .eq("textbooks.user_id", userId)
      .eq("textbooks.status", "completed")
      .order("order_index");
    sections = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      level: row.level as string,
      title: row.title as string,
      page_start: row.page_start as number,
      page_end: row.page_end as number,
      textbook_id: (row.textbooks as { id?: string })?.id || "",
    })) as NonNullable<typeof sections>;
    curriculumCache.set(cacheKey, sections as NonNullable<typeof sections>);
  }

  if (!sections || sections.length === 0) return null;

  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const section of sections) {
    const score = fuzzyMatch(question, section.title);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        matched: true,
        textbook_id: section.textbook_id || "",
        section_title: section.title,
        page_start: section.page_start,
        page_end: section.page_end,
        ambiguous: false,
      };
    } else if (score === bestScore && score > 0.3 && bestMatch) {
      if (!bestMatch.candidates) {
        bestMatch.candidates = [bestMatch.section_title];
      }
      bestMatch.candidates.push(section.title);
      bestMatch.ambiguous = true;
    }
  }

  if (bestScore < 0.3) {
    return {
      matched: false,
      textbook_id: "",
      section_title: "",
      page_start: 0,
      page_end: 0,
      ambiguous: false,
    };
  }

  return bestMatch;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export async function matchCurriculumSectionSemantic(
  userId: string,
  question: string,
  queryEmbedding: number[]
): Promise<MatchResult | null> {
  const cacheKey = `curriculum:${userId}`;
  let sections = curriculumCache.get(cacheKey);

  if (!sections) {
    const { data } = await supabase
      .from("textbook_sections")
      .select(
        `id, level, title, page_start, page_end, textbooks!inner (id, user_id, status)`
      )
      .eq("level", "lesson")
      .eq("textbooks.user_id", userId)
      .eq("textbooks.status", "completed")
      .order("order_index");
    sections = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      level: row.level as string,
      title: row.title as string,
      page_start: row.page_start as number,
      page_end: row.page_end as number,
      textbook_id: (row.textbooks as { id?: string })?.id || "",
    })) as NonNullable<typeof sections>;
    curriculumCache.set(cacheKey, sections as NonNullable<typeof sections>);
  }

  if (!sections || sections.length === 0) return null;

  const embCacheKey = `embeddings:${userId}`;
  let titleEmbeddings = sectionEmbeddingCache.get(embCacheKey);
  if (!titleEmbeddings) {
    try {
      const { generateEmbeddings } = await import("../rag/embedding-service.js");
      const titles = sections.map((s) => s.title);
      const embeddings = await generateEmbeddings(titles);
      if (embeddings && embeddings.length === titles.length) {
        const map = new Map<string, number[]>();
        sections.forEach((s, i) => map.set(s.id, embeddings[i]));
        titleEmbeddings = map;
        sectionEmbeddingCache.set(embCacheKey, map);
      }
    } catch (err) {
      log.warn("Semantic matching: embedding generation failed, falling back to fuzzy", {
        error: (err as Error).message,
      });
    }
  }

  let bestMatch: MatchResult | null = null;
  let bestScore = 0;

  for (const section of sections) {
    const fuzzyScore = fuzzyMatch(question, section.title);
    let semanticScore = 0;
    if (titleEmbeddings) {
      const emb = titleEmbeddings.get(section.id);
      if (emb) semanticScore = Math.max(0, cosineSimilarity(queryEmbedding, emb));
    }
    const score = 0.4 * fuzzyScore + 0.6 * semanticScore;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        matched: true,
        textbook_id: section.textbook_id || "",
        section_title: section.title,
        page_start: section.page_start,
        page_end: section.page_end,
        ambiguous: false,
      };
    } else if (score === bestScore && score > 0.3 && bestMatch) {
      if (!bestMatch.candidates) {
        bestMatch.candidates = [bestMatch.section_title];
      }
      bestMatch.candidates.push(section.title);
      bestMatch.ambiguous = true;
    }
  }

  if (bestScore < 0.3) {
    return {
      matched: false,
      textbook_id: "",
      section_title: "",
      page_start: 0,
      page_end: 0,
      ambiguous: false,
    };
  }

  return bestMatch;
}
