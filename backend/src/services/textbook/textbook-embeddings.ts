import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";
import { MAX_CHUNK_CHARS, OVERLAP_CHARS, TEXTBOOK_CONFIG } from "../../config/constants.js";

const log = createLogger("textbook-embeddings");

// Destructure for readability — these are the knobs operators tune
const {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_DELAY_MS,
  EMBEDDING_MAX_RETRIES,
  EXPECTED_DIMENSIONS,
} = TEXTBOOK_CONFIG;

function padEmbedding(embedding: number[]): number[] {
  return embedding.slice(0, EXPECTED_DIMENSIONS);
}

/**
 * Build a metadata-anchored string for embedding.  Prepends the section path
 * and page number so the embedding model learns the structural context —
 * "page 142, Unit 3, Lesson 2: Cellular Respiration: mitochondrial membrane
 * potential..." instead of just "mitochondrial membrane potential...".
 *
 * The raw `content` column stays unchanged (BM25/tsvector search).
 */
function buildAnchoredText(
  content: string,
  structurePath: string | null,
  pageNumber: number,
): string {
  const parts: string[] = [];
  if (structurePath) parts.push(structurePath);
  parts.push(`page ${pageNumber}`);
  parts.push(content);
  return parts.join(": ");
}

export function splitTextIntoEmbeddableChunks(
  text: string,
  maxChars: number = MAX_CHUNK_CHARS,
  overlap: number = OVERLAP_CHARS
): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    let chunkEnd = end;

    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end - 1);
      const lastSpace = text.lastIndexOf(" ", end - 1);
      if (lastPeriod > start + maxChars * 0.5) {
        chunkEnd = lastPeriod + 1;
      } else if (lastSpace > start + maxChars * 0.5) {
        chunkEnd = lastSpace;
      }
    }

    chunks.push(text.slice(start, chunkEnd).trim());
    start = chunkEnd - overlap;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 20);
}

async function embedWithRetry(
  texts: string[],
  retries: number = EMBEDDING_MAX_RETRIES
): Promise<number[][]> {
  const { generateEmbeddings } = await import("../rag/embedding-service.js");

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const embeddings = await generateEmbeddings(texts);
      if (!embeddings) {
        throw new Error("All embedding providers failed");
      }
      return embeddings.map(padEmbedding);
    } catch (err) {
      const isRateLimit = (err as { status?: number; message?: string })?.status === 429 || (err as { message?: string })?.message?.includes("rate");
      if (attempt < retries - 1 && isRateLimit) {
        const delay = Math.pow(2, attempt) * 1000;
        log.warn("Rate limited, retrying after delay", { attempt, delay });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

export async function embedTextbookChunks(
  textbookId: string,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const { generateEmbedding } = await import("../rag/embedding-service.js");

  const { data: chunks, error } = await supabase
    .from("textbook_chunks")
    .select("id, content, structure_path, page_number")
    .eq("textbook_id", textbookId)
    .is("embedding", null);

  if (error) {
    log.error("Failed to fetch chunks for embedding", { error: error.message });
    return 0;
  }

  if (!chunks || chunks.length === 0) {
    log.info("No unembedded chunks found", { textbookId });
    return 0;
  }

  log.info("Embedding textbook chunks", { textbookId, count: chunks.length });

  let embedded = 0;
  onProgress?.(0, chunks.length);

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    // Anchor each chunk with its section path and page number before embedding
    // so the vector captures structural context (raw content stays unchanged).
    const texts = batch.map((c) =>
      buildAnchoredText(c.content, c.structure_path, c.page_number)
    );

    try {
      const embeddings = await embedWithRetry(texts);

      const updates = batch.map((c, j) => ({
        id: c.id,
        embedding: embeddings[j],
      }));

      const { error: updateError } = await supabase.rpc("batch_update_embeddings", {
        p_updates: updates,
        p_textbook_id: textbookId,
      });

      if (updateError) {
        log.warn("Batch RPC failed, falling back to individual updates", {
          error: updateError.message,
        });
        for (const { id, embedding } of updates) {
          await supabase
            .from("textbook_chunks")
            .update({ embedding })
            .eq("id", id);
          embedded++;
        }
      } else {
        embedded += batch.length;
      }
    } catch (err) {
      log.warn("Batch embedding failed, falling back to single", {
        error: (err as Error).message,
      });

      for (const chunk of batch) {
        try {
          const anchoredText = buildAnchoredText(
            chunk.content,
            (chunk as { structure_path?: string }).structure_path ?? null,
            (chunk as { page_number?: number }).page_number ?? 0,
          );
          const embedding = await generateEmbedding(anchoredText);
          if (embedding) {
            const padded = embedding.length < EXPECTED_DIMENSIONS
              ? [...embedding, ...new Array(EXPECTED_DIMENSIONS - embedding.length).fill(0)]
              : embedding.slice(0, EXPECTED_DIMENSIONS);
            await supabase
              .from("textbook_chunks")
              .update({ embedding: padded })
              .eq("id", chunk.id);
            embedded++;
          }
        } catch (singleErr) {
          log.warn("Single chunk embedding failed", {
            chunkId: chunk.id,
            error: (singleErr as Error).message,
          });
        }
      }
    }

    // Rate limiting: delay between batches
    if (i + EMBEDDING_BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, EMBEDDING_DELAY_MS));
    }

    onProgress?.(Math.min(embedded, chunks.length), chunks.length);
  }

  log.info("Embedding complete", { textbookId, embedded, total: chunks.length });

  // pgvector's query planner needs fresh statistics after a bulk embedding
  // batch — without ANALYZE it may fall back to a sequential scan even when
  // the HNSW index exists.  Best-effort: a failure here must not block the
  // textbook from being marked completed.
  try {
    const { error: analyzeErr } = await supabase.rpc("analyze_textbook_chunks" as never);
    if (analyzeErr) {
      log.warn("ANALYZE after embedding failed (non-fatal)", { error: analyzeErr.message });
    }
  } catch {
    // RPC may not exist yet — safe to skip
  }

  // ── Page summaries for late-interaction retrieval ──────────────────────
  // Generate a per-page summary embedding so the search can do a two-layer
  // retrieval: match pages first (high recall), then chunks within pages
  // (precise).  This gives ColBERT-like recall without multi-vector cost.
  try {
    await generatePageSummaries(textbookId);
  } catch (summaryErr) {
    log.warn("Page summary generation failed (non-fatal)", {
      error: (summaryErr as Error).message,
    });
  }

  return embedded;
}

