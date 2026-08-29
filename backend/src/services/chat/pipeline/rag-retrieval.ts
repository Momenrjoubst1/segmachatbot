// Hybrid RAG retrieval: vector + BM25 with embedding/response caches, reranking, quiz scoping.

import { Response } from "express";
import { createLogger } from "../../../utils/logger.js";
const ragLog = createLogger("pipeline:rag-retrieval");
import { ragCache } from "../../rag/rag-cache.service.js";
import { RAG_CONFIG } from "../../../config/constants.js";
import { rewriteQuery } from "../query-rewriter.js";
import { responseCache, type CacheMetadata } from "../response-cache.service.js";
import { UserIntent, type IntentResult } from "../intent-detector.js";
import type { CoreMessage, RagContextData, RankedDoc } from "./types.js";
import type { IntentResult as IntentResultType } from "../intent-detector.js";
import { truncateRAGSources, calculateRAGBudget } from "../../rag/rag-context-truncator.js";
import { getModelContextWindow, estimateTokens } from "../../memory/token-estimator.js";
import { truncateWithBoundaries } from "../../rag/rag-context-truncator.js";

// Extracted helper functions
import { getUserTextbookSignal } from "./rag/textbook-signal.js";
import { retrieveAndRank } from "./rag/retrieval.js";
import { runBM25Fallback } from "./rag/bm25-fallback.js";
import { uniqueSourceNames } from "./rag/rag-utils.js";
import { persistCacheHit } from "./rag/cache-hit.js";

const DEFAULT_INTENT: IntentResultType = {
  intent: UserIntent.KNOWLEDGE_QUERY,
  confidence: 0.5,
  needsRAG: true,
  needsTools: false,
};

/**
 * Explicit quiz-request intent. Deliberately narrow: broad study words
 * ("سؤال", "study", "revise") used to switch ordinary study questions into
 * quiz mode. Exported so tests validate the shipped regex, not a copy.
 */
export const QUIZ_INTENT_REGEX =
  /(اختبرني|راجعني|امتحني|اختبار لي|امتحاني|أسئلة|اسئلة|تمارين|تدريبات|\bquiz\b|\bquiz me\b|\btest me\b|\bpractice questions\b|\bgive me questions\b)/i;

// Public API: pipeline result shape and entry point.

