/** Live check: primary model routing + fallback chain. Run from backend/: npx tsx scripts/model-routing-check.mts */
import "dotenv/config";

async function main() {
  const { getProviderAndModel, createProviderClient } = await import(
    "../src/routes/chat/chat-shared.js"
  );
  const { modelRouter } = await import("../src/services/chat/model-router.js");

  const def = process.env.ASSISTANT_DEFAULT_MODEL || "";
  const { provider, modelName } = getProviderAndModel(def);
  console.log(`Default: ${def} -> provider=${provider}, model=${modelName}`);

  const chain = modelRouter.getFallbackChain(def);
  console.log(`Fallback chain: ${chain.join(" -> ")}`);

  // Live call through the exact production path
  const client = createProviderClient(provider as Parameters<typeof createProviderClient>[0]);
  const { generateText } = await import("ai");
  const res = await generateText({
    model: client.chat(modelName),
    prompt: "Reply with exactly one word: OK",
    maxOutputTokens: 500,
  });
  console.log(`Live response [${provider}/${modelName}]:`, JSON.stringify(res.text.trim()));
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});