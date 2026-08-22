/**
 * Deepgram STT Relay Session
 *
 * Manages ONE client dictation session:
 *   browser WS  ⇄  this relay  ⇄  Deepgram live WS (nova-3)
 *
 * - Browser sends binary frames (PCM16 LE @16kHz mono) and a first JSON
 *   config frame {type:"config", sampleRate}.
 * - Relay opens Deepgram with linear16 params, forwards audio verbatim,
 *   converts Deepgram Results into compact {type:"partial"|"final", text}
 *   JSON frames for the client.
 * - Hard limits: session duration, one concurrent session per user, daily
 *   minutes budget in Redis. Audio is piped only — never stored.
 */

import WebSocket from "ws";
import { createLogger } from "../../utils/logger.js";
import redis from "../../config/redis/client.js";

const log = createLogger("stt-relay");

const DEEPGRAM_WS_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-3&language=multi&smart_format=true&punctuate=true" +
  "&endpointing=800&encoding=linear16&sample_rate=16000&channels=1";

const MAX_SESSION_MS =
  parseInt(process.env.STT_MAX_SESSION_SECONDS || "120", 10) * 1000;
export const DAILY_MINUTES_LIMIT = parseInt(
  process.env.STT_DAILY_MINUTES_LIMIT || "30",
  10,
);

export interface RelaySessionEvents {
  onText(type: "partial" | "final", text: string): void;
  onClose(code: number, reason: string): void;
}

function todayKey(userId: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `stt:minutes:${userId}:${ymd}`;
}

/** Seconds already used today (best-effort; Redis failure = allow). */
async function getUsedSecondsToday(userId: string): Promise<number> {
  try {
    const v = await redis.get(todayKey(userId));
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

async function addUsedSeconds(userId: string, seconds: number): Promise<void> {
  try {
    const key = todayKey(userId);
    const used = await getUsedSecondsToday(userId);
    // Non-atomic by design: MockRedis lacks MULTI and exact-to-the-second
    // metering doesn't need it. TTL rolls over naturally per UTC day.
    await redis.set(
      key,
      String(Math.round(used + Math.max(1, seconds))),
      "EX",
      172_800,
    );
  } catch (err) {
    log.warn("Failed to record STT usage", { error: (err as Error).message });
  }
}

export class SttRelaySession {
  private readonly userId: string;
  private readonly clientWs: WebSocket;
  private deepgramWs: WebSocket | null = null;
  private sessionTimer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private closed = false;

  constructor(userId: string, clientWs: WebSocket, sampleRateHint: number, events: RelaySessionEvents) {
    this.userId = userId;
    this.clientWs = clientWs;
    this.openDeepgram(sampleRateHint, events);
    this.armSessionTimer(events);
  }

  /** Entry point used by the WS server after auth + concurrency gate. */
  static async canOpenSession(userId: string): Promise<{ ok: boolean; code?: number; reason?: string }> {
    const used = await getUsedSecondsToday(userId);
    if (used >= DAILY_MINUTES_LIMIT * 60) {
      return { ok: false, code: 4029, reason: "daily_limit_reached" };
    }
    return { ok: true };
  }

  static async concurrentKey(userId: string): Promise<string> {
    return `stt:active:${userId}`;
  }

  handleClientMessage(data: unknown, isBinary: boolean): void {
    if (this.closed) return;
    if (!isBinary) {
      // Client may send {type:"stop"} to finish gracefully
      try {
        const msg = JSON.parse(String(data)) as { type?: string };
        if (msg.type === "stop") this.close(1000, "client_stop");
      } catch { /* ignore malformed control frames */ }
      return;
    }
    if (this.deepgramWs?.readyState === WebSocket.OPEN) {
      this.deepgramWs.send(data as Buffer);
    }
  }

  close(code = 1000, reason = "server_close"): void {
    if (this.closed) return;
    this.closed = true;

    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    void addUsedSeconds(this.userId, elapsedSec);

    try { this.clientWs.close(code, reason.slice(0, 120)); } catch { /* noop */ }
    try {
      this.deepgramWs?.send(JSON.stringify({ type: "CloseStream" }));
      this.deepgramWs?.close(1000);
    } catch { /* noop */ }
    log.info("STT session closed", { userId: this.userId, seconds: Math.round(elapsedSec), reason });
  }

  private openDeepgram(_sampleRateHint: number, events: RelaySessionEvents): void {
    const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
    if (!apiKey) {
      events.onClose(4003, "stt_disabled");
      this.closed = true;
      return;
    }

    const dg = new WebSocket(DEEPGRAM_WS_URL, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    dg.on("open", () => {
      this.deepgramWs = dg;
      log.info("Deepgram stream opened", { userId: this.userId });
    });

    dg.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          is_final?: boolean;
          channel?: { alternatives?: Array<{ transcript?: string }> };
        };
        if (msg.type !== "Results") return;
        const transcript =
          msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!transcript) return;
        events.onText(msg.is_final ? "final" : "partial", transcript);
        if (!this.closed && this.clientWs.readyState === WebSocket.OPEN) {
          this.clientWs.send(JSON.stringify({ type: msg.is_final ? "final" : "partial", text: transcript }));
        }
      } catch { /* ignore malformed upstream frames */ }
    });

    dg.on("error", (err) => {
      log.warn("Deepgram stream error", { error: err.message });
      events.onClose(4502, "upstream_error");
      this.close(4502, "upstream_error");
    });

    dg.on("close", (code) => {
      if (!this.closed) {
        events.onClose(1000, "upstream_closed");
        this.close(1000, "upstream_closed");
      } else {
        log.info("Deepgram stream closed", { code });
      }
    });
  }

  private armSessionTimer(events: RelaySessionEvents): void {
    this.sessionTimer = setTimeout(() => {
      events.onClose(4028, "max_session_duration");
      this.close(4028, "max_session_duration");
    }, MAX_SESSION_MS);
  }
}