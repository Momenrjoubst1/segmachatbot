// Re-embed all textbook chunks at the current EXPECTED_DIMENSIONS target.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { generateEmbeddings, getActiveEmbeddingProvider } = await import(
    "../src/services/rag/embedding-service.js"
  );

  // Fetch chunks missing embeddings
  const { data: chunks, error } = await supabase
    .from("textbook_chunks")
    .select("id, content")
    .is("embedding", null)
    .order("id");

  if (error) {
    console.error("Fetch failed:", error.message);
    process.exit(1);
  }

  console.log(`Chunks to embed: ${chunks?.length ?? 0}`);
  if (!chunks || chunks.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const BATCH_SIZE = 16;
  const DELAY_MS = 800;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await generateEmbeddings(batch.map((c) => c.content));
      if (!vectors || vectors.length !== batch.length) {
        throw new Error(`Provider returned ${vectors?.length ?? 0}/${batch.length} vectors`);
      }
      for (let j = 0; j < batch.length; j++) {
        const { error: updErr } = await supabase
          .from("textbook_chunks")
          .update({ embedding: `[${vectors[j].join(",")}]` })
          .eq("id", batch[j].id);
        if (updErr) {
          failed++;
          console.error(`Update failed for chunk ${batch[j].id}:`, updErr.message);
        } else {
          done++;
        }
      }
      process.stdout.write(
        `\rProgress: ${done}/${chunks.length} embedded (failed: ${failed})`
      );
    } catch (err) {
      failed += batch.length;
      console.error(`\nBatch at offset ${i} failed:`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone. Provider: ${getActiveEmbeddingProvider()}. Embedded: ${done}, Failed: ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});