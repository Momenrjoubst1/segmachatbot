// Relays browser dictation sessions to a Deepgram live STT stream with usage limits; audio is never stored.

import WebSocket from "ws";
import { createLogger } from "../../utils/logger.js";
import redis from "../../config/redis/client.js";

const log = createLogger("stt-relay");

/**
 * STT language is ARABIC-FIRST for this product. nova-3's `multi` code-
 * switching mode is ENGLISH/SPANISH ONLY — feeding it Levantine Arabic
 * yields transliterated gibberish or empty transcripts (verified against
 * the live API 2026-08-24: `nova-3&language=ar` returns perfect Arabic).
 * `language=ar` covers MSA + dialects; English utterances still transcribe
 * acceptably under the ar model. Override via env if that ever changes.
 */
export const STT_MODEL = process.env.STT_DEEPGRAM_MODEL?.trim() || "nova-3";
export const STT_LANGUAGE = process.env.STT_DEEPGRAM_LANGUAGE?.trim() || "ar";

/** Query shared by the relay and the direct browser→Deepgram path. */
export function buildListenQuery(): string {
  return (
    `model=${encodeURIComponent(STT_MODEL)}` +
    `&language=${encodeURIComponent(STT_LANGUAGE)}` +
    "&smart_format=true&punctuate=true" +
    // interim_results: words stream to the composer WHILE the user speaks —
    // without it Deepgram stays silent until its own endpointing fires.
    "&interim_results=true" +
    "&endpointing=800&encoding=linear16&channels=1"
  );
}

/**
 * The stream MUST be labeled with the audio's TRUE rate. The browser
 * downsamples to 16 kHz when its context runs faster, but narrowband mics
 * (Bluetooth HFP runs at 8/16 kHz) pass through at their native rate —
 * mislabeled audio is time-stretched for Deepgram and transcribes to
 * NOTHING. The client reports its real post-decimation rate in the config
 * frame; this builds the matching URL.
 */
function buildListenUrl(sampleRate: number): string {
  const rate = Number.isFinite(sampleRate) && sampleRate >= 4000 && sampleRate <= 96_000
    ? Math.round(sampleRate)
    : 16_000;
  return (
    "wss://api.deepgram.com/v1/listen" +
    `?${buildListenQuery()}&sample_rate=${rate}`
  );
}

// Hands-free sessions run until the USER stops them; the cap exists to
// recycle sockets/billing windows, not to end conversations. The client
// reopens transparently on 4028, so longer caps just mean fewer renewals.
const MAX_SESSION_MS =
  parseInt(process.env.STT_MAX_SESSION_SECONDS || "300", 10) * 1000;
export const DAILY_MINUTES_LIMIT = parseInt(
  process.env.STT_DAILY_MINUTES_LIMIT || "30",
  10,
);

export interface RelaySessionEvents {
  onClose(code: number, reason: string): void;
}

function todayKey(userId: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `stt:minutes:${userId}:${ymd}`;
}

/** Seconds already used today (best-effort; Redis failure = allow). */
export async function getUsedSecondsToday(userId: string): Promise<number> {
  try {
    const v = await redis.get(todayKey(userId));
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

/** Record direct-session usage reported by the client (best-effort). */
export async function addUsedSeconds(userId: string, seconds: number): Promise<void> {
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
  private bytesForwarded = 0;
  private deepgramReady = false;
  private pendingAudio: Buffer[] = [];
  private dgResultsCount = 0;
  private lastStatsSentAt = 0;
  private static readonly MAX_PENDING_BYTES = 5 * 1024 * 1024;

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
      try {
        const msg = JSON.parse(String(data)) as { type?: string };
        if (msg.type === "stop") { this.close(1000, "client_stop"); return; }
        // Finalize: ask Deepgram to emit the is_final Results for audio
        // processed so far, RIGHT NOW. The client's turn-end uses this so
        // the transcript arrives in ~100ms instead of waiting out Deepgram's
        // 800ms endpointing — and the session stays open for the next turn.
        if (msg.type === "finalize") {
          if (this.deepgramReady && this.deepgramWs?.readyState === WebSocket.OPEN) {
            this.deepgramWs.send(JSON.stringify({ type: "Finalize" }));
          }
          return;
        }
      } catch { /* ignore malformed control frames */ }
      return;
    }
    if (this.deepgramReady && this.deepgramWs?.readyState === WebSocket.OPEN) {
      const buf = data as Buffer;
      this.bytesForwarded += buf.length;
      this.deepgramWs.send(buf);
    } else {
      // Deepgram handshake still in flight — buffer so the FIRST words are
      // never dropped (leading-speech loss). Bounded for memory safety.
      const buf = data as Buffer;
      const pendingBytes = this.pendingAudio.reduce((a, b) => a + b.length, 0);
      if (pendingBytes + buf.length <= SttRelaySession.MAX_PENDING_BYTES) {
        this.pendingAudio.push(buf);
      } else {
        log.warn("STT pending buffer overflow — dropping frame", { userId: this.userId });
      }
    }
  }

  close(code = 1000, reason = "server_close"): void {
    if (this.closed) return;
    this.closed = true;

    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    void addUsedSeconds(this.userId, elapsedSec);

    try {
      if (this.clientWs.readyState === WebSocket.OPEN) {
        // Final usage frame so clients/tests can verify the audio actually
        // traversed the relay to Deepgram.
        this.clientWs.send(
          JSON.stringify({
            type: "usage",
            seconds: Math.round(elapsedSec),
            bytesForwarded: this.bytesForwarded,
          }),
        );
      }
      this.clientWs.close(code, reason.slice(0, 120));
    } catch { /* noop */ }
    try {
      this.deepgramWs?.send(JSON.stringify({ type: "CloseStream" }));
      this.deepgramWs?.close(1000);
    } catch { /* noop */ }
    log.info("STT session closed", {
      userId: this.userId,
      seconds: Math.round(elapsedSec),
      reason,
      bytesForwarded: this.bytesForwarded,
    });
  }

  private openDeepgram(sampleRateHint: number, events: RelaySessionEvents): void {
    const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
    if (!apiKey) {
      events.onClose(4003, "stt_disabled");
      this.closed = true;
      return;
    }

    const dg = new WebSocket(buildListenUrl(sampleRateHint), {
      headers: { Authorization: `Token ${apiKey}` },
    });

    dg.on("open", () => {
      this.deepgramWs = dg;
      this.deepgramReady = true;
      // Flush audio buffered during the handshake (leading speech!)
      for (const buf of this.pendingAudio) {
        if (dg.readyState === WebSocket.OPEN) {
          this.bytesForwarded += buf.length;
          dg.send(buf);
        }
      }
      const flushed = this.pendingAudio.length;
      this.pendingAudio = [];
      log.info("Deepgram stream opened", { userId: this.userId, bufferedFramesFlushed: flushed });
    });

    dg.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          is_final?: boolean;
          channel?: { alternatives?: Array<{ transcript?: string }> };
        };
        if (msg.type !== "Results") return;
        this.dgResultsCount += 1;
        const transcript =
          msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!transcript) {
          // Deepgram heard the stream but recognized no speech — surface a
          // periodic heartbeat so clients can distinguish "no audio" from
          // "audio present but untranscribable".
          const now = Date.now();
          if (now - this.lastStatsSentAt > 2000 && this.clientWs.readyState === WebSocket.OPEN) {
            this.lastStatsSentAt = now;
            this.clientWs.send(JSON.stringify({
              type: "dg_stats",
              results: this.dgResultsCount,
              bytesForwarded: this.bytesForwarded,
            }));
          }
          return;
        }
        // Transcripts go straight to the client — the onText event hook was
        // a redundant notification nobody consumed.
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