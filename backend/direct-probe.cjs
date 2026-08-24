const WebSocket = require("ws");
const key = process.env.ELEVENLABS_API_KEY;
const voiceId = "jN2L0WufWIAXnexEWTfh";
const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_flash_v2_5&output_format=mp3_22050_32&optimize_streaming_latency=4`;
console.log("connecting");
const ws = new WebSocket(url);
let audioMsgs = 0;
ws.on("open", () => {
  console.log("UPSTREAM OPEN");
  // First message: settings + BOM space text (per ElevenLabs docs)
  ws.send(JSON.stringify({
    text: " ",
    xi_api_key: key,
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    generation_config: { chunk_length_schedule: [50, 120, 160, 290] },
  }));
  setTimeout(() => {
    console.log("sending text...");
    ws.send(JSON.stringify({ text: "مرحبا هذا اختبار للصوت" }));
  }, 400);
  setTimeout(() => {
    console.log("sending EOS");
    ws.send(JSON.stringify({ text: "" }));
  }, 2500);
});
ws.on("message", (data, isBinary) => {
  if (isBinary) { console.log("BINARY " + data.length); return; }
  const s = String(data);
  try {
    const j = JSON.parse(s);
    if (j.audio) { audioMsgs++; if (audioMsgs <= 3 || audioMsgs % 20 === 0) console.log("AUDIO#" + audioMsgs + " b64len=" + j.audio.length + " isFinal=" + j.isFinal); }
    else console.log("JSON keys=" + Object.keys(j).join(",") + " preview=" + s.slice(0, 140));
  } catch { console.log("NON-JSON: " + s.slice(0, 120)); }
});
ws.on("close", (c, r) => { console.log(`CLOSED c=${c} audio_msgs=${audioMsgs}`); process.exit(0); });
ws.on("error", (e) => console.log("ERROR " + e.message));
setTimeout(() => process.exit(0), 12000);
