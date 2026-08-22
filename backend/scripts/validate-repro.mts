/** Reproduce the 400: test chatMessageSchema against payload shapes. Run from backend/: npx tsx scripts/validate-repro.mts */
import "dotenv/config";

async function main() {
  const { chatMessageSchema } = await import("../src/validators/chat-validation-schemas.js");

  const bigImage = "data:image/jpeg;base64," + "A".repeat(9_000_000); // > 8M chars

  const cases: Array<[string, unknown]> = [
    ["string content 'hi'", { messages: [{ role: "user", content: "hi" }] }],
    ["array parts small", { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }],
    ["UIMessage parts field (no content)", { messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] }],
    ["array with BIG image url (9M)", { messages: [{ role: "user", content: [{ type: "file", mediaType: "image/jpeg", url: bigImage }, { type: "text", text: "hi" }] }] }],
    ["history msg0 small + msg1 BIG image", { messages: [
      { role: "user", content: [{ type: "text", text: "earlier question" }] },
      { role: "assistant", content: "answer" },
      { role: "user", content: [{ type: "file", url: bigImage }, { type: "text", text: "solve this" }] },
    ]}],
    ["content as object", { messages: [{ role: "user", content: { text: "hi" } }] }],
  ];

  for (const [name, payload] of cases) {
    const r = chatMessageSchema.safeParse(payload);
    console.log(`${r.success ? "PASS" : "FAIL"}  ${name}${r.success ? "" : " -> " + JSON.stringify(r.error.issues.slice(0, 2).map(i => i.path.join(".") + ": " + i.message))}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });