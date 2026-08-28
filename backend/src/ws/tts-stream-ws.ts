/**
 * TTS WebSocket relay — /ws/tts-stream?voiceId=<id>&model=<id>
 *
 * The JWT arrives in the FIRST client frame ({ type:"config", token, ... })
 * instead of the upgrade URL — JWTs in URLs leak into proxy/access logs.
 *
 * Browser-side WebSocket → this backend → ElevenLabs streaming TTS.
 * Keeps the ELEVENLABS_API_KEY server-side; the browser only sees MP3 bytes
 * and a few JSON control events.
 *
 * Why a relay and not direct browser → ElevenLabs:
 *   - the API key MUST stay on the server (CORS + abuse + revocation)
 *   - the backend can rate-limit + audit per user
 *   - if the upstream is down, the relay surfaces a clean close code so
 *     useSpeakToChat can degrade to text-only (no TTS) without crashing.
 *
 * Protocol:
 *   → first client frame MUST be JSON { type:"config", voiceId?, model?,
 *     chunkSchedule? } (voiceId can also be passed via query string).
 *   → subsequent frames: JSON { text: string, flush?: boolean }
 *   → JSON { text: " " } every 15s acts as a keepalive (ElevenLabs
 *     auto-closes after 20s of inactivity).
 *   → JSON { text: "" } tells ElevenLabs to flush + close its socket.
 *   ← { type:"ready", provider:"elevenlabs" }
 *   ← binary: MP3 audio chunks (default output_format=mp3_22050_32)
 *   ← { type:"error", message } on upstream failure
 *   ← { type:"closed" } when the upstream finishes cleanly
 */

import type { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { createLogger } from "../utils/logger.js";
import { verifyToken } from "./stt-ws.js";
import { resolveRelayVoiceInput } from "../config/voice-personas.js";

const log = createLogger("tts-stream-ws");

const ELEVENLABS_WS_BASE = "wss://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const DEFAULT_CHUNK_SCHEDULE = (process.env.ELEVENLABS_CHUNK_SCHEDULE ||
  "50,120,160,290")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function isTtsEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

interface RelayConfig {
  voiceId: string;
  model: string;
  chunkSchedule: number[];
  outputFormat: string;
  /** "auto" lets ElevenLabs pick the chunk strategy. */
  autoMode: boolean;
}

const DEFAULT_OUTPUT_FORMAT = "mp3_22050_32";

function buildElevenLabsUrl(cfg: RelayConfig): string {
  const params = new URLSearchParams({
    model_id: cfg.model,
    output_format: cfg.outputFormat,
    optimize_streaming_latency: "4", // max streaming optimization
  });
  if (!cfg.autoMode) {
    // Pass a custom chunk schedule; ignored when auto_mode is on.
    params.set(
      "chunk_length_schedule",
      cfg.chunkSchedule.join(","),
    );
  }
  return `${ELEVENLABS_WS_BASE}/${encodeURIComponent(cfg.voiceId)}/stream-input?${params.toString()}`;
}

function handleTtsUpgrade(
  req: import("http").IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const allowAnonDev =
    process.env.STT_ALLOW_ANON_DEV === "true" &&
    /localhost|127\.0\.0\.1/.test(req.headers.host || "");
  const queryVoice = url.searchParams.get("voiceId") || "";
  const queryModel = url.searchParams.get("model") || "";

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    // Auth is deferred to the config frame: JWTs in upgrade URLs leak into
    // proxy and access logs. The frame now carries the token.
    let started = false;

    clientWs.on("message", async (data: unknown, isBinary: boolean) => {
      if (started) return; // post-start frames handled by the session listeners
      if (isBinary) return; // text-only relay before the config frame
      let cfg: {
        type?: string;
        token?: string;
        voiceId?: string;
        model?: string;
        chunkSchedule?: number[];
        autoMode?: boolean;
        outputFormat?: string;
      };
      try {
        cfg = JSON.parse(String(data)) as typeof cfg;
      } catch {
        clientWs.close(4400, "bad_frame");
        return;
      }
      if (cfg.type !== "config") {
        clientWs.close(4400, "config_first");
        return;
      }
      started = true;
      await beginSession(cfg);
    });

    async function beginSession(
      cfg: {
        token?: string;
        voiceId?: string;
        model?: string;
        chunkSchedule?: number[];
        autoMode?: boolean;
        outputFormat?: string;
      },
    ): Promise<void> {
    const token = typeof cfg.token === "string" ? cfg.token : "";
    const auth = await verifyToken(token, allowAnonDev, socket);
    if (!auth) {
      clientWs.close(4401, "unauthorized");
      return;
    }
    if (!isTtsEnabled()) {
      clientWs.close(4003, "tts_disabled");
      return;
    }
    const apiKey = process.env.ELEVENLABS_API_KEY!.trim();

    // Persona id OR raw ElevenLabs id → concrete voice id (or null when
    // nothing is configured).
    const resolvedVoice =
      resolveRelayVoiceInput(cfg.voiceId || queryVoice || DEFAULT_VOICE) ?? "";
    let relayCfg: RelayConfig = {
      voiceId: resolvedVoice,
      model: cfg.model || queryModel || DEFAULT_MODEL,
      chunkSchedule: DEFAULT_CHUNK_SCHEDULE,
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      autoMode: true,
    };
    if (Array.isArray(cfg.chunkSchedule) && cfg.chunkSchedule.length) {
      relayCfg.chunkSchedule = cfg.chunkSchedule.filter(
        (n) => Number.isFinite(n) && n > 0,
      );
      if (relayCfg.chunkSchedule.length) relayCfg.autoMode = false;
    }
    if (typeof cfg.autoMode === "boolean") relayCfg.autoMode = cfg.autoMode;
    if (typeof cfg.outputFormat === "string" && cfg.outputFormat) {
      relayCfg.outputFormat = cfg.outputFormat;
    }
    if (!relayCfg.voiceId) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: "no_voice_id",
          detail:
            "Provide ELEVENLABS_VOICE_ID in env or pass ?voiceId=<persona-id|elevenlabs-id> in the URL.",
        }),
      );
      clientWs.close(4400, "no_voice_id");
      return;
    }

    let upstream: WebSocket | null = null;
    let upstreamReady = false;
    let closed = false;
    const pendingText: Array<{ text: string; flush?: boolean }> = [];

    const cleanup = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      try {
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          // Tell ElevenLabs to flush + close cleanly.
          upstream.send(JSON.stringify({ text: "" }));
        }
      } catch { /* upstream already gone */ }
      try { upstream?.close(); } catch { /* noop */ }
      try {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(code, reason);
        }
      } catch { /* noop */ }
    };

    const connectUpstream = () => {
      const upstreamUrl = buildElevenLabsUrl(relayCfg);
      log.info("TTS relay opening upstream", {
        userId: auth.userId,
        voiceId: relayCfg.voiceId,
        model: relayCfg.model,
      });
      const ws = new WebSocket(upstreamUrl);
      upstream = ws;
      ws.binaryType = "arraybuffer";

      ws.on("open", () => {
        upstreamReady = true;
        // First message MUST contain xi_api_key + voice settings.
        // ElevenLabs will then start streaming audio back as we send text.
        const initMsg = {
          // BOM space is REQUIRED: without a `text` field ElevenLabs treats
          // the first frame as an empty turn and immediately closes with
          // {"audio":null,"isFinal":true} (verified 2026-08-24).
          text: " ",
          xi_api_key: apiKey,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
          generation_config: { chunk_length_schedule: relayCfg.chunkSchedule },
        };
        try {
          ws.send(JSON.stringify(initMsg));
        } catch (err) {
          log.warn("TTS relay upstream init send failed", { err: String(err) });
          try {
            clientWs.send(
              JSON.stringify({ type: "error", message: "upstream_init_failed" }),
            );
          } catch { /* noop */ }
          cleanup(1011, "upstream_init_failed");
          return;
        }

        // Flush queued text messages (the ones that arrived before the
        // upstream was ready).
        for (const msg of pendingText) {
          try { ws.send(JSON.stringify(msg)); } catch { /* socket may have closed */ }
        }
        pendingText.length = 0;

        // Notify the client that audio may start arriving.
        try {
          clientWs.send(
            JSON.stringify({
              type: "ready",
              provider: "elevenlabs",
              voiceId: relayCfg.voiceId,
              model: relayCfg.model,
            }),
          );
        } catch { /* noop */ }
      });

      ws.on("message", (data: unknown, isBinary: boolean) => {
        if (closed) return;
        // ElevenLabs stream-input returns audio as JSON frames shaped
        // {"audio": "<base64 mp3>", "alignment": {...}, ...} — NOT binary
        // frames. Decode and re-forward as binary MP3 to the browser so the
        // client stays a dumb byte pipe.
        try {
          const raw = typeof data === "string" ? data : String(data as Buffer);
          const evt = JSON.parse(raw) as {
            audio?: string;
            error?: string;
            message?: string;
            detail?: string | { status?: string; message?: string };
          };
          if (evt.audio) {
            const buf = Buffer.from(evt.audio, "base64");
            if (buf.length > 0 && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(buf);
            }
            return;
          }
          const detailStatus =
            typeof evt.detail === "object" && evt.detail !== null ? evt.detail.status : undefined;
          if (evt.error || detailStatus === "invalid_api_key") {
            log.warn("TTS upstream error event", { err: String(evt.error ?? detailStatus ?? "") });
            try {
              clientWs.send(
                JSON.stringify({ type: "error", message: String(evt.error ?? evt.detail ?? "upstream_error") }),
              );
            } catch { /* noop */ }
            cleanup(1011, "upstream_error");
            return;
          }
          // Alignment / metadata-only frames: intentionally not forwarded.
        } catch {
          // Binary frame (defensive: some formats emit binary) — forward verbatim.
          if (isBinary && clientWs.readyState === WebSocket.OPEN) {
            try { clientWs.send(data as Buffer); } catch { /* noop */ }
          }
        }
      });

      ws.on("close", (ev: { code: number; reason: string }) => {
        if (closed) return;
        log.info("TTS upstream closed", { code: ev.code, reason: ev.reason });
        // Treat an upstream close as the end of this turn — pass it through
        // so the client's queue can advance.
        try {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "closed", code: ev.code, reason: ev.reason }));
          }
        } catch { /* noop */ }
        cleanup(1000, "upstream_closed");
      });

      ws.on("error", (err: Error) => {
        log.warn("TTS upstream error", { err: err.message });
        try {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "error", message: "upstream_error" }));
          }
        } catch { /* noop */ }
        cleanup(1011, "upstream_error");
      });
    };

    // First frame was consumed by the auth gate; later frames are
    // text payloads ({ text, flush? }) or stray binary (ignored).
    clientWs.on("message", (data: unknown, isBinary: boolean) => {
      if (closed) return;
      if (isBinary) {
        // The relay is text-only on the client side; ignore stray binary
        // frames but don't close — could be a keepalive probe.
        return;
      }
      // Subsequent text frames: { text, flush? }
      let msg: { text?: unknown; flush?: boolean };
      try {
        msg = JSON.parse(String(data)) as { text?: unknown; flush?: boolean };
      } catch {
        return; // ignore malformed
      }
      if (typeof msg.text !== "string") return;
      const payload = { text: msg.text, ...(msg.flush ? { flush: true } : {}) };
      if (upstream && upstreamReady) {
        try { upstream.send(JSON.stringify(payload)); } catch { /* socket may have closed */ }
      } else {
        pendingText.push(payload);
      }
    });

    clientWs.on("close", () => cleanup(1000, "client_closed"));
    clientWs.on("error", () => cleanup(1011, "client_error"));

    // The auth gate consumed the config frame; all settings are merged —
    // open the upstream now.
    connectUpstream();
    }
  });
}

export function attachTtsStreamWebSocket(server: HttpServer): void {
  server.on("upgrade", (req: import("http").IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (() => {
      try { return new URL(req.url || "/", "http://localhost").pathname; }
      catch { return ""; }
    })();
    if (pathname === "/ws/tts-stream") handleTtsUpgrade(req, socket, head);
  });
  if (!isTtsEnabled()) {
    log.warn(
      "TTS stream endpoint attached but ELEVENLABS_API_KEY missing — sessions will close with tts_disabled",
    );
  } else {
    log.info("TTS stream endpoint ready", {
      model: DEFAULT_MODEL,
      voice: DEFAULT_VOICE ? "default" : "(none — must be passed per call)",
    });
  }
}
