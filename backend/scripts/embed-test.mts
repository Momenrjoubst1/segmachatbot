// Quick single-embedding smoke test. Run from backend/: npx tsx scripts/embed-test.mts
import "dotenv/config";

async function main() {
  const { generateEmbedding, getActiveEmbeddingProvider } = await import(
    "../src/services/rag/embedding-service.js"
  );
  const vec = await generateEmbedding("البناء الضوئي في النبات photosynthesis");
  if (!vec) {
    console.error("FAILED: null embedding");
    process.exit(1);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  console.log(`Provider: ${getActiveEmbeddingProvider()}`);
  console.log(`Dims: ${vec.length}`);
  console.log(`L2 norm: ${norm.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});