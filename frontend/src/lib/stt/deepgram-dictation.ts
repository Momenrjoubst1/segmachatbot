/**
 * Deepgram dictation controller - browser side of the STT pipeline.
 *
 * Flow:
 *   getUserMedia -> AudioContext -> AudioWorklet (PCM16 @16 kHz)
 *     -> WebSocket /ws/stt?token=JWT (binary frames)
 *       -> backend relay -> Deepgram Nova-3
 *   <- {"type":"partial"|"final", text} -> onInterim/onFinalSegment
 */

export type DictationState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export interface DictationCallbacks {
  onStateChange?: (state: DictationState) => void;
  /** Rolling interim transcript for the CURRENT utterance. */
  onInterim?: (text: string) => void;
  /** A finalized segment (sentence/phrase). */
  onFinalSegment?: (text: string) => void;
  /** Low-level diagnostic events for debugging overlays. */
  onEvent?: (evt: { kind: string; detail?: string }) => void;
  /**
   * Per-frame loudness (Int16-domain RMS) + zero-crossing rate [0,1] —
   * consumed by the live-voice endpointer (speech gate + noise rejection).
   * endpointing detector and barge-in logic. Fires every worklet frame.
   */
  onRms?: (rms: number, zcr?: number) => void;
  /**
   * Optional gate consulted per frame BEFORE RMS/send work. True = drop the
   * frame client-side (mute / half-duplex): nothing leaves the device and
   * downstream detectors stay quiet for the gated period.
   */
  gateFrame?: () => boolean;
}

interface RelayServerMessage {
  type: "ready" | "partial" | "final" | "dg_stats" | "usage";
  text?: string;
  results?: number;
  bytesForwarded?: number;
  seconds?: number;
}

const MAX_SESSION_MS = 120000;

export class DictationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function fetchSttStatus(): Promise<{
  enabled: boolean;
  direct?: boolean;
  listenQuery?: string;
  model?: string;
}> {
  try {
    const mod = await import("@/lib/auth");
    const cfg = await import("@/lib/config");
    const res = await mod.authFetch(cfg.BACKEND_URL + "/api/stt/status");
    if (!res.ok) return { enabled: false };
    return (await res.json()) as { enabled: boolean; direct?: boolean; listenQuery?: string };
  } catch {
    return { enabled: false };
  }
}

/**
 * Ephemeral Deepgram grant token for the DIRECT streaming path. All limits
 * were enforced server-side at grant time; a failed fetch just means the
 * caller falls back to the backend relay.
 */
