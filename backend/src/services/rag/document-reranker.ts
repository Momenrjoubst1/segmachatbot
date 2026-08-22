import { createLogger } from '../../utils/logger.js';
import { RERANKER_CONFIG } from '../../config/constants.js';

const log = createLogger('rerank');

interface RankedDoc {
  id: string | number;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
  rerankScore: number;
}

interface RerankerProvider {
  name: string;
  rerank(query: string, docs: { content: string; id?: string | number }[]): Promise<{ score: number; index: number }[]>;
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, " ");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const stopWords = new Set([
    "و", "في", "من", "إلى", "عن", "على", "كان", "مع", "هذا", "هذه",
    "ذلك", "تلك", "هو", "هي", "هم", "هن", "قد", "لا", "ما", "لن",
    "إن", "أن", "إذا", "لم", "لما", "يكون", "ليست", "كانت", "been",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "no", "nor", "not", "only", "own", "same", "so",
    "than", "too", "very", "just", "because", "as", "until", "while",
    "about", "above", "across", "after", "along", "among", "around",
    "at", "before", "behind", "below", "beneath", "beside", "between",
    "beyond", "by", "down", "during", "except", "for", "from", "in",
    "inside", "into", "near", "of", "off", "on", "out", "outside",
    "over", "through", "throughout", "to", "toward", "under", "underneath",
    "until", "up", "upon", "with", "within", "without",
  ]);
  return new Set([...tokens].filter((t) => t.length > 1 && !stopWords.has(t)));
}

function computeOverlapScore(query: string, doc: string): number {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(doc);
  if (queryTokens.size === 0 || docTokens.size === 0) return 0;

  let matches = 0;
  for (const qt of queryTokens) {
    if (docTokens.has(qt)) matches++;
  }

  const recall = matches / queryTokens.size;
  const precision = matches / Math.max(docTokens.size, 1);

  if (recall === 0 || precision === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function computePositionalScore(query: string, doc: string): number {
  const queryTokens = [...tokenize(query)];
  const docLower = doc.toLowerCase();

  let totalScore = 0;
  for (const qt of queryTokens) {
    const pos = docLower.indexOf(qt);
    if (pos !== -1) {
      totalScore += 1 / (1 + pos / 100);
    }
  }

  return queryTokens.length > 0 ? totalScore / queryTokens.length : 0;
}

const tokenOverlapReranker: RerankerProvider = {
  name: "token-overlap",
  rerank: async (_query: string, docs: { content: string; id?: number }[]) => {
    return docs.map((doc, index) => {
      const overlapScore = computeOverlapScore(_query, doc.content);
      const posScore = computePositionalScore(_query, doc.content);
      const score = overlapScore * 0.7 + posScore * 0.3;
      return { score, index };
    });
  },
};

let cohereReranker: RerankerProvider | null = null;

/**
 * Pre-warm the Cohere reranker at startup to avoid cold-start latency
 * on the first request. Safe to call multiple times (no-op if already init'd).
 */
export async function warmUpReranker(): Promise<void> {
  if (!cohereReranker) {
    cohereReranker = await createCohereReranker();
    if (cohereReranker) {
      log.info("[Rerank] Cohere reranker pre-warmed at startup");
    }
  }
}

async function createCohereReranker(): Promise<RerankerProvider | null> {
  const apiKey = RERANKER_CONFIG.COHERE_API_KEY;
  if (!apiKey) return null;

  const model = RERANKER_CONFIG.COHERE_RERANK_MODEL;

  return {
    name: "cohere",
    rerank: async (query: string, docs: { content: string; id?: number }[]) => {
      try {
        const response = await fetch("https://api.cohere.ai/v1/rerank", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            query,
            documents: docs.map((d) => d.content),
            top_n: docs.length,
          }),
        });

        if (!response.ok) throw new Error(`Cohere returned ${response.status}`);

        const data = await response.json() as { results: { index: number; relevance_score: number }[] };
        return data.results.map((r) => ({
          score: r.relevance_score,
          index: r.index,
        }));
      } catch (err: unknown) {
        log.warn(`[Rerank] Cohere failed:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
  };
}

export async function rerankDocuments(
  query: string,
  documents: RankedDoc[],
  topK: number = 5
): Promise<RankedDoc[]> {
  if (documents.length === 0) return [];
  if (documents.length === 1) return documents;

  if (!cohereReranker) {
    cohereReranker = await createCohereReranker();
  }

  const docsForRerank = documents.map((d) => ({ content: d.content, id: d.id }));

  let rerankerToUse: RerankerProvider;
  if (cohereReranker) {
    // Cohere was pre-initialised — use it
    rerankerToUse = cohereReranker;
  } else {
    const envPref = RERANKER_CONFIG.RAG_RERANKER_PROVIDER?.toLowerCase();
    if (envPref === "cohere") {
      // Caller requested Cohere but it isn't set up — try once more
      const freshCohere = await createCohereReranker();
      if (freshCohere) {
        cohereReranker = freshCohere;
        rerankerToUse = freshCohere;
      } else {
        log.warn("[Rerank] Cohere requested but COHERE_API_KEY is missing. Falling back to token-overlap.");
        rerankerToUse = tokenOverlapReranker;
      }
    } else {
      // Default (or explicitly "token-overlap")
      rerankerToUse = tokenOverlapReranker;
    }
  }

  try {
    const reranked = await rerankerToUse.rerank(query, docsForRerank);

    const scoredDocs = reranked.map((r) => {
      const doc = documents[r.index];
      return {
        ...doc,
        rerankScore: r.score,
      };
    });

    scoredDocs.sort((a, b) => b.rerankScore - a.rerankScore);
    return scoredDocs.slice(0, topK);
  } catch (err) {
    log.warn(`[Rerank] ${rerankerToUse.name} failed, using original order:`, err instanceof Error ? err : new Error(String(err)));
    return documents.slice(0, topK);
  }
}

export async function rerankWithCohere(
  query: string,
  texts: string[],
  topK?: number
): Promise<{ text: string; score: number }[]> {
  const docs = texts.map((t) => ({ content: t }));
  const rankedDocs = await rerankDocuments(query, docs.map((d, i) => ({
    id: i,
    content: d.content,
    metadata: {},
    similarity: 0,
    rerankScore: 0,
  })), topK);

  return rankedDocs.map((d) => ({ text: d.content, score: d.rerankScore }));
}
