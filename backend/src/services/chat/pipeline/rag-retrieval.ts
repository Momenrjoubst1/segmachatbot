/**
 * Step 5 — RAG Retrieval Pipeline
 *
 * Hybrid retrieval (vector + BM25) with:
 *  - query rewriting via intent
 *  - embedding-cache lookup
 *  - semantic response cache lookup
 *  - merged + re-ranked top-k results
 *  - clean source-name extraction
 *
 * Returns the assembled `RagContextData` and the ranked docs (kept for
 * the post-stream grounding check).
 */

import crypto from "crypto";
import { Response } from "express";
import { createLogger } from "../../../utils/logger.js";
const ragLog = createLogger("pipeline:rag-retrieval");
import { ragCache } from "../../rag/rag-cache.service.js";
import { rewriteQuery } from "../query-rewriter.js";
import { responseCache, type CacheMetadata } from "../response-cache.service.js";
import { triggerChatTitlingAsync } from "../../chat-title-generator.service.js";
import { UserIntent, type IntentResult } from "../intent-detector.js";
import type { CoreMessage, RagContextData, RankedDoc } from "./types.js";
import type { IntentResult as IntentResultType } from "../intent-detector.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_INTENT: IntentResultType = {
  intent: UserIntent.KNOWLEDGE_QUERY,
  confidence: 0.5,
  needsRAG: true,
  needsTools: false,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RagStepResult {
  ragContext: RagContextData | undefined;
  rankedDocs: RankedDoc[];
  cacheMetadata: CacheMetadata | undefined;
  ragSuccess: boolean;
  ragSources: string[];
  /** True when the response cache returned a hit that we should stream. */
  responseCacheHit: {
    response: string;
    threadId: string | undefined;
  } | null;
}

export async function runRagPipeline(args: {
  coreMessages: CoreMessage[];
  lastUserText: string;
  userId: string;
  selectedModel: string;
  intentResult: IntentResult | null;
  userCoursesContext: string;
  ragEnabled: boolean;
  threadId: string | undefined;
  res: Response;
}): Promise<RagStepResult> {
  const {
    coreMessages,
    lastUserText,
    userId,
    selectedModel,
    intentResult,
    userCoursesContext,
    ragEnabled,
    threadId,
    res,
  } = args;

  const empty: RagStepResult = {
    ragContext: undefined,
    rankedDocs: [],
    cacheMetadata: undefined,
    ragSuccess: false,
    ragSources: [],
    responseCacheHit: null,
  };

  if (!ragEnabled) {
    ragLog.info("RAG disabled by user toggle. Using base persona.");
    return empty;
  }
  if (intentResult && !intentResult.needsRAG) {
    ragLog.info(
      `RAG skipped by intent detection (intent=${intentResult.intent}, confidence=${intentResult.confidence})`,
    );
    return empty;
  }

  try {
    const { generateEmbedding } = await import("../../rag/embedding-service.js");
    const { supabase } = await import("../../rag/rag-supabase-client.js");

    // 1. Rewrite query (intent-aware)
    const rewritten = rewriteQuery(
      lastUserText,
      coreMessages,
      intentResult ?? DEFAULT_INTENT,
    );
    const searchQuery = rewritten.rewritten;
    ragLog.info("Query rewritten", {
      strategy: rewritten.strategy,
      originalLen: rewritten.original.length,
      rewrittenLen: rewritten.rewritten.length,
    });

    // 2. Embedding (with cache)
    let queryEmbedding = await ragCache.getEmbedding(searchQuery);
    if (queryEmbedding) {
      ragLog.info("Embedding cache HIT", { query: searchQuery.substring(0, 50) });
    } else {
      ragLog.info("Generating embedding for query (cache miss)", {
        queryLength: searchQuery.length,
      });
      queryEmbedding = await generateEmbedding(searchQuery);
      if (queryEmbedding) {
        await ragCache.setEmbedding(searchQuery, queryEmbedding);
      }
    }

    if (!queryEmbedding) {
      ragLog.info("Embedding returned null. Trying BM25 fallback");
      return runBM25Fallback(searchQuery);
    }

    ragLog.info("Embedding generated. Searching vector DB", {
      dims: queryEmbedding.length,
    });

    // 3. Semantic response cache check
    const bypass = responseCache.shouldBypassCache({
      hasPersonalContext: !!userCoursesContext,
      hasToolRequest: intentResult?.needsTools ?? false,
      isFollowUp: intentResult?.intent === UserIntent.FOLLOW_UP,
      ragEnabled,
    });

    if (!bypass) {
      const cacheResult = await responseCache.checkCache(queryEmbedding, searchQuery);
      if (cacheResult.hit && cacheResult.cachedResponse) {
        ragLog.info("Response cache HIT â€” skipping LLM", {
          query: searchQuery.substring(0, 50),
          similarity: cacheResult.similarity?.toFixed(3),
        });
        const hit = await persistCacheHit({
          supabase,
          userId,
          threadId,
          coreMessages,
          cachedResponse: cacheResult.cachedResponse,
          res,
        });
        return { ...empty, responseCacheHit: { response: cacheResult.cachedResponse, threadId: hit.threadId } };
      }
    } else {
      ragLog.info("Response cache bypassed", { reason: bypass.reason });
    }

    const cacheMetadata: CacheMetadata = {
      queryText: searchQuery,
      queryEmbedding,
      model: selectedModel,
      ragSources: [],
      bypassed: !!bypass,
    };

    // 4. Hybrid retrieval
    const matchThreshold = parseFloat(process.env.RAG_MATCH_THRESHOLD || "0.5");
    const initialMatchCount = parseInt(process.env.RAG_INITIAL_MATCH_COUNT || "15", 10);
    const finalMatchCount = parseInt(process.env.RAG_MATCH_COUNT || "5", 10);

    let rankedDocs = await ragCache.getResults(searchQuery, finalMatchCount);
    if (rankedDocs) {
      ragLog.info("RAG results cache HIT", {
        query: searchQuery.substring(0, 50),
        docs: rankedDocs.length,
      });
    } else {
      rankedDocs = await retrieveAndRank({
        supabase,
        queryEmbedding,
        searchQuery,
        matchThreshold,
        initialMatchCount,
        finalMatchCount,
      });
    }

    if (!rankedDocs || rankedDocs.length === 0) {
      ragLog.info("No relevant documents found in vector DB");
      return {
        ...empty,
        cacheMetadata,
      };
    }

    // 5. Build context block
    const sourceNames = uniqueSourceNames(rankedDocs);
    const contextText = rankedDocs
      .map((d, i) =>
        `[Source ${i + 1}: ${cleanSourceName(typeof d.metadata?.source === 'string' ? d.metadata.source : typeof d.metadata?.source_url === 'string' ? d.metadata.source_url : typeof d.metadata?.file_name === 'string' ? d.metadata.file_name : undefined)}]\n${d.content}`,
      )
      .join("\n\n");

    return {
      ragContext: {
        hasContext: true,
        contextText,
        sourceNames,
        retrievalMethod: 'hybrid',
      },
      rankedDocs,
      cacheMetadata: { ...cacheMetadata, ragSources: sourceNames },
      ragSuccess: true,
      ragSources: sourceNames,
      responseCacheHit: null,
    };
  } catch (ragError) {
    ragLog.warn("Retrieval failed, falling back to standard chat", {
      error: (ragError as Error)?.message,
    });
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function retrieveAndRank(args: {
  supabase: SupabaseClient;
  queryEmbedding: number[];
  searchQuery: string;
  matchThreshold: number;
  initialMatchCount: number;
  finalMatchCount: number;
}): Promise<RankedDoc[] | null> {
  const { supabase, queryEmbedding, searchQuery, matchThreshold, initialMatchCount, finalMatchCount } = args;
  const { getBM25Search } = await import("../../rag/bm25-search.js");
  const bm25 = getBM25Search();

  const [vectorResult, bm25Results] = await Promise.all([
    Promise.resolve(
      supabase.rpc("match_documents", {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: initialMatchCount,
      }),
    )
      .then((r: { data: unknown; error: { message: string } | null }) => ({
        data: r.data as Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number }> | null,
        error: r.error,
      }))
      .catch((e: Error) => ({ data: null, error: { message: e.message } })),
    Promise.resolve(
      bm25.getDocCount() > 0 ? bm25.search(searchQuery, initialMatchCount) : [],
    ),
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

  ragLog.info("Hybrid RAG results", {
    vector: vectorResult.data?.length || 0,
    bm25: bm25Results.length,
    merged: merged.length,
  });

  if (merged.length === 0) return null;

  const { rerankDocuments } = await import("../../rag/document-reranker.js");
  const reranked = await rerankDocuments(searchQuery, merged, finalMatchCount);

  await ragCache.setResults(searchQuery, finalMatchCount, reranked);
  return reranked;
}

async function runBM25Fallback(searchQuery: string): Promise<RagStepResult> {
  try {
    const { getBM25Search } = await import("../../rag/bm25-search.js");
    const bm25 = getBM25Search();
    if (bm25.getDocCount() === 0) {
      ragLog.info("BM25 index empty. No documents ingested yet.");
      return {
        ragContext: undefined,
        rankedDocs: [],
        cacheMetadata: undefined,
        ragSuccess: false,
        ragSources: [],
        responseCacheHit: null,
      };
    }
    const results = bm25.search(searchQuery, 5);
    if (results.length === 0) {
      return {
        ragContext: undefined,
        rankedDocs: [],
        cacheMetadata: undefined,
        ragSuccess: false,
        ragSources: [],
        responseCacheHit: null,
      };
    }
    const sourceNames = [...new Set(results.map((r) => r.doc.metadata?.source || "Document"))];
    const contextText = results
      .map((r, i) => `[Source ${i + 1}: ${r.doc.metadata?.source || "Document"}]\n${r.doc.content}`)
      .join("\n\n");
    ragLog.info("BM25 fallback succeeded", { count: results.length });
    return {
      ragContext: { hasContext: true, contextText, sourceNames, retrievalMethod: 'bm25' },
      rankedDocs: [],
      cacheMetadata: undefined,
      ragSuccess: true,
      ragSources: sourceNames,
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
      responseCacheHit: null,
    };
  }
}

function uniqueSourceNames(docs: RankedDoc[]): string[] {
  return [...new Set(
    docs.map((d) => cleanSourceName(d.metadata?.source || d.metadata?.source_url || d.metadata?.file_name)),
  )];
}

function cleanSourceName(source: string | undefined): string {
  if (!source) return "Unknown Document";
  return source
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]/g, " ")
    .trim();
}

interface PersistCacheHitArgs {
  supabase: SupabaseClient;
  userId: string;
  threadId: string | undefined;
  coreMessages: CoreMessage[];
  cachedResponse: string;
  res: Response;
}

async function persistCacheHit(args: PersistCacheHitArgs): Promise<{ threadId: string | undefined }> {
  const { supabase, userId, threadId, coreMessages, cachedResponse, res } = args;
  let activeThreadId = threadId;

  if (!activeThreadId) {
    const { data: existingSession } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSession) {
      activeThreadId = existingSession.id;
      res.setHeader("X-Thread-Id", existingSession.id);
    } else {
      const { data: newSession, error: sessionErr } = await supabase
        .from("chat_sessions")
        .insert([{ title: "New Chat", user_id: userId }])
        .select()
        .single();
      if (newSession && !sessionErr) {
        activeThreadId = newSession.id;
        res.setHeader("X-Thread-Id", newSession.id);
      }
    }
  } else {
    res.setHeader("X-Thread-Id", activeThreadId);
  }

  if (activeThreadId) {
    const lastUser = [...coreMessages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      await supabase.from("chat_messages").insert([{
        session_id: activeThreadId,
        role: "user",
        content: typeof lastUser.content === "string"
          ? lastUser.content
          : JSON.stringify(lastUser.content),
      }]);
    }
    await supabase.from("chat_messages").insert([{
      session_id: activeThreadId,
      role: "assistant",
      content: cachedResponse,
    }]);
    triggerChatTitlingAsync(activeThreadId);
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Cache-Hit", "true");
  res.write(cachedResponse);
  res.end();

  return { threadId: activeThreadId };
}
