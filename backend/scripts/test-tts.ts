// Direct TTS verification (no HTTP/auth): generates one MP3 per persona and validates size + magic bytes.
import { mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_PERSONAS } from "../src/config/voice-personas.js";
import { synthesize } from "../src/services/tts-service.js";

const OUT = join(process.cwd(), ".tmp-tts-test");
mkdirSync(OUT, { recursive: true });

const SAMPLE =
  "السلام عليكم، أنا سيجما مساعدك الدراسي. اليوم سنتعلم معًا درسًا جديدًا في الرياضيات.";

function looksLikeMp3(buf: Buffer): boolean {
  const id3 = buf.subarray(0, 3).toString("latin1") === "ID3";
  const frameSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  return id3 || frameSync;
}

let failed = 0;
for (const p of VOICE_PERSONAS) {
  try {
    const t0 = Date.now();
    const { audio } = await synthesize(SAMPLE, p.id);
    const ms = Date.now() - t0;
    const file = join(OUT, `${p.id}.mp3`);
    writeFileSync(file, audio);
    const size = statSync(file).size;
    const okMagic = looksLikeMp3(readFileSync(file).subarray(0, 4));
    const pass = size > 8192 && okMagic;
    if (!pass) failed++;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${p.id.padEnd(8)} ${p.edgeVoice.padEnd(22)} ` +
        `${String(size).padStart(7)}B  ${ms}ms  magic=${okMagic}`,
    );
  } catch (err) {
    failed++;
    console.log(`FAIL ${p.id} :: ${String(err).slice(0, 160)}`);
  }
}
console.log(failed === 0 ? "ALL PERSONAS PASS" : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);