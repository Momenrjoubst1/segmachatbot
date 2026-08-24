const WebSocket = require("ws");
// Through our backend relay — the exact path the browser uses
const ws = new WebSocket("ws://localhost:3005/ws/tts-stream?voiceId=EXAVITQu4vr4xnSDxMaL&model=eleven_flash_v2_5");
let audioChunks = 0, totalBytes = 0;
const fs = require("fs");
const chunks = [];
ws.on("open", () => {
  console.log("[1] relay WS open");
  ws.send(JSON.stringify({ type: "config", voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_flash_v2_5" }));
});
ws.on("message", (data, isBinary) => {
  if (!isBinary) {
    const evt = JSON.parse(String(data));
    if (evt.type === "ready") {
      console.log("[2] upstream ready, sending Arabic sentence...");
      ws.send(JSON.stringify({ text: "أهلا وسهلا! أنا سيجما، مساعدك الذكي للدراسة. شو حابب نتعلم اليوم؟" }));
      setTimeout(() => ws.send(JSON.stringify({ text: "" })), 1500);
    } else {
      console.log("[evt]", String(data).slice(0, 120));
    }
    return;
  }
  audioChunks++; totalBytes += data.length;
  chunks.push(Buffer.from(data));
});
ws.on("close", () => {
  const buf = Buffer.concat(chunks);
  if (buf.length > 0) fs.writeFileSync(process.env.TEMP + "\\tts-relay-e2e.mp3", buf);
  console.log(`[3] RESULT chunks=${audioChunks} mp3_bytes=${buf.length}`);
  console.log(buf.length > 1000 ? "✅ E2E THROUGH RELAY WORKS" : "❌ no audio");
  process.exit(buf.length > 1000 ? 0 : 1);
});
setTimeout(() => process.exit(1), 15000);
