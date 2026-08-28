// End-to-end STT relay test: connect to /ws/stt, stream a 440 Hz tone, assert ready + Deepgram transcripts.
import "dotenv/config";
import WebSocket from "ws";

const BASE = process.env.BACKEND_WS || "ws://localhost:3004";
const URL_ = `${BASE}/ws/stt`;
// JWT rides in the config frame now (URLs leak into logs).
const TOKEN = process.argv[2] ?? "";

function toneFrame(freq: number, seconds: number, rate = 16000): Buffer {
  const n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000);
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

async function main() {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(URL_);
    let ready = false;
    let transcripts = 0;
    const samples: string[] = [];
    let bytesSent = 0;

    ws.on("open", () => {
      console.log("WS OPEN ✓");
      ws.send(JSON.stringify({ type: "config", sampleRate: 16000, token: TOKEN }));
      // Stream the tone in 100 ms frames over ~4 s
      let sent = 0;
      const iv = setInterval(() => {
        if (sent >= 40 || ws.readyState !== WebSocket.OPEN) {
          clearInterval(iv);
          setTimeout(() => {
            try { ws.send(JSON.stringify({ type: "stop" })); } catch {}
          }, 600);
          return;
        }
        const f = toneFrame(440, 0.1);
        bytesSent += f.length;
        ws.send(f);
        sent++;
      }, 100);
    });

    let usage: { seconds?: number; bytesForwarded?: number } | null = null;

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string; text?: string;
          seconds?: number; bytesForwarded?: number;
        };
        if (msg.type === "ready") { ready = true; console.log("READY ✓ (relay authenticated & Deepgram enabled)"); }
        else if (msg.type === "usage") { usage = msg; }
        else if ((msg.type === "partial" || msg.type === "final") && msg.text) {
          transcripts++;
          if (samples.length < 5) samples.push(`[${msg.type}] ${msg.text}`);
        } else {
          console.log("MSG:", raw.toString().substring(0, 140));
        }
      } catch { /* ignore */ }
    });

    ws.on("close", (code, reason) => {
      const u = usage as { seconds?: number; bytesForwarded?: number } | null;
      console.log(`CLOSE code=${code} reason=${reason.toString() || "-"} ready=${ready} bytesSent=${bytesSent} transcriptFrames=${transcripts}`);
      console.log(
        u
          ? `USAGE ✓ seconds=${u.seconds} bytesForwarded=${u.bytesForwarded} -> ${
              u.bytesForwarded === bytesSent ? "PIPE VERIFIED ✓" : "MISMATCH ✗"
            }`
          : "usage frame MISSING ✗",
      );
      if (samples.length) console.log("Samples:", samples.join(" | "));
      resolve();
    });

    ws.on("error", (e) => { console.log("ERROR:", e.message); });

    // Hard stop after 10 s
    setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 10_000);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });