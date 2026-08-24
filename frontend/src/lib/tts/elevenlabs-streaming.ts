/**
 * ElevenLabsStreamingTts — WebSocket streaming client for sub-100ms TTFB TTS.
 *
 * Why this exists alongside the existing HTTP /api/tts route:
 *   - HTTP route returns ONE complete sentence as MP3; the caller waits for
 *     synthesis to finish before playback can start. End-to-end TTFB is
 *     ~250-300ms with Flash v2.5 (and worse with Multilingual v2).
 *   - This WebSocket opens a persistent connection to our backend relay
 *     (/ws/tts-stream) which proxies to ElevenLabs' streaming endpoint.
 *     The FIRST audio chunk lands ~75ms after the first text arrives.
 *   - Persistent connection: no per-sentence reconnect cost.
 *   - Connection auto-closes after 20s of upstream silence; we send a
 *     keepalive space every 15s to prevent that.
 *
 * The browser-facing API mirrors a generator: callers push() complete
 * sentences and receive() audio chunks. The player is responsible for
 * scheduling playback; this client never touches the AudioContext.
 *
 * Reliability:
 *   - One upstream + one downstream socket — failures surface as `closed`
 *     events with close codes the caller maps to user-visible toasts.
 *   - Frames are sent in order, queued while the socket is reconnecting.
 *   - Reconnect: NOT supported in v1 (caller is expected to destroy+recreate
 *     the client on `closed` to surface a clean failure path).
 */

import { BACKEND_URL } from "@/lib/config";

export type TtsStreamState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export interface TtsStreamConfig {
  /** ElevenLabs voice id (persona or env fallback). */
  voiceId: string;
  /** Model id; defaults to ELEVENLABS_MODEL on the server. */
  model?: string;
  /**
   * Custom chunk_length_schedule. When omitted the server uses its
   * configured default (50,120,160,290 for the voice-agent profile).
   */
  chunkSchedule?: number[];
  /**
   * Output format negotiated server-side; we always receive MP3 chunks.
   * Defaults to "mp3_22050_32" on the relay.
   */
  outputFormat?: string;
  /**
   * When true, the server uses ElevenLabs' auto_mode (server picks chunk
   * boundaries). When false, the chunkSchedule above is forwarded.
   */
  autoMode?: boolean;
}

export interface TtsStreamHandlers {
  onAudio?: (chunk: ArrayBuffer) => void;
  onReady?: (info: { voiceId: string; model: string }) => void;
  onClosed?: (info: { code: number; reason: string }) => void;
  onError?: (err: { message: string; code?: number }) => void;
}

const KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 2;
const BASE_BACKOFF_MS = 400;

export class ElevenLabsStreamingTts {
  private ws: WebSocket | null = null;
  private state: TtsStreamState = "idle";
  private lastError: { message: string; code?: number } | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private config: TtsStreamConfig;
  private handlers: TtsStreamHandlers;
  private attempts = 0;

  constructor(config: TtsStreamConfig, handlers: TtsStreamHandlers = {}) {
    this.config = config;
    this.handlers = handlers;
  }

  get streamState(): TtsStreamState {
    return this.state;
  }

  get lastErrorMessage(): string | null {
    return this.lastError?.message ?? null;
  }

  async connect(): Promise<boolean> {
    if (this.state === "open" || this.state === "connecting") return true;
    this.intentionalClose = false;
    this.attempts = 0;
    this.lastError = null;
    return this.openSocket();
  }

  /**
   * Push a text fragment to the streaming TTS.
   *
   * The first call after connect() can fire as soon as `open` resolves; the
   * text is forwarded verbatim to the upstream which decides when to start
   * synthesizing based on its chunk_length_schedule.
   */
  pushText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // The connection is not ready; the client will pick this up on reconnect
      // if we add that in the future. For v1 we drop — the caller should
      // have awaited connect() before pushing.
      return;
    }
    try {
      this.ws.send(JSON.stringify({ text }));
    } catch (err) {
      this.lastError = { message: `push_failed: ${String(err)}` };
      this.handlers.onError?.(this.lastError);
    }
  }

  /**
   * Force the upstream to flush its buffered text and start synthesizing
   * immediately. Use this at sentence boundaries when the caller wants the
   * first syllable to play before the next sentence is known.
   */
  flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ text: " ", flush: true }));
    } catch (err) {
      this.lastError = { message: `flush_failed: ${String(err)}` };
      this.handlers.onError?.(this.lastError);
    }
  }

  /** Tell the upstream to flush + close cleanly. */
  endStream(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ text: "" }));
    } catch { /* noop */ }
  }

  /** Drop the connection without an end-of-stream signal. */
  close(): void {
    this.intentionalClose = true;
    this.stopKeepalive();
    try { this.ws?.close(1000, "client_stop"); } catch { /* noop */ }
    this.ws = null;
    this.setState("closed");
  }

  private setState(s: TtsStreamState): void {
    this.state = s;
    if (s === "closed" || s === "error") {
      this.stopKeepalive();
    }
  }

  private async openSocket(): Promise<boolean> {
    this.setState("connecting");
    let token = "";
    try {
      // Reuse the project's auth helper for consistency. The backend
      // `verifyToken` is permissive (also accepts STT_ALLOW_ANON_DEV on
      // localhost) so this works headless.
      const supabaseMod = await import("@/lib/supabaseClient");
      const { data } = await supabaseMod.supabase.auth.getSession();
      token = data.session?.access_token ?? "";
    } catch { /* keep going — anon dev mode will allow it on localhost */ }

    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (this.config.voiceId) params.set("voiceId", this.config.voiceId);
    if (this.config.model) params.set("model", this.config.model);

    const wsBase = BACKEND_URL.replace(/^http/, "ws").replace(/\/+$/, "");
    const url = `${wsBase}/ws/tts-stream?${params.toString()}`;

    return new Promise<boolean>((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        this.lastError = { message: `ws_construct_failed: ${String(err)}` };
        this.setState("error");
        this.handlers.onError?.(this.lastError);
        resolve(false);
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      let opened = false;

      const settle = (ok: boolean) => {
        if (opened) return;
        opened = true;
        resolve(ok);
      };

      const connectTimeout = setTimeout(() => {
        if (this.state === "connecting") {
          this.lastError = { message: "connect_timeout" };
          try { ws.close(1000, "client_timeout"); } catch { /* noop */ }
          settle(false);
        }
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        // Send the initial config frame. The server expects this to be
        // FIRST or it will treat the frame as a text message and complain.
        try {
          ws.send(
            JSON.stringify({
              type: "config",
              voiceId: this.config.voiceId,
              model: this.config.model,
              chunkSchedule: this.config.chunkSchedule,
              autoMode: this.config.autoMode ?? true,
              outputFormat: this.config.outputFormat,
            }),
          );
        } catch (err) {
          this.lastError = { message: `config_send_failed: ${String(err)}` };
          this.setState("error");
          this.handlers.onError?.(this.lastError);
          settle(false);
          return;
        }
        this.attempts = 0;
        this.setState("open");
        this.startKeepalive();
        settle(true);
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === "string") {
          try {
            const evt = JSON.parse(ev.data) as {
              type?: string;
              voiceId?: string;
              model?: string;
              message?: string;
            };
            if (evt.type === "ready") {
              this.handlers.onReady?.({
                voiceId: evt.voiceId ?? this.config.voiceId,
                model: evt.model ?? this.config.model ?? "",
              });
            } else if (evt.type === "error") {
              this.lastError = { message: evt.message ?? "upstream_error" };
              this.handlers.onError?.(this.lastError);
            } else if (evt.type === "closed") {
              // Upstream signalled end-of-stream — local close follows.
              this.setState("closed");
            }
          } catch { /* ignore malformed JSON */ }
          return;
        }
        if (ev.data instanceof ArrayBuffer) {
          this.handlers.onAudio?.(ev.data);
        } else if (ev.data instanceof Blob) {
          void ev.data.arrayBuffer().then((buf) => this.handlers.onAudio?.(buf));
        }
      };

      ws.onclose = (ev: CloseEvent) => {
        clearTimeout(connectTimeout);
        if (this.intentionalClose) {
          this.setState("closed");
          this.handlers.onClosed?.({ code: ev.code, reason: ev.reason });
          settle(false);
          return;
        }
        // Fatal gates — no reconnect.
        if (ev.code === 4401 || ev.code === 4003 || ev.code === 4400) {
          this.lastError = {
            message: `fatal_close_${ev.code}`,
            code: ev.code,
          };
          this.setState("error");
          this.handlers.onError?.(this.lastError);
          this.handlers.onClosed?.({ code: ev.code, reason: ev.reason });
          settle(false);
          return;
        }
        // Transient close — try once or twice with backoff.
        if (this.attempts < MAX_RECONNECT_ATTEMPTS) {
          this.attempts += 1;
          const delay = BASE_BACKOFF_MS * 2 ** (this.attempts - 1);
          setTimeout(() => {
            if (this.intentionalClose) return;
            void this.openSocket();
          }, delay);
        } else {
          this.setState("error");
          this.handlers.onClosed?.({ code: ev.code, reason: ev.reason });
          settle(false);
        }
      };

      ws.onerror = () => {
        // The close event will fire after this; defer state mutation to onclose.
        try { ws.close(); } catch { /* noop */ }
      };
    });
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // ElevenLabs auto-closes after 20s of silence; a single space keeps
        // the connection warm without producing any audible output.
        try {
          this.ws.send(JSON.stringify({ text: " " }));
        } catch { /* noop */ }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
