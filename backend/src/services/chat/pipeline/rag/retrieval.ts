/**
 * Hybrid RAG Retrieval — vector + BM25 + textbook search.
 * استرجاع RAG الهجوني — المتجه + BM25 + البحث في الكتب
 *
 * Merges results from multiple sources and reranks them.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../../../../utils/logger.js";
import { ragCache } from "../../../rag/rag-cache.service.js";
import { RAG_CONFIG } from "../../../../config/constants.js";
import type { RankedDoc } from "../types.js";

const ragLog = createLogger("pipeline:rag-retrieval");

export interface RetrieveAndRankArgs {
  supabase: SupabaseClient;
  queryEmbedding: number[];
  searchQuery: string;
  matchThreshold: number;
  initialMatchCount: number;
  finalMatchCount: number;
  userId: string;
  pageStart?: number;
  pageEnd?: number;
}

/**
 * Retrieve documents from vector, BM25, and textbook sources, then rerank.
 */
export async function retrieveAndRank(args: RetrieveAndRankArgs): Promise<RankedDoc[] | null> {
  const { supabase, queryEmbedding, searchQuery, matchThreshold, initialMatchCount, finalMatchCount, userId, pageStart, pageEnd } = args;
  const { getBM25Search } = await import("../../../rag/bm25-search.js");
  const bm25 = await getBM25Search();

  const [vectorResult, bm25Results, textbookResults] = await Promise.all([
    Promise.resolve(
      supabase.rpc("match_documents", {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: initialMatchCount,
        p_user_id: userId,
      }),
    )
      .then((r: { data: unknown; error: { message: string } | null }) => ({
        data: r.data as Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number }> | null,
        error: r.error,
      }))
      .catch((e: Error) => ({ data: null, error: { message: e.message } })),
    Promise.resolve(
      bm25.getDocCount() > 0 ? bm25.search(searchQuery, initialMatchCount) : [],
    ).then((bm25Results) => {
      // Filter BM25 results by user_id to prevent cross-user document access
      return bm25Results.filter(({ doc }) => {
        const meta = doc.metadata || {};
        return meta.user_id === userId;
      });
    }),
    import("../../../textbook/textbook-search.js")
      .then((mod) =>
        mod.searchTextbooksForUser({
          userId,
          query: searchQuery,
          queryEmbedding,
          matchCount: initialMatchCount,
          pageStart,
          pageEnd,
        })
      )
      .catch((e: Error) => {
        ragLog.warn("Textbook search failed", { error: e.message });
        return [];
      }),
  ]);

  const merged: RankedDoc[] = [];
  const seen = new Set<string>();

  if (vectorResult.error) {
    ragLog.warn("Supabase RPC error", { error: vectorResult.error.message });
  } else if (vectorResult.data && vectorResult.data.length > 0) {
    for (const doc of vectorResult.data) {
      const hash = crypto.createHash('md5').update(doc.content).digest('hex').slice(0, 16);
      if (!seen.has(hash)) {
        seen.add(hash);
        merged.push({
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata || {},
          similarity: doc.similarity || 0,
          rerankScore: 0,
        });
      }
    }
  }

  for (const { doc: bm25Doc, score } of bm25Results) {
    const hash = crypto.createHash('md5').update(bm25Doc.content).digest('hex').slice(0, 16);
    if (!seen.has(hash)) {
      seen.add(hash);
      merged.push({
        id: bm25Doc.id,
        content: bm25Doc.content,
        metadata: bm25Doc.metadata || {},
        similarity: score,
        rerankScore: 0,
      });
    }
  }

  for (const textbookChunk of textbookResults) {
    const hash = crypto.createHash('md5').update(textbookChunk.content).digest('hex').slice(0, 16);
    if (!seen.has(hash)) {
      seen.add(hash);
      merged.push({
        id: `textbook-${textbookChunk.id}`,
        content: textbookChunk.content,
        metadata: {
          source: `Textbook: ${textbookChunk.file_name}`,
          textbook_id: textbookChunk.textbook_id,
          page_number: textbookChunk.page_number,
          structure_path: textbookChunk.structure_path,
        },
        similarity: textbookChunk.similarity,
        rerankScore: 0,
      });
    }
  }

  ragLog.info("Hybrid RAG results", {
    vector: vectorResult.data?.length || 0,
    bm25: bm25Results.length,
    textbook: textbookResults.length,
    merged: merged.length,
  });

  if (merged.length === 0) return null;

  const { rerankDocuments } = await import("../../../rag/document-reranker.js");
  const reranked = await rerankDocuments(searchQuery, merged, finalMatchCount);

  await ragCache.setResults(searchQuery, finalMatchCount, reranked, userId);
  return reranked;
}
