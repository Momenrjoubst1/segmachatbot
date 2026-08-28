// Purge all uploaded textbook files from R2. Run from backend/: npx tsx scripts/r2-purge.mts
import "dotenv/config";

async function main() {
  const { deleteR2ObjectsByPrefix, isR2Configured } = await import(
    "../src/services/textbook/r2-client.js"
  );
  if (!isR2Configured()) {
    console.log("R2 not configured — nothing to purge");
    return;
  }
  const deleted = await deleteR2ObjectsByPrefix("textbooks/");
  console.log(`R2 objects deleted under "textbooks/": ${deleted}`);
}

main().catch((e) => {
  console.error("Purge failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});