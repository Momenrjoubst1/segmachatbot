/**
 * BM25 Fallback — when embedding fails, use BM25 as fallback.
 * بديل BM25 — عندما يفشل التضمين، استخدم BM كبديل
 */

import { createLogger } from "../../../../utils/logger.js";
import type { RagStepResult } from "../rag-retrieval.js";

const ragLog = createLogger("pipeline:rag-retrieval");

/**
 * Run BM25-only search when embedding generation fails.
 */
export async function runBM25Fallback(
  searchQuery: string,
  userId: string,
): Promise<RagStepResult> {
  try {
    const { getBM25Search } = await import("../../../rag/bm25-search.js");
    const bm25 = await getBM25Search();
    if (bm25.getDocCount() === 0) {
      ragLog.info("BM25 index is empty. Skipping fallback.");
      return {
        ragContext: undefined,
        rankedDocs: [],
        cacheMetadata: undefined,
        ragSuccess: false,
        ragSources: [],
        hasTextbookChunks: false,
        responseCacheHit: null,
      };
    }
    const results = bm25.search(searchQuery, 10)
      .filter(({ doc }) => (doc.metadata?.user_id === userId));
    if (results.length === 0) {
      return {
        ragContext: undefined,
        rankedDocs: [],
        cacheMetadata: undefined,
        ragSuccess: false,
        ragSources: [],
        hasTextbookChunks: false,
        responseCacheHit: null,
      };
    }
    const context = results
      .map((r, i) => `[Source ${i + 1} - ${r.doc.metadata?.source || "Knowledge Base"}]:\n${r.doc.content}`)
      .join("\n\n");
    const sourceNames = results.map((r) => String(r.doc.metadata?.source || "Knowledge Base"));
    return {
      ragContext: {
        hasContext: true,
        contextText: context,
        sourceNames,
        retrievalMethod: 'bm25',
      },
      rankedDocs: results.map((r) => ({
        id: String(r.doc.id),
        content: r.doc.content,
        metadata: r.doc.metadata || {},
        similarity: r.score,
        rerankScore: r.score,
      })),
      cacheMetadata: undefined,
      ragSuccess: true,
      ragSources: sourceNames,
      hasTextbookChunks: false,
      responseCacheHit: null,
    };
  } catch (err) {
    ragLog.warn("BM25 fallback failed", { error: (err as Error)?.message });
    return {
      ragContext: undefined,
      rankedDocs: [],
      cacheMetadata: undefined,
      ragSuccess: false,
      ragSources: [],
      hasTextbookChunks: false,
      responseCacheHit: null,
    };
  }
}
