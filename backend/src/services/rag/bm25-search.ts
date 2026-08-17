import { createLogger } from '../../utils/logger.js';
import { AsyncMutex } from '../../utils/async-mutex.js';

const log = createLogger('bm25');

export interface BM25Doc {
  id: number;
  content: string;
  metadata: Record<string, any>;
}

const DEFAULT_STOP_WORDS = [
  "و", "في", "من", "إلى", "عن", "على", "كان", "مع", "هذا", "هذه",
  "ذلك", "تلك", "هو", "هي", "هم", "هن", "قد", "لا", "ما", "لن",
  "إن", "أن", "إذا", "لم", "لما", "يكون", "ليست", "كانت",
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
];

function loadStopWords(): Set<string> {
  const customStopWords = process.env.BM25_STOP_WORDS;
  if (customStopWords) {
    try {
      const words = JSON.parse(customStopWords) as string[];
      log.info('Using custom BM25 stop words', { count: words.length });
      return new Set(words);
    } catch (error) {
      log.warn('Failed to parse BM25_STOP_WORDS, using defaults', { error });
    }
  }
  log.info('Using default BM25 stop words', { count: DEFAULT_STOP_WORDS.length });
  return new Set(DEFAULT_STOP_WORDS);
}

const STOP_WORDS = loadStopWords();

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\w\s\u0600-\u06FF]/g, " ");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const K1 = 1.5;
const B = 0.75;

export class BM25Search {
  private docs: BM25Doc[] = [];
  private avgDocLen: number = 0;
  private termFreq: Map<string, number> = new Map();
  private docTermFreqs: Map<number, Map<string, number>> = new Map();
  private totalDocs: number = 0;
  private isBuilt: boolean = false;

  constructor(docs: BM25Doc[] = []) {
    if (docs.length > 0) {
      this.build(docs);
    }
  }

  build(docs: BM25Doc[]): void {
    this.docs = docs;
    this.totalDocs = docs.length;
    this.termFreq = new Map();
    this.docTermFreqs = new Map();

    let totalLength = 0;

    for (const doc of docs) {
      const tokens = tokenize(doc.content);
      const tfMap = new Map<string, number>();
      const seenTerms = new Set<string>();

      for (const token of tokens) {
        tfMap.set(token, (tfMap.get(token) || 0) + 1);
        if (!seenTerms.has(token)) {
          this.termFreq.set(token, (this.termFreq.get(token) || 0) + 1);
          seenTerms.add(token);
        }
      }

      this.docTermFreqs.set(doc.id, tfMap);
      totalLength += tokens.length;
    }

    this.avgDocLen = this.totalDocs > 0 ? totalLength / this.totalDocs : 0;
    this.isBuilt = true;
  }

  search(query: string, topK: number = 5): { doc: BM25Doc; score: number }[] {
    if (!this.isBuilt || this.totalDocs === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores: { doc: BM25Doc; score: number }[] = [];

    for (const doc of this.docs) {
      let score = 0;
      const docTf = this.docTermFreqs.get(doc.id) || new Map();
      const docLen = [...docTf.values()].reduce((sum, v) => sum + v, 0);

      for (const qt of queryTokens) {
        const tf = docTf.get(qt) || 0;
        if (tf === 0) continue;

        const df = this.termFreq.get(qt) || 0;
        const idf = Math.log(
          (this.totalDocs - df + 0.5) / (df + 0.5) + 1
        );

        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (docLen / this.avgDocLen));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ doc, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  /**
   * Add a single document with an O(n_tokens) incremental update instead of
   * the previous O(N * n_tokens) full-rebuild approach.
   */
  addDoc(doc: BM25Doc): void {
    this.docs.push(doc);
    this.totalDocs++;

    const tokens = tokenize(doc.content);
    const tfMap = new Map<string, number>();
    const seenTerms = new Set<string>();

    for (const token of tokens) {
      tfMap.set(token, (tfMap.get(token) || 0) + 1);
      if (!seenTerms.has(token)) {
        this.termFreq.set(token, (this.termFreq.get(token) || 0) + 1);
        seenTerms.add(token);
      }
    }

    this.docTermFreqs.set(doc.id, tfMap);

    // Re-compute avgDocLen incrementally: new_avg = (old_avg * (N-1) + newLen) / N
    const newLen = tokens.length;
    this.avgDocLen =
      ((this.avgDocLen * (this.totalDocs - 1)) + newLen) / this.totalDocs;

    this.isBuilt = true;
  }

  getDocCount(): number {
    return this.docs.length;
  }

  getStats(): { totalDocs: number; avgDocLen: number; vocabSize: number } {
    return {
      totalDocs: this.totalDocs,
      avgDocLen: this.avgDocLen,
      vocabSize: this.termFreq.size,
    };
  }
}

let globalBM25: BM25Search | null = null;
let isInitializing = false;
let isInitialized = false;
let isRebuilding = false;
let globalBM25BeforeRebuild: BM25Search | null = null;

// Mutex to protect global state access
const bm25Mutex = new AsyncMutex();

export function getBM25Search(): BM25Search {
  if (!globalBM25) {
    globalBM25 = new BM25Search();
  }
  if (isRebuilding && globalBM25BeforeRebuild) {
    return globalBM25BeforeRebuild!;
  }
  return globalBM25!;
}

export async function setBM25Docs(docs: BM25Doc[]): Promise<void> {
  const newBm25 = new BM25Search();
  newBm25.build(docs);
  return bm25Mutex.runExclusive(async () => {
    globalBM25 = newBm25;
    isInitialized = true;
  });
}

export async function addBM25Doc(doc: BM25Doc): Promise<void> {
  return bm25Mutex.runExclusive(async () => {
    const bm25 = getBM25Search();
    bm25.addDoc(doc);
  });
}

export async function initializeBM25FromDB(): Promise<void> {
  if (isInitialized || isInitializing) return;
  isInitializing = true;

  try {
    log.info("[BM25] Initializing index from Supabase DB...");
    const { supabase } = await import("./rag-supabase-client.js");
    const { data, error } = await supabase
      .from("documents")
      .select("id, content, metadata")
      .limit(5000);

    if (error) {
      throw error;
    }

    if (data && data.length > 0) {
      const docs: BM25Doc[] = data.map((row: any) => ({
        id: Number(row.id),
        content: row.content,
        metadata: row.metadata || {},
      }));

      const newBm25 = new BM25Search();
      newBm25.build(docs);

      await bm25Mutex.runExclusive(async () => {
        globalBM25 = newBm25;
        isInitialized = true;
      });
      log.info(`[BM25] Successfully indexed ${docs.length} documents from DB.`);
    } else {
      await bm25Mutex.runExclusive(async () => {
        if (!globalBM25) globalBM25 = new BM25Search();
        isInitialized = true;
      });
      log.info("[BM25] No documents found in DB to index.");
    }
  } catch (err) {
    log.error("[BM25] Failed to initialize index from DB:", err instanceof Error ? err : new Error(String(err)));
  } finally {
    isInitializing = false;
  }
}

/**
 * Force a full re-initialization of the BM25 index from the database.
 * Resets the isInitialized guard so initializeBM25FromDB() will run again.
 * Used by the admin /api/admin/bm25/reindex endpoint.
 */
export async function resetBM25Index(): Promise<void> {
  await bm25Mutex.runExclusive(async () => {
    isInitialized = false;
    isInitializing = false;
  });
  await initializeBM25FromDB();
}

