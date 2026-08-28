// Textbook search: chunk search, figure retrieval, context enrichment.

import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { presignR2Get, extractR2KeyFromUrl, isR2Configured } from "./r2-client.js";
import { TEXTBOOK_CONFIG, RERANKER_CONFIG } from "../../config/constants.js";

const log = createLogger("textbook-search");

export { invalidateStructureCache } from "./textbook-cache.js";
export type { MatchResult } from "./textbook-matching.js";
export { matchStructureTree, matchCurriculumSection, matchCurriculumSectionSemantic, fuzzyMatch } from "./textbook-matching.js";

export async function searchTextbookChunks(args: {
  userId: string;
  textbookId: string;
  query: string;
  queryEmbedding: number[];
  pageStart?: number;
  pageEnd?: number;
  matchCount?: number;
}): Promise<Array<{
  id: number;
  content: string;
  page_number: number;
  structure_path: string;
  figure_refs: string[];
  similarity: number;
}>> {
  const { userId, textbookId, query, queryEmbedding, pageStart, pageEnd, matchCount = 10 } = args;
  const matchThreshold = TEXTBOOK_CONFIG.MATCH_THRESHOLD;

  let effectivePageStart = pageStart;
  let effectivePageEnd = pageEnd;

  if (!pageStart && !pageEnd) {
    try {
      const { data: matchedPages } = await supabase.rpc(
        "match_textbook_page_summaries" as never,
        {
          query_embedding: queryEmbedding,
          p_textbook_id: textbookId,
          p_match_threshold: 0.3,
          p_match_count: 5,
        } as never
      );

      if (matchedPages && matchedPages.length > 0) {
        const pages = matchedPages.map((p: { page_number: number }) => p.page_number);
        effectivePageStart = Math.min(...pages);
        effectivePageEnd = Math.max(...pages);
        log.info("Page summary pre-filter applied", {
          textbookId,
          matchedPages: pages,
          range: [effectivePageStart, effectivePageEnd],
        });
      }
    } catch {
      // Page summaries table may not exist yet
    }
  }

  const { data: hybridData, error: hybridError } = await supabase.rpc(
    "hybrid_search_textbook_chunks",
    {
      query_embedding: queryEmbedding,
      query_text: query,
      p_textbook_id: textbookId,
      p_user_id: userId,
      p_match_threshold: matchThreshold,
      p_match_count: matchCount,
      p_page_start: effectivePageStart || null,
      p_page_end: effectivePageEnd || null,
    }
  );

  if (!hybridError && hybridData && hybridData.length > 0) {
    log.info("Hybrid search returned results", {
      textbookId,
      count: hybridData.length,
    });
    return hybridData.map((row: { id: string; content: string; page_number: number; structure_path: string; figure_refs?: unknown[]; final_score: number }) => ({
      id: row.id,
      content: row.content,
      page_number: row.page_number,
      structure_path: row.structure_path,
      figure_refs: row.figure_refs,
      similarity: row.final_score,
    }));
  }

  log.info("Falling back to vector-only search", {
    textbookId,
    hybridError: hybridError?.message,
  });

  const { data: vectorData, error: vectorError } = await supabase.rpc(
    "match_textbook_chunks",
    {
      query_embedding: queryEmbedding,
      p_textbook_id: textbookId,
      p_user_id: userId,
      p_match_threshold: matchThreshold,
      p_match_count: matchCount,
      p_page_start: pageStart || null,
      p_page_end: pageEnd || null,
    }
  );

  if (vectorError) {
    log.warn("Vector search also failed", { error: vectorError.message });
    return [];
  }

  let results = (vectorData as unknown[]) || [];

  if (RERANKER_CONFIG.ENABLE_TEXTBOOK_RERANK && results.length > 2) {
    try {
      const { rerankDocuments } = await import("../rag/document-reranker.js");
      const docsForRerank = (results as Array<{
        id: number; content: string; page_number: number;
        structure_path: string; figure_refs?: unknown[]; similarity: number;
      }>).map((r) => ({
        id: r.id,
        content: r.content,
        metadata: { page_number: r.page_number, structure_path: r.structure_path },
        similarity: r.similarity,
        rerankScore: 0,
      }));
      const reranked = await rerankDocuments(query, docsForRerank, matchCount);
      results = reranked.map((r) => ({
        id: r.id,
        content: r.content,
        page_number: (r.metadata as Record<string, unknown>)?.page_number as number,
        structure_path: (r.metadata as Record<string, unknown>)?.structure_path as string,
        figure_refs: [],
        similarity: r.rerankScore || r.similarity,
      }));
      log.info("Reranker applied to textbook chunks", { textbookId, count: reranked.length });
    } catch (rerankErr) {
      log.warn("Reranker failed, using original order", {
        error: (rerankErr as Error).message,
      });
    }
  }

  return results as Array<{
    id: number; content: string; page_number: number;
    structure_path: string; figure_refs: string[]; similarity: number;
  }>;
}

