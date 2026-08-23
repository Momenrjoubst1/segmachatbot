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
   * Per-frame loudness (Int16-domain RMS) — consumed by the live-voice
   * endpointing detector and barge-in logic. Fires every worklet frame.
   */
  onRms?: (rms: number) => void;
}

interface RelayServerMessage {
  type: "ready" | "partial" | "final";
  text?: string;
}

const MAX_SESSION_MS = 120000;

export class DictationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function fetchSttStatus(): Promise<{ enabled: boolean }> {
  try {
    const mod = await import("@/lib/auth");
    const cfg = await import("@/lib/config");
    const res = await mod.authFetch(cfg.BACKEND_URL + "/api/stt/status");
    if (!res.ok) return { enabled: false };
    return (await res.json()) as { enabled: boolean };
  } catch {
    return { enabled: false };
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

  private finalSegments: string[] = [];
  private interimText = "";

  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: DictationError) => void) | null = null;
  private stopResolve: ((text: string) => void) | null = null;

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
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2. Authenticated WebSocket to the relay
      const [{ BACKEND_URL }] = await Promise.all([
        import("@/lib/config"),
        import("@/lib/supabaseClient"),
      ]);
      const token = await getAccessToken();
      if (!token) throw new DictationError("auth", "Not authenticated");

      const wsBase = BACKEND_URL.replace(/^http/, "ws").replace(/\/+$/, "");
      const ws = new WebSocket(wsBase + "/ws/stt?token=" + encodeURIComponent(token));
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onmessage = (ev) => this.handleServerMessage(ev.data);
      ws.onerror = () => {
        if (this.readyReject) {
          this.readyReject(new DictationError("ws", "STT connection failed"));
        }
      };
      ws.onclose = (ev) => this.handleClose(ev);

      // 3. Wait for relay "ready" before wiring audio
      await ready;

      const ctx = new AudioContext();
      this.audioCtx = ctx;
      await ctx.audioWorklet.addModule("/worklets/pcm-capture-worklet.js");
      const worklet = new AudioWorkletNode(ctx, "pcm-capture-processor");
      this.worklet = worklet;

      worklet.port.onmessage = (
        e: MessageEvent<{ type: string; buffer?: Int16Array }>,
      ) => {
        const msg = e.data;
        if (msg.type === "frame" && msg.buffer) {
          this.callbacks.onEvent?.({ kind: "frame" });
          if (this.callbacks.onRms && ws.readyState === WebSocket.OPEN) {
            const buf = msg.buffer;
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / Math.max(1, buf.length));
            this.callbacks.onRms(rms);
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(msg.buffer);
        }
      };

      const source = ctx.createMediaStreamSource(this.mediaStream);
      source.connect(worklet);
      // Worklet output intentionally not routed to speakers (avoid echo).

      this.sessionTimer = setTimeout(() => {
        void this.stop();
      }, MAX_SESSION_MS);

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
      this.ws?.send(JSON.stringify({ type: "stop" }));
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

  /** Hard abort. */
  abort(): void {
    this.cleanup();
    this.setState("idle");
  }

  private teardownAudio(): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
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