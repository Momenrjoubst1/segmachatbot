import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";

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

const structureCache = new LRUCache<string, any[]>(CACHE_MAX_SIZE, CACHE_TTL_MS);

export function invalidateStructureCache(userId: string): void {
  structureCache.delete(`structure:${userId}`);
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
  figure_refs: any[];
  similarity: number;
}>> {
  const { textbookId, query, queryEmbedding, pageStart, pageEnd, matchCount = 10 } = args;
  const matchThreshold = parseFloat(process.env.TEXTBOOK_MATCH_THRESHOLD || "0.4");

  const { data: hybridData, error: hybridError } = await supabase.rpc(
    "hybrid_search_textbook_chunks",
    {
      query_embedding: queryEmbedding,
      query_text: query,
      p_textbook_id: textbookId,
      p_match_threshold: matchThreshold,
      p_match_count: matchCount,
      p_page_start: pageStart || null,
      p_page_end: pageEnd || null,
    }
  );

  if (!hybridError && hybridData && hybridData.length > 0) {
    log.info("Hybrid search returned results", {
      textbookId,
      count: hybridData.length,
    });
    return hybridData.map((row: any) => ({
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

  return (vectorData as any[]) || [];
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
    data.map(async (fig: any) => {
      const imageUrl: string = fig.image_url || "";
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
}): Promise<Array<{
  id: string;
  content: string;
  page_number: number;
  structure_path: string;
  textbook_id: string;
  file_name: string;
  similarity: number;
}>> {
  const { userId, query, queryEmbedding, matchCount = 10 } = args;

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

  for (const textbook of textbooks) {
    try {
      // Check if this textbook has chunks
      const { data: chunkCheck } = await supabase
        .from("textbook_chunks")
        .select("id", { count: "exact", head: true })
        .eq("textbook_id", textbook.id);

      let searchId = textbook.id;
      
      // If no chunks, find the canonical textbook with same hash
      if (!chunkCheck || chunkCheck.length === 0) {
        const { data: canonical } = await supabase
          .from("textbooks")
          .select("id")
          .eq("file_hash", textbook.file_hash)
          .eq("status", "completed")
          .neq("id", textbook.id)
          .limit(1)
          .maybeSingle();
        
        if (canonical) {
          searchId = canonical.id;
          log.info("Using canonical textbook for dedup", {
            userId,
            dedupedId: textbook.id,
            canonicalId: searchId,
          });
        }
      }

      const results = await searchTextbookChunks({
        userId,
        textbookId: searchId,
        query,
        queryEmbedding,
        matchCount: Math.ceil(matchCount / textbooks.length),
      });

      for (const result of results) {
        allResults.push({
          ...result,
          textbook_id: textbook.id,
          file_name: textbook.file_name,
        });
      }
    } catch (err) {
      log.warn("Textbook search failed", {
        textbookId: textbook.id,
        error: (err as Error).message,
      });
    }
  }

  allResults.sort((a, b) => b.similarity - a.similarity);
  return allResults.slice(0, matchCount);
}
