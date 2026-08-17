import { supabase } from "../../config/supabase.config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("textbook-embeddings");

const MAX_CHUNK_CHARS = 1000;
const OVERLAP_CHARS = 100;
const EMBEDDING_BATCH_SIZE = 20;
const EMBEDDING_DELAY_MS = 1000;
const EMBEDDING_MAX_RETRIES = 3;
const EXPECTED_DIMENSIONS = 9692;

function padEmbedding(embedding: number[]): number[] {
  return embedding.slice(0, EXPECTED_DIMENSIONS);
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
      const isRateLimit = (err as any)?.status === 429 || (err as any)?.message?.includes("rate");
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
    .select("id, content")
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
    const texts = batch.map((c) => c.content);

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
          const embedding = await generateEmbedding(chunk.content);
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
  return embedded;
}
