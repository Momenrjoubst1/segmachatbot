// Sanity-check script for vision model routing decisions.
import "dotenv/config";

async function main() {
  const { isVisionCapableModel } = await import("../src/services/chat/message-processor.service.js");
  const { getVisionModel } = await import("../src/services/chat/model-router.js");

  const cases: Array<[string, boolean]> = [
    ["gemini-2.5-flash", true],
    ["google/gemini-2.0-flash-exp:free", true],
    ["gpt-4o-mini", true],
    ["gpt-5.4", true],
    ["claude-4-sonnet", true],
    ["deepseek-v4-flash", false],
    ["qwen/qwen3.6-27b", false],
    ["glm-4-flash", false],
  ];

  let failed = 0;
  for (const [model, expected] of cases) {
    const got = isVisionCapableModel(model);
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  isVisionCapable(${model}) = ${got} (expected ${expected})`);
  }

  const vm = getVisionModel();
  console.log(`VISION_MODEL env -> ${vm ?? "(unset)"}`);
  if (vm) {
    // Prove it resolves through the provider router
    const { getProviderAndModel } = await import("../src/routes/chat/chat-shared.js");
    try {
      const { provider, modelName } = getProviderAndModel(vm);
      console.log(`Resolves to provider=${provider}, model=${modelName}`);
    } catch (e) {
      failed++;
      console.log(`RESOLVE FAILED: ${(e as Error).message}`);
    }
  }

  console.log(failed === 0 ? "\nALL ROUTING CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});