async function fetchSttEphemeralToken(): Promise<string | null> {
  try {
    const mod = await import("@/lib/auth");
    const cfg = await import("@/lib/config");
    const res = await mod.authFetch(cfg.BACKEND_URL + "/api/stt/token");
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string> {
  const { supabase } = await import("@/lib/supabaseClient");
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export class DictationController {
  private state: DictationState = "idle";
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  /** Live audio pieces for visualizers (ambience controller). Null when off. */
  get audioContextRef(): AudioContext | null {
    return this.audioCtx;
  }
  get mediaStreamRef(): MediaStream | null {
    return this.mediaStream;
  }

  private finalSegments: string[] = [];
  private interimText = "";

  /** True while streaming browser→Deepgram directly (no backend relay). */
  private directMode = false;
  private sessionStartedAt = 0;
  private usageReported = false;
  private lastKeepAliveSentAt = 0;

  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: DictationError) => void) | null = null;
  private stopResolve: ((text: string) => void) | null = null;
  private finalizeResolve: (() => void) | null = null;

  constructor(private callbacks: DictationCallbacks = {}) {}

  private setState(s: DictationState): void {
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  getState(): DictationState {
    return this.state;
  }

  /** Full transcript accumulated so far in this session. */
  getTranscript(): string {
    const finals = this.finalSegments.join(" ").trim();
    return this.interimText
      ? [finals, this.interimText].filter(Boolean).join(" ")
      : finals;
  }

  async start(): Promise<void> {
    if (this.state !== "idle") return;
    this.setState("starting");

    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    try {
      // 1. Microphone
      const storedDeviceId =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("sigma_selected_mic_device") || undefined
          : undefined;

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: storedDeviceId ? { exact: storedDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2a. Prefer the DIRECT browser→Deepgram stream: an ephemeral grant
      // token skips both relay hops, so interim words trail live speech by
      // roughly half the round-trip. ANY failure here falls back to the
      // backend relay below — same features, two extra network legs.
      let direct: { listenQuery: string; token: string } | null = null;
      try {
        const st = await fetchSttStatus();
        if (st.enabled && st.direct && st.listenQuery) {
          const grantToken = await fetchSttEphemeralToken();
          if (grantToken) direct = { listenQuery: st.listenQuery, token: grantToken };
        }
      } catch { /* relay fallback */ }

      const [{ BACKEND_URL }] = await Promise.all([
        import("@/lib/config"),
        import("@/lib/supabaseClient"),
      ]);
      const wsBase = BACKEND_URL.replace(/^http/, "ws").replace(/\/+$/, "");

      let ws: WebSocket;
      if (direct) {
        this.directMode = true;
        // The AudioContext must exist FIRST: its true post-decimation rate is
        // part of the Deepgram URL (mislabeled rates transcribe to nothing).
        this.audioCtx = new AudioContext();

        // Browser WebSockets cannot set Authorization headers — Deepgram's
        // documented browser auth rides the subprotocol instead.
        ws = new WebSocket(
          `wss://api.deepgram.com/v1/listen?${direct.listenQuery}&sample_rate=${this.wireRate()}`,
          ["token", direct.token],
        );
        ws.binaryType = "arraybuffer";
        this.ws = ws;
        ws.onmessage = (ev) => this.handleDeepgramMessage(ev.data);
        ws.onerror = () => {
          if (this.readyReject && !this.readyResolveDone) {
            this.readyReject(new DictationError("ws", "Direct STT connection failed"));
          }
        };
        ws.onclose = (ev) => this.handleClose(ev);
        const connectTimeout = setTimeout(() => {
          try { ws.close(4000, "connect_timeout"); } catch { /* noop */ }
        }, 10_000);
        ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.readyResolveDone = true;
          this.callbacks.onEvent?.({ kind: "relay_ready", detail: "direct" });
          this.readyResolve?.();
        };
      } else {
        // 2b. Authenticated WebSocket to the backend relay
        const token = await getAccessToken();
        if (!token) throw new DictationError("auth", "Not authenticated");

        ws = new WebSocket(wsBase + "/ws/stt?token=" + encodeURIComponent(token));
        ws.binaryType = "arraybuffer";
        this.ws = ws;

        ws.onmessage = (ev) => this.handleServerMessage(ev.data);
        ws.onerror = () => {
          if (this.readyReject) {
            this.readyReject(new DictationError("ws", "STT connection failed"));
          }
        };
        ws.onclose = (ev) => this.handleClose(ev);
      }

      // 3. Ready gate: relay sends {type:"ready"}; direct opens the socket.
      await ready;

      const ctx = this.audioCtx ?? new AudioContext();
      this.audioCtx = ctx;

      if (!direct) {
        // Label the stream with the TRUE post-decimation rate (see comment
        // above — mislabeled narrowband mics transcribe to nothing). Direct
        // mode already baked the rate into its URL.
        const nativeRate = ctx.sampleRate;
        const outputRate = nativeRate >= 16000 ? 16000 : Math.round(nativeRate);
        const trackLabel = this.mediaStream?.getAudioTracks()[0]?.label ?? "unknown-device";
        this.callbacks.onEvent?.({
          kind: "mic_config",
          detail: `${trackLabel} native=${nativeRate} -> wire=${outputRate}`,
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "config", sampleRate: outputRate }));
        }
      }

      await ctx.audioWorklet.addModule("/worklets/pcm-capture-worklet.js");
      const worklet = new AudioWorkletNode(ctx, "pcm-capture-processor");
      this.worklet = worklet;

      worklet.port.onmessage = (
        e: MessageEvent<{ type: string; buffer?: Int16Array }>,
      ) => {
        const msg = e.data;
        if (msg.type === "frame" && msg.buffer) {
          this.callbacks.onEvent?.({ kind: "frame" });
          if (this.callbacks.gateFrame?.()) {
            // Gated frames (mute / half-duplex) starve the DIRECT socket and
            // Deepgram drops idle streams — KeepAlive keeps it warm with
            // zero audio leaving the device.
            if (
              this.directMode &&
              ws.readyState === WebSocket.OPEN &&
              Date.now() - this.lastKeepAliveSentAt > 5000
            ) {
              this.lastKeepAliveSentAt = Date.now();
              try { ws.send(JSON.stringify({ type: "KeepAlive" })); } catch { /* noop */ }
            }
            return;
          }
          if (this.callbacks.onRms && ws.readyState === WebSocket.OPEN) {
            const buf = msg.buffer;
            let sum = 0;
            let crossings = 0;
            for (let i = 0; i < buf.length; i++) {
              sum += buf[i] * buf[i];
              // Zero-crossing rate: sign flips per sample. Speech waveforms
              // cross rarely (voiced fundamentals); hiss/fans cross constantly.
              if ((buf[i] >= 0) !== (buf[i + 1 < buf.length ? i + 1 : i] >= 0)) {
                crossings++;
              }
            }
            const rms = Math.sqrt(sum / Math.max(1, buf.length));
            const zcr = crossings / Math.max(1, buf.length);
            this.callbacks.onRms(rms, zcr);
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(msg.buffer);
        }
      };

      const source = ctx.createMediaStreamSource(this.mediaStream);
      source.connect(worklet);
      // Worklet output intentionally not routed to speakers (avoid echo).

      // The processor gates on an explicit start message (enabled=false in
      // its constructor) — without this, NO frames are ever captured.
      worklet.port.postMessage({ type: "start", targetRate: 16000 });

      this.sessionTimer = setTimeout(() => {
        void this.stop();
      }, MAX_SESSION_MS);

      this.sessionStartedAt = Date.now();
      this.usageReported = false;
      this.setState("recording");
    } catch (err) {
      const e =
        err instanceof DictationError ? err : new DictationError("mic", String((err as Error).message));
      this.teardownAudio();
      try { this.ws?.close(); } catch { /* noop */ }
      this.ws = null;
      this.setState("error");
      throw e;
    }
  }

  private handleClose(ev: CloseEvent): void {
    const known: Record<number, string> = {
      4401: "auth",
      4003: "disabled",
      4028: "max_duration",
      4029: "limit",
    };
    const reason = ev.reason || known[ev.code] || "closed";
    this.callbacks.onEvent?.({ kind: "ws_close", detail: `${ev.code} ${reason}` });

    // If we were waiting for "ready" when the socket died -> start failed.
    if (this.readyReject && !this.readyResolveDone) {
      const r = this.readyReject;
      this.readyResolve = null;
      this.readyReject = null;
      r(new DictationError("ws_" + ev.code, reason));
    }

    if (this.stopResolve) {
      const r = this.stopResolve;
      this.stopResolve = null;
      r(this.getTranscript());
    }

    this.teardownAudio();
    if (this.state === "recording" || this.state === "stopping") {
      this.finalSegments = [];
      this.interimText = "";
      this.setState("idle");
    }
  }

  private readyResolveDone = false;

  private handleServerMessage(raw: unknown): void {
    let msg: RelayServerMessage;
    try {
      msg = JSON.parse(String(raw)) as RelayServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        this.readyResolveDone = true;
        this.callbacks.onEvent?.({ kind: "relay_ready" });
        this.readyResolve?.();
        break;
      case "partial":
        this.callbacks.onEvent?.({ kind: "partial", detail: msg.text });
        this.interimText = msg.text ?? "";
        this.callbacks.onInterim?.(this.interimText);
        break;
      case "final":
        this.callbacks.onEvent?.({ kind: "final", detail: msg.text });
        if (msg.text) {
          this.finalSegments.push(msg.text);
          this.interimText = "";
          this.callbacks.onFinalSegment?.(msg.text);
        }
        // A finalize() request completes on the first final that lands.
        this.finalizeResolve?.();
        break;
      case "dg_stats":
        this.callbacks.onEvent?.({ kind: "dg_stats", detail: `results=${msg.results} bytes=${msg.bytesForwarded}` });
        break;
    }
  }

  /** Graceful stop: closes stream, resolves with full transcript. */
  async stop(): Promise<string> {
    if (this.state !== "recording" && this.state !== "stopping") {
      return this.getTranscript();
    }
    this.setState("stopping");

    const textPromise = new Promise<string>((resolve) => {
      this.stopResolve = resolve;
    });
    try {
      this.ws?.send(
        JSON.stringify(this.directMode ? { type: "CloseStream" } : { type: "stop" }),
      );
    } catch { /* close handler resolves instead */ }

    // Safety timeout so a dead socket can't hang the UI
    setTimeout(() => {
      if (this.stopResolve) {
        const r = this.stopResolve;
        this.stopResolve = null;
        r(this.getTranscript());
        try { this.ws?.close(); } catch { /* noop */ }
      }
    }, 2500);

    const text = await textPromise;
    this.cleanup();
    this.setState("idle");
    return text;
  }

  /**
   * Ask Deepgram to finalize the audio processed so far RIGHT NOW and
   * resolve with the transcript as soon as the final lands (~100-200ms),
   * instead of waiting out its 800ms endpointing. The session STAYS OPEN —
   * the next turn keeps streaming into the same socket. Falls back to
   * whatever is accumulated after `timeoutMs`.
   */
  finalize(timeoutMs = 1200): Promise<string> {
    if (this.state !== "recording") return Promise.resolve(this.getTranscript());
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.finalizeResolve = null;
        clearTimeout(timer);
        resolve(this.getTranscript());
      };
      this.finalizeResolve = finish;
      const timer = setTimeout(finish, timeoutMs);
      try {
        this.ws?.send(JSON.stringify({ type: "finalize" }));
      } catch {
        finish();
      }
    });
  }

  /** Hard abort. */
  abort(): void {
    this.cleanup();
    this.setState("idle");
  }

  /**
   * Parse a RAW Deepgram Results frame (direct browser→Deepgram mode — the
   * relay normally compiles these into {partial|final} for us).
   */
  private handleDeepgramMessage(raw: unknown): void {
    let msg: {
      type?: string;
      is_final?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string }> };
    };
    try {
      msg = JSON.parse(String(raw));
    } catch { return; }
    if (msg.type !== "Results") return;
    const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!text) return;
    if (msg.is_final) {
      this.finalSegments.push(text);
      this.interimText = "";
      this.callbacks.onFinalSegment?.(text);
      // A finalize() request completes on the first final that lands.
      this.finalizeResolve?.();
    } else {
      this.interimText = text;
      this.callbacks.onInterim?.(text);
    }
  }

  /** True post-decimation wire rate (16k cap, never upsampling narrowband). */
  private wireRate(): number {
    const ctx = this.audioCtx;
    if (!ctx) return 16000;
    const native = ctx.sampleRate;
    return native >= 16000 ? 16000 : Math.round(native);
  }

  /**
   * Direct sessions bypass the relay, so nothing meters their lifetime
   * server-side — report elapsed seconds ONCE per session, best-effort and
   * clamped again server-side. Also frees the concurrency slot.
   */
  private reportUsageOnce(): void {
    if (!this.directMode || !this.sessionStartedAt || this.usageReported) return;
    this.usageReported = true;
    const seconds = Math.max(0, Math.round((Date.now() - this.sessionStartedAt) / 1000));
    void (async () => {
      try {
        const mod = await import("@/lib/auth");
        const cfg = await import("@/lib/config");
        await mod.authFetch(cfg.BACKEND_URL + "/api/stt/usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds }),
        });
      } catch { /* best-effort */ }
    })();
  }

  private teardownAudio(): void {
    this.reportUsageOnce();
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    try { this.worklet?.port.postMessage({ type: "stop" }); } catch { /* noop */ }
    try { this.worklet?.disconnect(); } catch { /* noop */ }
    try { void this.audioCtx?.close(); } catch { /* noop */ }
    this.worklet = null;
    this.audioCtx = null;
    this.mediaStream?.getTracks().forEach((tr) => tr.stop());
    this.mediaStream = null;
  }

  private cleanup(): void {
    this.teardownAudio();
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    this.finalSegments = [];
    this.interimText = "";
    this.readyResolveDone = false;
  }
}