export async function getFiguresForChunks(
  textbookId: string,
  pageNumbers: number[]
): Promise<Array<{
  figure_id: string;
  page_number: number;
  caption: string;
  image_url: string;
  bounding_box: Record<string, number>;
}>> {
  if (pageNumbers.length === 0) return [];

  const { data, error } = await supabase
    .from("textbook_figures")
    .select("figure_id, page_number, caption, image_url, bounding_box")
    .eq("textbook_id", textbookId)
    .in("page_number", pageNumbers);

  if (error) {
    log.warn("Failed to fetch figures", { error: error.message });
    return [];
  }

  if (!data || data.length === 0) return [];

  const figuresWithSignedUrls = await Promise.all(
    data.map(async (fig: { image_url?: string; [key: string]: unknown }) => {
      const imageUrl: string = fig.image_url || "";

      const r2Key = imageUrl.startsWith("textbooks/")
        ? imageUrl
        : extractR2KeyFromUrl(imageUrl);
      if (r2Key && isR2Configured()) {
        const signedR2 = await presignR2Get(r2Key, 3600);
        if (signedR2) {
          return { ...fig, image_url: signedR2 };
        }
      }

      const storageMatch = imageUrl.match(/textbook-images\/(.+)$/);
      if (storageMatch) {
        const storagePath = decodeURIComponent(storageMatch[1]);
        const { data: signedData } = await supabase.storage
          .from("textbook-images")
          .createSignedUrl(storagePath, 3600);
        if (signedData?.signedUrl) {
          return { ...fig, image_url: signedData.signedUrl };
        }
      }
      return fig;
    })
  );

  return figuresWithSignedUrls as Array<{
  figure_id: string;
  page_number: number;
  caption: string;
  image_url: string;
  bounding_box: Record<string, number>;
}>;
}

export async function searchTextbooksForUser(args: {
  userId: string;
  query: string;
  queryEmbedding: number[];
  matchCount?: number;
  pageStart?: number;
  pageEnd?: number;
}): Promise<Array<{
  id: string;
  content: string;
  page_number: number;
  structure_path: string;
  textbook_id: string;
  file_name: string;
  similarity: number;
}>> {
  const { userId, query, queryEmbedding, matchCount = 10, pageStart, pageEnd } = args;

  const { data: textbooks, error: fetchError } = await supabase
    .from("textbooks")
    .select("id, file_name, file_hash")
    .eq("user_id", userId)
    .eq("status", "completed");

  if (fetchError || !textbooks || textbooks.length === 0) {
    log.info("No completed textbooks found for user", { userId });
    return [];
  }

  const allResults: Array<{
    id: string;
    content: string;
    page_number: number;
    structure_path: string;
    textbook_id: string;
    file_name: string;
    similarity: number;
  }> = [];

  const perBookLimit = Math.ceil(matchCount / textbooks.length);

  const bookResults = await Promise.allSettled(
    textbooks.map(async (textbook) => {
      const results = await searchTextbookChunks({
        userId,
        textbookId: textbook.id,
        query,
        queryEmbedding,
        matchCount: perBookLimit,
        pageStart,
        pageEnd,
      });
      return results.map((r) => ({
        ...r,
        id: String(r.id),
        textbook_id: textbook.id,
        file_name: textbook.file_name,
      }));
    })
  );

  for (const settlement of bookResults) {
    if (settlement.status === "fulfilled") {
      allResults.push(...settlement.value);
    } else {
      log.warn("Textbook search failed (parallel)", {
        error: settlement.reason instanceof Error ? settlement.reason.message : String(settlement.reason),
      });
    }
  }

  allResults.sort((a, b) => b.similarity - a.similarity);
  return allResults.slice(0, matchCount);
}

export async function enrichChunksWithContext(
  chunks: Array<{
    id: number; content: string; page_number: number;
    structure_path: string; figure_refs: string[]; similarity: number;
  }>,
  textbookId: string
): Promise<Array<{
  id: number; content: string; page_number: number;
  structure_path: string; figure_refs: string[]; similarity: number;
  context_header?: string;
}>> {
  if (chunks.length === 0) return [];

  type EnrichedChunk = typeof chunks[number] & { context_header?: string };
  const enriched: EnrichedChunk[] = chunks.map((c) => ({ ...c }));

  const uniquePaths = [...new Set(chunks.map((c) => c.structure_path).filter(Boolean))];
  const sectionTitles = new Map<string, string>();

  if (uniquePaths.length > 0) {
    const { data: sections } = await supabase
      .from("textbook_sections")
      .select("title, page_start, page_end")
      .eq("textbook_id", textbookId)
      .in("title", uniquePaths);

    if (sections) {
      for (const s of sections) {
        sectionTitles.set(s.title, s.title);
      }
    }
  }

  const uniquePages = [...new Set(chunks.map((c) => c.page_number))];
  const pageFigures = new Map<number, Array<{ figure_id: string; caption: string }>>();

  if (uniquePages.length > 0) {
    const { data: figures } = await supabase
      .from("textbook_figures")
      .select("figure_id, page_number, caption")
      .eq("textbook_id", textbookId)
      .in("page_number", uniquePages);

    if (figures) {
      for (const f of figures) {
        const list = pageFigures.get(f.page_number) || [];
        list.push({ figure_id: f.figure_id, caption: f.caption || "" });
        pageFigures.set(f.page_number, list);
      }
    }
  }

  for (const chunk of enriched) {
    const parts: string[] = [];

    const sectionTitle = sectionTitles.get(chunk.structure_path);
    if (sectionTitle) {
      parts.push(`[Section: ${sectionTitle}]`);
    }

    const pageFigs = pageFigures.get(chunk.page_number);
    if (pageFigs && pageFigs.length > 0) {
      for (const fig of pageFigs.slice(0, 3)) {
        if (fig.caption) {
          parts.push(`[Figure ${fig.figure_id}: ${fig.caption}]`);
        }
      }
    }

    if (parts.length > 0) {
      chunk.context_header = parts.join("\n");
    }
  }

  return enriched;
}