/**
 * Generate per-page summary embeddings for late-interaction retrieval.
 * Concatenates all chunks on a page into a single summary, then embeds it.
 * These summaries enable a two-layer search: match pages (coarse), then
 * retrieve chunks within matched pages (precise).
 */
async function generatePageSummaries(textbookId: string): Promise<void> {
  // Fetch all embedded chunks grouped by page
  const { data: allChunks, error } = await supabase
    .from("textbook_chunks")
    .select("page_number, content")
    .eq("textbook_id", textbookId)
    .not("embedding", "is", null)
    .order("page_number");

  if (error || !allChunks || allChunks.length === 0) return;

  // Group by page
  const pages = new Map<number, string[]>();
  for (const c of allChunks) {
    const list = pages.get(c.page_number) || [];
    list.push(c.content);
    pages.set(c.page_number, list);
  }

  const { generateEmbedding } = await import("../rag/embedding-service.js");

  // Generate summary per page (truncate to ~800 chars to fit embedding context)
  const summaryRows: Array<{
    textbook_id: string;
    page_number: number;
    summary: string;
    embedding: number[];
  }> = [];

  for (const [pageNum, contents] of pages) {
    const summary = contents.join(" ").substring(0, 800);
    if (summary.length < 20) continue;

    const embedding = await generateEmbedding(summary);
    if (!embedding) continue;

    summaryRows.push({
      textbook_id: textbookId,
      page_number: pageNum,
      summary,
      embedding: padEmbedding(embedding),
    });
  }

  if (summaryRows.length === 0) return;

  // Delete old summaries and insert new
  await supabase.from("textbook_page_summaries").delete().eq("textbook_id", textbookId);

  // Batch insert (Supabase body limit)
  for (let i = 0; i < summaryRows.length; i += 50) {
    const { error: insertErr } = await supabase
      .from("textbook_page_summaries")
      .insert(summaryRows.slice(i, i + 50));
    if (insertErr) {
      log.warn("Failed to insert page summaries batch", { error: insertErr.message });
    }
  }

  log.info("Page summaries generated", { textbookId, pages: summaryRows.length });
}

// ── Semantic chunking via embedding similarity ──────────────────────────
// After initial syntactic chunking, embed consecutive chunks and detect
// topic shifts by cosine distance.  Splits at topic boundaries, re-merges
// chunks that are too small.  Controlled by ENABLE_SEMANTIC_CHUNKING.

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Re-split a list of chunks based on embedding cosine similarity.
 * When consecutive chunks have low similarity (topic shift), split there.
 * Then re-merge any resulting chunks that are too small.
 */
export function semanticResplit(
  chunks: string[],
  embeddings: number[][],
  threshold: number = TEXTBOOK_CONFIG.SEMANTIC_CHUNK_SIM_THRESHOLD,
  minChars: number = TEXTBOOK_CONFIG.SEMANTIC_CHUNK_MIN_CHARS,
): string[] {
  if (chunks.length <= 1 || embeddings.length !== chunks.length) return chunks;

  // Find split points where cosine similarity drops below threshold
  const splitPoints: number[] = [0];
  for (let i = 1; i < embeddings.length; i++) {
    const sim = cosineSimilarity(embeddings[i - 1], embeddings[i]);
    if (sim < threshold) {
      splitPoints.push(i);
    }
  }
  splitPoints.push(embeddings.length);

  // Build new chunks from split boundaries
  const resplit: string[] = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    const start = splitPoints[i];
    const end = splitPoints[i + 1];
    const merged = chunks.slice(start, end).join(" ");
    resplit.push(merged);
  }

  // Re-merge chunks that are too small (append to previous)
  const merged: string[] = [];
  for (const chunk of resplit) {
    if (merged.length > 0 && chunk.length < minChars) {
      merged[merged.length - 1] += " " + chunk;
    } else {
      merged.push(chunk);
    }
  }

  return merged.filter((c) => c.trim().length > 20);
}
