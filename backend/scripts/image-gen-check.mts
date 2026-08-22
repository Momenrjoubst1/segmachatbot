/** Live smoke test for the generate_image tool. Run from backend/: npx tsx scripts/image-gen-check.mts */
import "dotenv/config";

async function main() {
  const mod = await import("../src/tools/media/generate-image/index.js");
  // Tool registration happens at import; grab it through the aggregator.
  const { getToolDefinitions } = await import("../src/tools/tool-definitions-aggregator.js");
  const { initTools } = await import("../src/tools/tool-definitions-aggregator.js");
  await initTools();
  const tool = getToolDefinitions()["generate_image"];
  if (!tool) {
    console.error("generate_image NOT registered");
    process.exit(1);
  }
  console.log("Registered OK. Description:", tool.description.substring(0, 60), "...");

  const result = await tool.execute({ prompt: "a cute cartoon cat studying math", __userId: "00000000-0000-0000-0000-000000000001" });
  console.log("Execute result:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});