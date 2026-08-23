// One-shot: store ElevenLabs credentials in backend/.env (masked output).
//
// NEVER hardcode keys here. Pass them via env:
//   ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... node scripts/set-elevenlabs-env.cjs
// Optional: ELEVENLABS_VOICE_ID_ALT for the second selectable voice.
const fs = require("fs");
const path = require("path");

const VARS = {
  ELEVENLABS_API_KEY: (process.env.ELEVENLABS_API_KEY || "").trim(),
  ELEVENLABS_VOICE_ID: (process.env.ELEVENLABS_VOICE_ID || "").trim(),
  ELEVENLABS_VOICE_ID_ALT: (process.env.ELEVENLABS_VOICE_ID_ALT || "").trim(),
};

const missing = Object.entries(VARS)
  .filter(([k, v]) => !v && k !== "ELEVENLABS_VOICE_ID_ALT")
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const file = path.resolve(__dirname, "..", "backend", ".env");
let raw = fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").replace(/^﻿/, "")
  : "";

for (const [k, v] of Object.entries(VARS)) {
  if (!v) continue; // skip unset optional vars
  if (new RegExp(`^${k}=.+$`, "m").test(raw)) {
    raw = raw.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
    console.log(`${k}: replaced`);
  } else {
    if (raw.length && !raw.endsWith("\n")) raw += "\n";
    raw += `${k}=${v}\n`;
    console.log(`${k}: appended`);
  }
}

fs.writeFileSync(file, raw, "utf8");
console.log("done");
