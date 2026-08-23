/**
 * Direct Deepgram live-WS probe using EXACTLY the relay's parameters.
 * Sends 1.5s of silence PCM16@16k and prints every event, including close
 * codes/reasons - proves whether model/language params are accepted.
 * Run from backend/: npx tsx scripts/deepgram-probe.mts [lang]
 */
import "dotenv/config";
import WebSocket from "ws";

const lang = process.argv[2] || process.env.STT_LANGUAGE || "multi";
const url =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-3" +
  `&language=${lang}` +
  "&smart_format=true&punctuate=true&endpointing=800" +
  "&encoding=linear16&sample_rate=16000&channels=1";

async function main() {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) return console.error("DEEPGRAM_API_KEY missing");
  console.log("Probing:", url.replace("?", "\n   ?"));

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
    const chunks: Buffer[] = [];
    let sent = 0;

    ws.on("open", () => {
      console.log("OPEN ✓ (params accepted by Deepgram)");
      // Stream 1.5s of near-silence in 100ms frames
      const frame = Buffer.alloc(1600 * 2); // 100ms @16k int16
      for (let i = 0; i < 15; i++) {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(frame);
            sent++;
          }
        }, i * 100);
      }
      setTimeout(() => {
        try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch {}
      }, 1700);
    });

    ws.on("message", (raw) => {
      const s = raw.toString();
      console.log("MSG:", s.substring(0, 220));
    });

    ws.on("error", (e) => console.log("ERROR:", e.message));

    ws.on("close", (code, reason) => {
      console.log(`CLOSE code=${code} reason=${reason.toString() || "(none)"} framesSent=${sent}`);
      resolve();
    });

    // Hard stop after 6s
    setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 6000);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });