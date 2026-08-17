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
    //
    // Users with completed textbooks must bypass the response cache: a
    // question asked before uploading the book may have cached an "I don't
    // know" answer that would now be stale (and wrong) after the upload.
    const userHasTextbooks = await getUserTextbookSignal(userId, supabase);
    const bypass = responseCache.shouldBypassCache({
      hasPersonalContext: !!userCoursesContext,
      hasTextbookChunks: userHasTextbooks,
      hasToolRequest: intentResult?.needsTools ?? false,
      isFollowUp: intentResult?.intent === UserIntent.FOLLOW_UP,
      ragEnabled,
    });

    if (!bypass) {
      const cacheResult = await responseCache.checkCache(queryEmbedding, searchQuery, userId);
      if (cacheResult.hit && cacheResult.cachedResponse) {
        ragLog.info("Response cache HIT — skipping LLM", {
          query: searchQuery.substring(0, 50),
          similarity: cacheResult.similarity?.toFixed(3),
          userId,
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
      userId,
    };

    // 3b. Curriculum scoping: try the inferred curriculum map first (lesson
    // boundaries from merged evidence), then fall back to the raw tree.
    let scopedPageStart: number | undefined;
    let scopedPageEnd: number | undefined;
    try {
      const mod = await import("../../textbook/textbook-search.js");
      let structureMatch = await mod.matchCurriculumSection(userId, searchQuery);
      if (!structureMatch || !structureMatch.matched) {
        structureMatch = await mod.matchStructureTree(userId, searchQuery);
      }

      if (structureMatch && structureMatch.ambiguous && structureMatch.candidates && structureMatch.candidates.length > 1) {
        // Skip clarifying if candidates are too generic (numeric, single chars)
        const isGeneric = structureMatch.candidates.every(c => /^\d+$/.test(c) || c.length <= 2);
        if (!isGeneric) {
          ragLog.info("Structure match ambiguous, asking clarifying question", {
            candidates: structureMatch.candidates,
          });

          const clarifyingText = `Your question could refer to different sections of your textbook. Could you clarify which section you mean?\n\nPossible matches:\n${structureMatch.candidates.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nPlease reply with the section name or number, and I'll search that specific area.`;

          return {
            ragContext: {
              hasContext: true,
              contextText: clarifyingText,
              sourceNames: ["Textbook Structure"],
              retrievalMethod: "structure_scope",
            },
            rankedDocs: [],
            cacheMetadata,
            ragSuccess: true,
            ragSources: ["Textbook Structure"],
            responseCacheHit: null,
          };
        }
        // Generic candidates — fall through to flat search
        ragLog.info("Structure match generic candidates, proceeding with flat search", {
          candidates: structureMatch.candidates,
        });
      }

      if (structureMatch && structureMatch.matched && !structureMatch.ambiguous) {
        scopedPageStart = structureMatch.page_start;
        scopedPageEnd = structureMatch.page_end;
        ragLog.info("Curriculum scoped search", {
          section: structureMatch.section_title,
          pages: `${scopedPageStart}-${scopedPageEnd}`,
        });
      }
    } catch (err) {
      ragLog.warn("Curriculum matching failed, proceeding with flat search", {
        error: (err as Error)?.message,
      });
    }

    // 4. Hybrid retrieval
    const matchThreshold = parseFloat(process.env.RAG_MATCH_THRESHOLD || "0.5");
    const initialMatchCount = parseInt(process.env.RAG_INITIAL_MATCH_COUNT || "15", 10);
    const finalMatchCount = parseInt(process.env.RAG_MATCH_COUNT || "5", 10);

    let rankedDocs = await ragCache.getResults(searchQuery, finalMatchCount, userId);
    if (rankedDocs) {
      ragLog.info("RAG results cache HIT", {
        query: searchQuery.substring(0, 50),
        docs: rankedDocs.length,
        userId,
      });
    } else {
      rankedDocs = await retrieveAndRank({
        supabase,
        queryEmbedding,
        searchQuery,
        matchThreshold,
        initialMatchCount,
        finalMatchCount,
        userId,
        pageStart: scopedPageStart,
        pageEnd: scopedPageEnd,
      });
    }

    // 4b. Quiz intent: "اختبرني بالدرس الأول" / "quiz me on lesson 2" — pull
    // the book's OWN questions for the matched lesson directly.
    let quizContext = "";
    const isQuizLike =
      /(اختبرني|امتحني|أسئلة|اسئلة|تمارين|تدريبات|quiz|test me|practice questions|give me questions)/i.test(
        lastUserText
      );
    if (isQuizLike) {
      try {
        const mod = await import("../../textbook/textbook-search.js");
        const sectionMatch = await mod.matchCurriculumSection(userId, searchQuery);

        let qQuery = supabase
          .from("textbook_questions")
          .select("number, text, page_number, section_path, question_type, textbooks!inner (id)")
          .eq("textbooks.user_id", userId)
          .eq("textbooks.status", "completed")
          .limit(8);
        if (sectionMatch && sectionMatch.matched && sectionMatch.section_title) {
          qQuery = qQuery.ilike("section_path", `%${sectionMatch.section_title}%`);
        }

        const { data: quizQuestions } = await qQuery;
        if (quizQuestions && quizQuestions.length > 0) {
          const listing = quizQuestions
            .map((q: any) => `${q.number ? q.number + ". " : "• "}${q.text} (p.${q.page_number})`)
            .join("\n");
          const lessonHint = sectionMatch?.matched ? ` for lesson "${sectionMatch.section_title}"` : "";
          quizContext =
            `THE USER'S OWN TEXTBOOK QUESTIONS${lessonHint}:\n${listing}\n\n` +
            `Tutor instruction: quiz the user with these exact questions from their book. Ask them ONE question at a time, ` +
            `wait for their answer, then evaluate it against the book content before moving to the next question.`;
          ragLog.info("Quiz context injected", {
            questions: quizQuestions.length,
            lesson: sectionMatch?.section_title || null,
          });
        }
      } catch (err) {
        ragLog.warn("Quiz context fetch failed (non-fatal)", {
          error: (err as Error)?.message,
        });
      }
    }

    if (!rankedDocs || rankedDocs.length === 0) {
      if (!quizContext) {
        ragLog.info("No relevant documents found in vector DB");
        return {
          ...empty,
          cacheMetadata,
        };
      }
      // Quiz-only path: retrieval found nothing but the book's questions exist
      return {
        ragContext: {
          hasContext: true,
          contextText: quizContext,
          sourceNames: ["Textbook Questions"],
          retrievalMethod: "curriculum",
        },
        rankedDocs: [],
        cacheMetadata,
        ragSuccess: true,
        ragSources: ["Textbook Questions"],
        responseCacheHit: null,
      };
    }

    // 5. Build context block
    const sourceNames = uniqueSourceNames(rankedDocs);
    const hasTextbookChunks = rankedDocs.some(d => d.metadata?.textbook_id);

    const contextText = rankedDocs
      .map((d, i) => {
        const sourceName = cleanSourceName(
          typeof d.metadata?.source === 'string' ? d.metadata.source :
          typeof d.metadata?.source_url === 'string' ? d.metadata.source_url :
          typeof d.metadata?.file_name === 'string' ? d.metadata.file_name : undefined
        );

        // Add page number for textbook chunks
        const pageHint = d.metadata?.page_number
          ? ` (page ${d.metadata.page_number})`
          : '';

        // Curriculum/structure path: which lesson/unit this content belongs to
        const sectionHint = typeof d.metadata?.structure_path === 'string' && d.metadata.structure_path
          ? ` [${d.metadata.structure_path}]`
          : '';

        return `[Source ${i + 1}: ${sourceName}${pageHint}${sectionHint}]\n${d.content}`;
      })
      .join("\n\n");

    // 5b. Textbook visual + curriculum enrichment: figure descriptions on the
    // cited pages and the book's structure map, so the model can answer
    // "what's the figure on page N" / "teach me lesson X" style questions.
    let textbookEnrichment = "";
    if (hasTextbookChunks) {
      try {
        const citedPagesByBook = new Map<string, Set<number>>();
        for (const d of rankedDocs) {
          const tbId = d.metadata?.textbook_id as string | undefined;
          const pageNo = d.metadata?.page_number as number | undefined;
          if (tbId && pageNo) {
            if (!citedPagesByBook.has(tbId)) citedPagesByBook.set(tbId, new Set());
            citedPagesByBook.get(tbId)!.add(pageNo);
          }
        }

        const parts: string[] = [];
        for (const [tbId, pages] of citedPagesByBook) {
          const pageList = [...pages].sort((a, b) => a - b);

          const { data: figs } = await supabase
            .from("textbook_figures")
            .select("page_number, caption, vlm_description")
            .eq("textbook_id", tbId)
            .in("page_number", pageList)
            .not("vlm_description", "is", null);
          for (const f of (figs || []).slice(0, 6)) {
            parts.push(
              `Figure on page ${f.page_number}: ${f.caption} — ${f.vlm_description}`
            );
          }

          const { data: sections } = await supabase
            .from("textbook_sections")
            .select("level, title, page_start, page_end")
            .eq("textbook_id", tbId)
            .in("level", ["unit", "lesson"])
            .order("order_index")
            .limit(40);
          if (sections && sections.length > 0) {
            const map = sections
              .map(
                (s: any) =>
                  `${s.level === "unit" ? "Unit" : "Lesson"} "${s.title}" (pages ${s.page_start}-${s.page_end})`
              )
              .join("; ");
            parts.push(`Book structure map: ${map}`);
          }
        }

        if (parts.length > 0) {
          textbookEnrichment = "\n\n" + parts.join("\n").substring(0, 2500);
        }
      } catch (err) {
        ragLog.warn("Textbook context enrichment failed (non-fatal)", {
          error: (err as Error)?.message,
        });
      }
    }

    // quiz context joins the enrichment block when both retrieval and quiz data exist
    if (quizContext) {
      textbookEnrichment += "\n\n" + quizContext;
    }

    // Add educational grounding prompt when textbook chunks are present
    const textbookPrompt = hasTextbookChunks ? `\n\n${(await import("../../textbook/textbook-prompts.js")).TEXTBOOK_SYSTEM_PROMPT_ADDITION}` : '';

    return {
      ragContext: {
        hasContext: true,
        contextText: contextText + textbookEnrichment + textbookPrompt,
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

/**
 * Short-TTL signal: does this user have any completed textbook?
 * Used to bypass the semantic response cache (stale pre-upload answers).
 * Invalidated eagerly by the upload route / worker on completion.
 */
const USER_TEXTBOOK_SIGNAL_TTL_MS = 60_000;
const userTextbookSignal = new Map<string, { value: boolean; expiry: number }>();

export function invalidateUserTextbookSignal(userId: string): void {
  userTextbookSignal.delete(userId);
}

async function getUserTextbookSignal(
  userId: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const cached = userTextbookSignal.get(userId);
  if (cached && cached.expiry > Date.now()) {
    return cached.value;
  }

  try {
    const { count } = await supabase
      .from("textbooks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed");
    const value = (count ?? 0) > 0;
    userTextbookSignal.set(userId, { value, expiry: Date.now() + USER_TEXTBOOK_SIGNAL_TTL_MS });
    return value;
  } catch {
    // On lookup failure, prefer correctness over caching: bypass
    return true;
  }
}

async function retrieveAndRank(args: {
  supabase: SupabaseClient;
  queryEmbedding: number[];
  searchQuery: string;
  matchThreshold: number;
  initialMatchCount: number;
  finalMatchCount: number;
  userId: string;
  pageStart?: number;
  pageEnd?: number;
}): Promise<RankedDoc[] | null> {
  const { supabase, queryEmbedding, searchQuery, matchThreshold, initialMatchCount, finalMatchCount, userId, pageStart, pageEnd } = args;
  const { getBM25Search } = await import("../../rag/bm25-search.js");
  const bm25 = await getBM25Search();

  const [vectorResult, bm25Results, textbookResults] = await Promise.all([
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
    import("../../textbook/textbook-search.js")
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

  const { rerankDocuments } = await import("../../rag/document-reranker.js");
  const reranked = await rerankDocuments(searchQuery, merged, finalMatchCount);

  await ragCache.setResults(searchQuery, finalMatchCount, reranked, userId);
  return reranked;
}

async function runBM25Fallback(searchQuery: string): Promise<RagStepResult> {
  try {
    const { getBM25Search } = await import("../../rag/bm25-search.js");
    const bm25 = await getBM25Search();
    if (bm25.getDocCount() === 0) {
      ragLog.info("BM25 index is empty. Skipping fallback.");
      return {
        ragContext: undefined,
        rankedDocs: [],
        cacheMetadata: undefined,
        ragSuccess: false,
        ragSources: [],
        responseCacheHit: null,
      };
    }
    const results = bm25.search(searchQuery, 3);
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
    docs.map((d) => cleanSourceName(
      typeof d.metadata?.source === 'string' ? d.metadata.source :
      typeof d.metadata?.source_url === 'string' ? d.metadata.source_url :
      typeof d.metadata?.file_name === 'string' ? d.metadata.file_name : undefined
    )),
  )];
}

function cleanSourceName(source?: string): string {
  if (!source) return "Knowledge Base";
  return source
    .replace(/^Textbook:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[_-]/g, " ")
    .trim() || "Knowledge Base";
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
  let activeThreadId: string | undefined = undefined;

  // 1. Verify ownership if threadId is provided
  if (threadId) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();

    if (session) {
      activeThreadId = session.id;
    } else {
      ragLog.warn("persistCacheHit: threadId does not belong to user or does not exist", {
        threadId,
        userId,
      });
    }
  }

  // 2. Fallback: create a new session if no valid thread is found
  if (!activeThreadId) {
    const { data: newSession, error: sessionErr } = await supabase
      .from("chat_sessions")
      .insert([{ title: "New Chat", user_id: userId }])
      .select("id")
      .single();

    if (newSession && !sessionErr) {
      activeThreadId = newSession.id;
    }
  }

  if (activeThreadId) {
    if (!res.headersSent) {
      res.setHeader("X-Thread-Id", activeThreadId);
    }
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

  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Cache-Hit", "true");
  }
  res.write(cachedResponse);
  res.end();

  return { threadId: activeThreadId };
}
