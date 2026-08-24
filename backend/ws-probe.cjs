const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:3005/ws/tts-stream?voiceId=jN2L0WufWIAXnexEWTfh&model=eleven_flash_v2_5");
let audioBytes = 0;
const t = setTimeout(() => {
  console.log("RESULT audio_bytes=" + audioBytes);
  process.exit(audioBytes > 0 ? 0 : 3);
}, 12000);
ws.on("open", () => {
  console.log("WS OPEN");
  ws.send(JSON.stringify({ type: "config", voiceId: "jN2L0WufWIAXnexEWTfh", model: "eleven_flash_v2_5", autoMode: true }));
  setTimeout(() => {
    console.log("SENDING TEXT");
    ws.send(JSON.stringify({ text: "مرحبا، هذا اختبار للصوت." , flush: false }));
    ws.send(JSON.stringify({ text: "" })); // end-of-turn flush
  }, 800);
});
ws.on("message", (data, isBinary) => {
  if (isBinary) { audioBytes += data.length; console.log("AUDIO chunk " + data.length + "B (total " + audioBytes + ")"); }
  else { console.log("JSON: " + String(data).slice(0, 200)); }
});
ws.on("close", (code, reason) => { clearTimeout(t); console.log("CLOSED code=" + code + " reason=" + reason); process.exit(audioBytes > 0 ? 0 : 4); });
ws.on("error", (e) => { console.log("ERROR " + e.message); });