export interface RagStepResult {
  ragContext: RagContextData | undefined;
  rankedDocs: RankedDoc[];
  cacheMetadata: CacheMetadata | undefined;
  ragSuccess: boolean;
  ragSources: string[];
  hasTextbookChunks: boolean;
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
    hasTextbookChunks: false,
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
      coreMessages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : undefined })),
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
      return runBM25Fallback(searchQuery, userId);
    }

    ragLog.info("Embedding generated. Searching vector DB", {
      dims: queryEmbedding.length,
    });

    // 3. Response cache check — bypassed for textbook users (pre-upload answers go stale).
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

    // 3b. Curriculum scoping: try the inferred curriculum map, then the raw structure tree.
    let scopedPageStart: number | undefined;
    let scopedPageEnd: number | undefined;
    try {
      const mod = await import("../../textbook/textbook-search.js");
      // Use semantic matching when we have an embedding (much better for paraphrases)
      let structureMatch = queryEmbedding
        ? await mod.matchCurriculumSectionSemantic(userId, searchQuery, queryEmbedding)
        : await mod.matchCurriculumSection(userId, searchQuery);
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
            hasTextbookChunks: false,
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
    const matchThreshold = RAG_CONFIG.MATCH_THRESHOLD;
    const initialMatchCount = RAG_CONFIG.INITIAL_MATCH_COUNT;
    const finalMatchCount = RAG_CONFIG.FINAL_MATCH_COUNT;

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

    // 4b. Quiz intent: pull the book's own questions for the matched lesson directly.
    // Only explicit quiz requests match here — broad words like "سؤال" or "study"
    // used to hijack ordinary study questions into quiz mode.
    let quizContext = "";
    const isQuizLike = QUIZ_INTENT_REGEX.test(lastUserText);
    if (isQuizLike) {
      try {
        const mod = await import("../../textbook/textbook-search.js");
        // Use semantic matching for quiz scoping too
        const sectionMatch = queryEmbedding
          ? await mod.matchCurriculumSectionSemantic(userId, searchQuery, queryEmbedding)
          : await mod.matchCurriculumSection(userId, searchQuery);

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
            .map((q: { number?: number; text: string; page_number?: number }) => `${q.number ? q.number + ". " : "• "}${q.text} (p.${q.page_number})`)
            .join("\n");
          const lessonHint = sectionMatch?.matched ? ` for lesson "${sectionMatch.section_title}"` : "";
          const topicForTool = sectionMatch?.matched ? sectionMatch.section_title : (quizQuestions[0]?.section_path || "general");
          quizContext =
            `THE USER'S OWN TEXTBOOK QUESTIONS${lessonHint}:\n${listing}\n\n` +
            `Tutor instruction: quiz the user with these exact questions from their book. Ask them ONE question at a time, ` +
            `wait for their answer, then evaluate it against the book content before moving to the next question. ` +
            `After evaluating each answer, you MUST call the record_quiz_result tool immediately with: ` +
            `topic="${topicForTool}", correct=<true/false>, ` +
            `courseId and textbookId from the context if available. ` +
            `Then proceed to the next question.`;
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
        hasTextbookChunks: false,
        responseCacheHit: null,
      };
    }

    // 5. Build context block with per-source truncation
    const sourceNames = uniqueSourceNames(rankedDocs);
    const hasTextbookChunks = rankedDocs.some(d => d.metadata?.textbook_id);

    // Budget RAG tokens from the model context window, reserving ~15% for prompt and output.
    const reservedForPrompt = Math.max(
      6000,
      Math.floor(getModelContextWindow(selectedModel) * 0.15),
    );
    const ragBudgetTokens = calculateRAGBudget(selectedModel, reservedForPrompt);

    // Truncate sources to the budget, scaling the per-source cap with window size.
    const truncationResult = truncateRAGSources(rankedDocs, {
      totalBudgetTokens: ragBudgetTokens,
      maxTokensPerSource: Math.max(
        1500,
        Math.floor(ragBudgetTokens / Math.max(1, rankedDocs.length)),
      ),
      strategy: 'hybrid',
      preserveBoundaries: true,
    });

    if (truncationResult.warnings.length > 0) {
      for (const w of truncationResult.warnings) {
        ragLog.warn("RAG truncation warning", { warning: w });
      }
    }

    let contextText = truncationResult.contextText;

    // 5b. Enrich with cited-page figures and the book's structure map for textbook questions.
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
        const allTbIds = [...citedPagesByBook.keys()];

        // Batch query figures for ALL cited textbooks at once (N+1 -> 1)
        const allPageNumbers: Record<string, number[]> = {};
        for (const [tbId, pages] of citedPagesByBook) {
          allPageNumbers[tbId] = [...pages].sort((a, b) => a - b);
        }

        const { data: allFigs } = await supabase
          .from("textbook_figures")
          .select("textbook_id, page_number, caption, vlm_description")
          .in("textbook_id", allTbIds)
          .in("page_number", Object.values(allPageNumbers).flat())
          .not("vlm_description", "is", null);

        const figsByBook = new Map<string, typeof allFigs>();
        for (const fig of (allFigs || [])) {
          if (!figsByBook.has(fig.textbook_id)) figsByBook.set(fig.textbook_id, []);
          figsByBook.get(fig.textbook_id)!.push(fig);
        }

        // Batch query sections for ALL cited textbooks at once (N+1 -> 1)
        const { data: allSections } = await supabase
          .from("textbook_sections")
          .select("textbook_id, level, title, page_start, page_end, order_index")
          .in("textbook_id", allTbIds)
          .in("level", ["unit", "lesson"])
          .order("order_index");

        const sectionsByBook = new Map<string, typeof allSections>();
        for (const sec of (allSections || [])) {
          if (!sectionsByBook.has(sec.textbook_id)) sectionsByBook.set(sec.textbook_id, []);
          sectionsByBook.get(sec.textbook_id)!.push(sec);
        }

        // Build enrichment from batched results
        for (const [tbId, pages] of citedPagesByBook) {
          const pageList = [...pages].sort((a, b) => a - b);
          const figs = (figsByBook.get(tbId) || []).filter(f => pageList.includes(f.page_number)).slice(0, 6);
          for (const f of figs) {
            parts.push(`Figure on page ${f.page_number}: ${f.caption} — ${f.vlm_description}`);
          }

          const sections = (sectionsByBook.get(tbId) || []).slice(0, 40);
          if (sections.length > 0) {
            const map = sections
              .map((s: { level?: string; title: string; page_start?: number; page_end?: number }) => `${s.level === "unit" ? "Unit" : "Lesson"} "${s.title}" (pages ${s.page_start}-${s.page_end})`)
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

    // Final context with enrichment (enrichment added after truncation, but monitor total)
    const finalContextText = contextText + textbookEnrichment + textbookPrompt;
    
    // Final safety truncation if enrichment pushed us over budget
    const finalTokens = estimateTokens(finalContextText);
    if (finalTokens > ragBudgetTokens) {
      ragLog.warn("RAG context with enrichment exceeds budget, applying final truncation", {
        tokens: finalTokens,
        budget: ragBudgetTokens,
      });
      // Truncate enrichment first
      const enrichmentTokens = estimateTokens(textbookEnrichment + textbookPrompt);
      const contextTokens = estimateTokens(contextText);
      if (enrichmentTokens > 0) {
        const enrichedTruncated = truncateWithBoundaries(textbookEnrichment + textbookPrompt, ragBudgetTokens - contextTokens, true);
        contextText = contextText + enrichedTruncated;
      }
    }

    return {
      ragContext: {
        hasContext: true,
        contextText: finalContextText,
        sourceNames: truncationResult.sourceNames,
        retrievalMethod: 'hybrid',
      },
      rankedDocs,
      cacheMetadata: { ...cacheMetadata, ragSources: truncationResult.sourceNames },
      ragSuccess: true,
      ragSources: truncationResult.sourceNames,
      hasTextbookChunks,
      responseCacheHit: null,
    };
  } catch (ragError) {
    ragLog.warn("Retrieval failed, falling back to standard chat", {
      error: (ragError as Error)?.message,
    });
    return empty;
  }
}

// Re-export for backward compatibility
export { invalidateUserTextbookSignal } from "./rag/textbook-signal.js";
