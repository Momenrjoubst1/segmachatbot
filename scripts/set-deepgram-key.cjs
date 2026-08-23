// One-shot: set DEEPGRAM_API_KEY in backend/.env safely (no BOM, no secret dump).
//
// NEVER hardcode the key here. Pass it via env or argv:
//   DEEPGRAM_API_KEY=... node scripts/set-deepgram-key.cjs
//   node scripts/set-deepgram-key.cjs <key>
const fs = require("fs");
const path = require("path");

const KEY = (process.env.DEEPGRAM_API_KEY || process.argv[2] || "").trim();
if (!KEY) {
  console.error(
    "Usage: DEEPGRAM_API_KEY=... node scripts/set-deepgram-key.cjs\n" +
      "       node scripts/set-deepgram-key.cjs <key>",
  );
  process.exit(1);
}

const file = path.resolve(__dirname, "..", "backend", ".env");

let raw = "";
if (fs.existsSync(file)) {
  raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
}

const line = `DEEPGRAM_API_KEY=${KEY}`;
let action;
if (/^DEEPGRAM_API_KEY=.+$/m.test(raw)) {
  raw = raw.replace(/^DEEPGRAM_API_KEY=.*$/m, line);
  action = "replaced existing value";
} else {
  if (raw.length && !raw.endsWith("\n")) raw += "\n";
  raw += `# Deepgram — dictation STT + Voice Agent\n${line}\n`;
  action = "appended new entry";
}

fs.writeFileSync(file, raw, "utf8");
console.log(`DEEPGRAM_API_KEY: ${action}`);

// Verify + report readiness of the other voice-agent vars (masked).
const check = fs.readFileSync(file, "utf8");
const has = (k) => new RegExp(`^${k}=.+$`, "m").test(check);
for (const k of [
  "VOICE_AGENT_SHARED_SECRET",
  "VOICE_AGENT_THINK_URL",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
]) {
  console.log(`${k}: ${has(k) ? "SET" : "missing"}`);
}
