import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { presignR2Get, extractR2KeyFromUrl, isR2Configured } from "./r2-client.js";
import { TEXTBOOK_CONFIG, RERANKER_CONFIG } from "../../config/constants.js";

const log = createLogger("textbook-search");

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 100;

class LRUCache<K, V> {
  private cache = new Map<K, { value: V; expiry: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, { value, expiry: Date.now() + this.ttl });
  }

  delete(key: K): void {
    this.cache.delete(key);
  }
}

const structureCache = new LRUCache<string, Array<{ id: string; level?: string; title?: string; page_start?: number; page_end?: number; textbook_id?: string; children?: unknown[] }>>(CACHE_MAX_SIZE, CACHE_TTL_MS);
const curriculumCache = new LRUCache<string, Array<{ id: string; level: string; title: string; page_start: number; page_end: number; textbook_id?: string }>>(CACHE_MAX_SIZE, CACHE_TTL_MS);

export function invalidateStructureCache(userId: string): void {
  structureCache.delete(`structure:${userId}`);
  curriculumCache.delete(`curriculum:${userId}`);
}

interface StructureNode {
  level: string;
  title: string;
  page_start: number;
  page_end: number;
  children?: StructureNode[];
}

interface MatchResult {
  matched: boolean;
  textbook_id: string;
  section_title: string;
  page_start: number;
  page_end: number;
  ambiguous: boolean;
  candidates?: string[];
}

function fuzzyMatch(query: string, title: string): number {
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
    const tree = textbook.structure_tree as StructureNode;
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

/**
 * Match the query against the inferred CURRICULUM map (textbook_sections:
 * units and lessons with exact page ranges). Preferred over the raw
 * structure tree — lesson boundaries come from merged evidence, not font
 * sizes alone.
 */
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
    })) as typeof sections;
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

  // ── Late-interaction: two-layer retrieval ────────────────────────────
  // Layer 1: match page summaries (high recall, coarse page selection)
  // Layer 2: hybrid search only within matched pages (precise chunks)
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
      // Page summaries table may not exist yet — fall back to unfiltered search
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

  // Cross-encoder reranking: re-score top candidates with a learned model
  // (Cohere rerank-multilingual-v3.0 or token-overlap fallback).  This
  // typically improves top-5 recall by 10-25% on educational QA benchmarks.
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

      // R2 figures: stored either as a bare object key ("textbooks/…") or as
      // a legacy public URL — always served via a short-lived presigned URL.
      const r2Key = imageUrl.startsWith("textbooks/")
        ? imageUrl
        : extractR2KeyFromUrl(imageUrl);
      if (r2Key && isR2Configured()) {
        const signedR2 = await presignR2Get(r2Key, 3600);
        if (signedR2) {
          return { ...fig, image_url: signedR2 };
        }
      }

      // Supabase storage figures: 1-hour signed URL (private bucket).
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

  return figuresWithSignedUrls;
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

  // Parallelise across textbooks — each search is independent and the RPC
  // returns empty results for textbooks with no chunks, so the per-book
  // "has chunks?" pre-check is unnecessary (saves N round-trips).
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

/**
 * Enrich retrieved chunks with hierarchical parent-context: section title,
 * preceding context paragraph, and figure captions from the same page.
 *
 * This gives the LLM the "frame, not just the fragment" — the section heading
 * and surrounding narrative that a human would see when reading the page.
 */
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

  // 1. Fetch section titles for unique structure_paths
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

  // 2. Fetch figures for unique pages
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

  // 3. Build enriched chunks with context headers
  for (const chunk of enriched) {
    const parts: string[] = [];

    // Section heading
    const sectionTitle = sectionTitles.get(chunk.structure_path);
    if (sectionTitle) {
      parts.push(`[Section: ${sectionTitle}]`);
    }

    // Figure captions from the same page (even if not explicitly referenced)
    const pageFigs = pageFigures.get(chunk.page_number);
    if (pageFigs && pageFigs.length > 0) {
      for (const fig of pageFigs.slice(0, 3)) { // cap at 3 figures per chunk
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
