const WebSocket = require("ws");
const key = process.env.ELEVENLABS_API_KEY;
const voiceId = process.argv[2];
const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_flash_v2_5&output_format=mp3_22050_32`;
const ws = new WebSocket(url);
let audioMsgs = 0, b64Total = 0;
const fs = require("fs");
const chunks = [];
ws.on("open", () => {
  ws.send(JSON.stringify({ text: " ", xi_api_key: key, generation_config: { chunk_length_schedule: [50, 120, 160, 290] } }));
  setTimeout(() => ws.send(JSON.stringify({ text: "أهلا وسهلا! أنا سيجما، مساعدك الذكي. بقدر أساعدك بالدراسة والواجبات. شو حابب نتعلم اليوم؟" })), 300);
  setTimeout(() => ws.send(JSON.stringify({ text: "" })), 2500);
});
ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  try {
    const j = JSON.parse(String(data));
    if (j.audio && j.audio.length > 0) { audioMsgs++; b64Total += j.audio.length; chunks.push(Buffer.from(j.audio, "base64")); }
  } catch {}
});
ws.on("close", () => {
  const buf = Buffer.concat(chunks);
  const out = process.argv[3];
  if (buf.length > 0) fs.writeFileSync(out, buf);
  console.log(`voice=${voiceId} msgs=${audioMsgs} mp3_bytes=${buf.length} -> ${out}`);
  process.exit(0);
});
setTimeout(() => process.exit(0), 12000);
