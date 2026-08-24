const WebSocket = require("ws");
const key = process.env.ELEVENLABS_API_KEY;
const voiceId = process.argv[2];
const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_flash_v2_5&output_format=mp3_22050_32`;
console.log("testing voice:", voiceId);
const ws = new WebSocket(url);
let audioMsgs = 0, b64Total = 0;
ws.on("open", () => {
  ws.send(JSON.stringify({
    text: " ",
    xi_api_key: key,
    generation_config: { chunk_length_schedule: [50, 120, 160, 290] },
  }));
  setTimeout(() => ws.send(JSON.stringify({ text: "مرحبا، هذا اختبار سريع" })), 300);
  setTimeout(() => ws.send(JSON.stringify({ text: "" })), 1500);
});
ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  try {
    const j = JSON.parse(String(data));
    if (j.audio) { audioMsgs++; b64Total += j.audio.length; }
    else if (j.error || j.message) console.log("ERROR:", String(data).slice(0, 160));
  } catch {}
});
ws.on("close", (c) => {
  console.log(`RESULT audio_msgs=${audioMsgs} b64_bytes=${b64Total} close=${c}`);
  process.exit(audioMsgs > 0 ? 0 : 1);
});
ws.on("error", (e) => console.log("WSERR " + e.message));
setTimeout(() => process.exit(1), 10000);
