/**
 * AgentVoiceSocket — browser side of the /ws/voice-agent relay.
 *
 * The relay owns the Deepgram connection and the Settings message; this
 * client only speaks the relay protocol:
 *   → binary PCM16/16k mic frames
 *   → JSON {type:"close"} to end gracefully
 *   ← JSON agent events (Welcome, SettingsApplied, ConversationText,
 *     UserStartedSpeaking, AgentThinking, AgentAudioDone, Error, …)
 *   ← binary PCM16/24k reply audio
 *
 * Robustness contract:
 * - Mic frames are BUFFERED while the socket is down (bounded window) and
 *   flushed on reopen — a reconnect gap no longer silently swallows speech.
 * - Close codes map to distinct error kinds so the UI can react properly:
 *   auth/disabled are fatal; already_streaming ("busy") retries on a delay;
 *   duration/daily caps end the session GRACEFULLY (not as an error).
 */

export type AgentConnState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export type AgentErrorKind =
  | "think"
  | "auth"
  | "disabled"
  /** Another live session owns this user's slot — retried, then surfaced. */
  | "busy"
  /** Session ended by a policy cap (duration/daily) — not an error. */
  | "session_end"
  /** No events for too long — engine stalled. */
  | "stalled"
  | "connection"
  | "unknown";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentVoiceSocketHandlers {
  onEvent?: (event: AgentEvent) => void;
  onAudio?: (chunk: ArrayBuffer) => void;
  onStateChange?: (state: AgentConnState, errorKind?: AgentErrorKind) => void;
}

const MAX_RECONNECT_ATTEMPTS = 4;
/** Extra attempts granted specifically to the busy (slot-conflict) path. */
const MAX_BUSY_RETRIES = 2;
const BASE_BACKOFF_MS = 600;
/**
 * ~100 ms mic frames ⇒ ~5 s of speech held while disconnected. Oldest frames
 * drop first: recent context beats stale audio for turn-taking.
 */
const MAX_BUFFERED_FRAMES = 50;

/** Exported for tests — close-code → error-kind mapping is contract. */
export function classifyClose(code: number, reason: string): AgentErrorKind {
  const r = reason.toLowerCase();
  if (code === 4401 || r.includes("unauthorized") || r.includes("auth")) return "auth";
  if (code === 4003 || r.includes("disabled")) return "disabled";
  // Distinguish the two things that share close code 4029 server-side.
  if (r.includes("daily_limit")) return "session_end";
  if (code === 4029 && r.includes("already_streaming")) return "busy";
  if (
    code === 4028 ||
    code === 4408 ||
    r.includes("max_session") ||
    r.includes("client_timeout")
  ) {
    return "session_end";
  }
  if (r.includes("limit")) return "session_end";
  return "connection";
}

function classifyErrorEvent(evt: AgentEvent): AgentErrorKind {
  const detail = String(
    evt.description ?? evt.message ?? evt.reason ?? "",
  );
  if (/THINK_REQUEST_FAILED|FAILED_TO_THINK/i.test(detail)) return "think";
  if (/UNAUTHORIZED|API_KEY/i.test(detail)) return "auth";
  return "unknown";
}

export class AgentVoiceSocket {
  private ws: WebSocket | null = null;
  private state: AgentConnState = "idle";
  private attempts = 0;
  private busyRetries = 0;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastErrorKind: AgentErrorKind | undefined;
  private pendingFrames: ArrayBuffer[] = [];

  constructor(private handlers: AgentVoiceSocketHandlers) {}

  get connState(): AgentConnState {
    return this.state;
  }

  get errorKind(): AgentErrorKind | undefined {
    return this.lastErrorKind;
  }

  connect(url: string): void {
    this.intentionalClose = false;
    this.lastErrorKind = undefined;
    this.attempts = 0;
    this.busyRetries = 0;
    this.openSocket(url);
  }

  /** Mic frame — buffered while down, forwarded verbatim once open. */
  sendAudio(buffer: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
      return;
    }
    if (this.intentionalClose) return;
    this.pendingFrames.push(buffer);
    if (this.pendingFrames.length > MAX_BUFFERED_FRAMES) {
      this.pendingFrames.shift();
    }
  }

  sendJson(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.pendingFrames = [];
    try { this.ws?.close(1000, "client_stop"); } catch { /* noop */ }
    this.ws = null;
    this.setState("closed");
  }

  private setState(s: AgentConnState, errorKind?: AgentErrorKind): void {
    this.state = s;
    if (errorKind !== undefined) this.lastErrorKind = errorKind;
    this.handlers.onStateChange?.(s, this.lastErrorKind);
  }

  private flushPendingFrames(): void {
    const frames = this.pendingFrames;
    this.pendingFrames = [];
    for (const frame of frames) {
      try {
        this.ws?.send(frame);
      } catch {
        break; // socket died mid-flush — remainder joins the next buffer cycle
      }
    }
  }

  private openSocket(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(url, "connection");
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      if (this.attempts > 0) this.attempts = 0; // reset backoff after success
      if (this.busyRetries > 0) this.busyRetries = 0;
      this.setState("open");
      // Speech captured during the gap leads the stream, preserving order.
      this.flushPendingFrames();
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        let evt: AgentEvent;
        try {
          evt = JSON.parse(ev.data) as AgentEvent;
        } catch {
          return;
        }
        switch (evt.type) {
          case "Welcome":
            this.setState("open");
            break;
          case "Error": {
            const kind = classifyErrorEvent(evt);
            if (kind === "think" || kind === "auth") this.lastErrorKind = kind;
            break;
          }
          default:
            break;
        }
        this.handlers.onEvent?.(evt);
      } else if (ev.data instanceof ArrayBuffer) {
        this.handlers.onAudio?.(ev.data);
      } else if (ev.data instanceof Blob) {
        void ev.data.arrayBuffer().then((buf) => this.handlers.onAudio?.(buf));
      }
    };

    ws.onclose = (ev: CloseEvent) => {
      if (this.intentionalClose) return;
      const kind = classifyClose(ev.code, ev.reason || "");
      this.lastErrorKind = kind;
      // Fatal gates: retrying cannot fix auth/disabled.
      if (kind === "auth" || kind === "disabled") {
        this.ws = null;
        this.setState("error", kind);
        return;
      }
      // Policy caps: ending is CORRECT behavior, not an error to retry.
      if (kind === "session_end") {
        this.ws = null;
        this.setState("closed", kind);
        return;
      }
      this.scheduleReconnect(url, kind);
    };

    ws.onerror = () => {
      try { ws.close(); } catch { /* onclose follows */ }
    };
  }

  private scheduleReconnect(url: string, kind: AgentErrorKind): void {
    // Slot conflicts resolve when the previous session's server-side reap
    // lands (~seconds). They get their own small retry budget so a real
    // double-session attempt still surfaces quickly.
    if (kind === "busy") {
      if (this.busyRetries >= MAX_BUSY_RETRIES) {
        this.ws = null;
        this.setState("error", "busy");
        return;
      }
      this.busyRetries += 1;
    } else if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.ws = null;
      this.setState("error", this.lastErrorKind ?? "connection");
      return;
    }

    const base = kind === "busy" ? 1500 : BASE_BACKOFF_MS * 2 ** this.attempts;
    const delay = base + Math.random() * 150;
    if (kind !== "busy") this.attempts += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) this.openSocket(url);
    }, delay);
  }
}
