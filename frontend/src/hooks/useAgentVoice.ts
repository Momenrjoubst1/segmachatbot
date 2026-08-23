/**
 * useAgentVoice — orchestrator for Deepgram Voice Agent live mode.
 *
 * ONE WebSocket handles the whole loop (STT → Think → TTS):
 *   listening ──(user talks)──► agent thinks ──► speaking ──┐
 *        ▲                                                  │
 *        └──────── UserStartedSpeaking (barge-in) ◄─────────┘
 *
 * Stability contract:
 * - Sessions carry a stable conversation id (?sid) so backend reconnects
 *   RESUME the conversation instead of amnesia-resetting it.
 * - Mic frames buffer across reconnect gaps inside AgentVoiceSocket.
 * - The duration cap self-fires ~5 s EARLY client-side: the user hears a
 *   graceful end, never a mid-word server cut.
 * - A stall watchdog recovers the UI if the engine goes quiet unexpectedly;
 *   visibility/pagehide handlers cover iOS backgrounding.
 * - If barge-in fires suspiciously right after every agent turn (speaker
 *   echo where AEC is weak), the mic mutes DURING playback automatically
 *   (half-duplex fallback) so the bot can't interrupt itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AgentVoiceSocket,
  type AgentErrorKind,
} from "@/lib/voice-agent/agent-client";

export type { AgentErrorKind } from "@/lib/voice-agent/agent-client";
import { PcmStreamPlayer } from "@/lib/voice-agent/pcm-stream-player";
import { voiceAmbience } from "@/lib/voice-agent/ambience-controller";

export type AgentVoiceState =
  | "off"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface UseAgentVoiceOptions {
  /** Called once per distinct fatal failure for a single toast. */
  onError?: (kind: AgentErrorKind) => void;
  /** Non-fatal notices worth surfacing (e.g. echo fallback engaged). */
  onNotice?: (notice: "half_duplex") => void;
}

export interface AgentStatusInfo {
  enabled: boolean;
  listenModel?: string;
  speakProvider?: string;
  maxSessionSeconds?: number;
  dailyMinutesLimit?: number;
  /** Selectable voices (labels only) — empty when single-voice. */
  voices?: Array<{ key: string; label: string }>;
}

/** Capability probe — hide the LIVE button when the backend isn't wired. */
export async function fetchAgentVoiceStatus(): Promise<AgentStatusInfo> {
  try {
    const [{ authFetch }, { BACKEND_URL }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/config"),
    ]);
    const res = await authFetch(`${BACKEND_URL}/api/voice/agent-status`);
    if (!res.ok) return { enabled: false };
    return (await res.json()) as AgentStatusInfo;
  } catch {
    return { enabled: false };
  }
}

// One probe per browser session — limits rarely change mid-session.
let cachedStatus: AgentStatusInfo | null = null;

async function getAccessToken(): Promise<string> {
  const { supabase } = await import("@/lib/supabaseClient");
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } as MediaTrackConstraints,
};

export interface TranscriptEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
}

/** Graceful self-end fires this long before the server-side cap. */
const END_EARLY_MS = 5_000;
/** No engine events for this long ⇒ stalled (recoverable UX, not silent hang). */
const STALL_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 20_000;
/** Barge-in sooner than this after agent speech smells like speaker echo. */
const ECHO_SUSPECT_MS = 900;
const ECHO_SUSPECT_COUNT = 3;

function newConversationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older Safari — enough entropy for a Redis key either way.
    return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useAgentVoice(opts: UseAgentVoiceOptions = {}) {
  const [state, setState] = useState<AgentVoiceState>("off");
  const [errorKind, setErrorKind] = useState<AgentErrorKind | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [muted, setMutedState] = useState(false);
  /** ms left under the duration cap while live; null outside sessions. */
  const [sessionRemainingMs, setSessionRemainingMs] = useState<number | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const socketRef = useRef<AgentVoiceSocket | null>(null);
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const agentTapAttached = useRef(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);

  const mutedRef = useRef(false);
  const halfDuplexRef = useRef(false);
  const stateRef = useRef<AgentVoiceState>(state);
  stateRef.current = state;

  // Late-bound so the watchdog/timers can trigger full teardown regardless
  // of declaration order.
  const teardownAllRef = useRef<() => void>(() => {});

  const transcriptIdRef = useRef(0);
  const lastCaptionAtRef = useRef(0);

  // Watchdog / timers
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectDeadlineRef = useRef(0);
  const remainingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef(0);
  const stoppingRef = useRef(false);

  // Echo heuristic state
  const agentSpeakStartedAtRef = useRef(0);
  const echoSuspectStreakRef = useRef(0);
  const sawUserCaptionSinceAgentRef = useRef(false);

  const armStallWatchdog = useCallback((): void => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = setTimeout(() => {
      if (stateRef.current === "off" || stateRef.current === "error") return;
      optsRef.current.onError?.("stalled");
      teardownAllRef.current();
      setState("error");
      setErrorKind("stalled");
    }, STALL_TIMEOUT_MS);
  }, []);

  const disarmStallWatchdog = useCallback((): void => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  }, []);

  // ---- Mic pipeline ---------------------------------------------------------
  const startMic = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    mediaStreamRef.current = stream;
    micTrackRef.current = stream.getAudioTracks()[0] ?? null;
    if (mutedRef.current && micTrackRef.current) {
      micTrackRef.current.enabled = false;
    }

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    await ctx.audioWorklet.addModule("/worklets/pcm-capture-worklet.js");
    const worklet = new AudioWorkletNode(ctx, "pcm-capture-processor");
    workletRef.current = worklet;

    worklet.port.onmessage = (
      e: MessageEvent<{ type: string; buffer?: Int16Array }>,
    ) => {
      const msg = e.data;
      if (msg.type === "frame" && msg.buffer) {
        // Mute drops frames CLIENT-side: nothing leaves the device.
        if (mutedRef.current) return;
        // Half-duplex fallback: hold your breath while the agent speaks.
        if (halfDuplexRef.current && stateRef.current === "speaking") return;
        socketRef.current?.sendAudio(msg.buffer.buffer as ArrayBuffer);
      }
    };

    ctx.createMediaStreamSource(stream).connect(worklet);
    // Output intentionally NOT routed to speakers (avoid echo).
    worklet.port.postMessage({ type: "start", targetRate: 16000 });

    // UI ambience: mic loudness drives the listening glow.
    voiceAmbience.attachMic(ctx, stream);
  }, []);

  const stopMic = useCallback((): void => {
    try { workletRef.current?.port.postMessage({ type: "stop" }); } catch { /* noop */ }
    try { workletRef.current?.disconnect(); } catch { /* noop */ }
    voiceAmbience.detachMic();
    void audioCtxRef.current?.close().catch(() => undefined);
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    workletRef.current = null;
    audioCtxRef.current = null;
    mediaStreamRef.current = null;
    micTrackRef.current = null;
  }, []);

  // ---- Timers lifecycle -----------------------------------------------------
  const clearSessionTimers = useCallback((): void => {
    disarmStallWatchdog();
    if (connectTimerRef.current) clearInterval(connectTimerRef.current);
    connectTimerRef.current = null;
    if (remainingTimerRef.current) clearInterval(remainingTimerRef.current);
    remainingTimerRef.current = null;
    setSessionRemainingMs(null);
  }, [disarmStallWatchdog]);

  // ---- Lifecycle -------------------------------------------------------------
  const teardownAll = useCallback((): void => {
    stopMic();
    playerRef.current?.destroy();
    playerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    voiceAmbience.reset();
    halfDuplexRef.current = false;
    echoSuspectStreakRef.current = 0;
    clearSessionTimers();
    setTranscripts([]);
    setMutedState(false);
    mutedRef.current = false;
  }, [stopMic, clearSessionTimers]);
  teardownAllRef.current = teardownAll;

  const start = useCallback(async (): Promise<boolean> => {
    if (socketRef.current) return false; // already running

    setState("connecting");
    setErrorKind(null);
    setTranscripts([]);
    stoppingRef.current = false;

    let socket: AgentVoiceSocket | null = null;
    try {
      const token = await getAccessToken();
      if (!token) throw Object.assign(new Error("Not authenticated"), { kind: "auth" as const });

      const [{ BACKEND_URL }] = await Promise.all([import("@/lib/config")]);

      if (!cachedStatus) cachedStatus = await fetchAgentVoiceStatus();

      // Stable conversation id: reconnects resume THIS conversation server-
      // side (history merge + no greeting replay).
      const sid = newConversationId();

      // Persisted voice choice rides on the upgrade URL so it survives reconnects.
      let voiceParam = "";
      try {
        const saved = localStorage.getItem("sigma_agent_voice");
        if (saved && saved !== "primary") {
          voiceParam = `&voice=${encodeURIComponent(saved)}`;
        }
      } catch { /* private mode */ }

      const wsBase = BACKEND_URL.replace(/^http/, "ws").replace(/\/+$/, "");
      const url =
        `${wsBase}/ws/voice-agent?token=${encodeURIComponent(token)}` +
        `&sid=${encodeURIComponent(sid)}${voiceParam}`;

      const player = new PcmStreamPlayer((speaking) => {
        if (!speaking && stateRef.current === "speaking") {
          setState("listening");
        }
      });
      playerRef.current = player;
      agentTapAttached.current = false;

      // Ambience: mirror our state machine into the visual controller.
      voiceAmbience.setState("idle");

      socket = new AgentVoiceSocket({
        onAudio: (chunk) => void player.push(chunk),
        onEvent: (evt) => {
          armStallWatchdog(); // any engine traffic proves health
          switch (evt.type) {
            case "SettingsApplied":
              setState((s) => (s === "connecting" ? "listening" : s));
              break;
            case "UserStartedSpeaking": {
              // BARGE-IN — kill playback instantly, hand the floor back.
              player.stopAll();
              setState((s) =>
                s === "speaking" || s === "thinking" || s === "listening" ? "listening" : s,
              );
              // Echo heuristic: instant self-interruptions with no real user
              // captions mean the mic is hearing our own speaker.
              const sinceAgent = Date.now() - agentSpeakStartedAtRef.current;
              if (
                agentSpeakStartedAtRef.current &&
                sinceAgent < ECHO_SUSPECT_MS &&
                !sawUserCaptionSinceAgentRef.current
              ) {
                echoSuspectStreakRef.current += 1;
                if (
                  echoSuspectStreakRef.current >= ECHO_SUSPECT_COUNT &&
                  !halfDuplexRef.current
                ) {
                  halfDuplexRef.current = true;
                  optsRef.current.onNotice?.("half_duplex");
                }
              }
              break;
            }
            case "UserStoppedSpeaking":
              break;
            case "ConversationText": {
              const role = evt.role === "assistant" ? "assistant" : "user";
              const incoming = String(evt.content ?? "").trim();
              if (!incoming) break;
              if (role === "user") sawUserCaptionSinceAgentRef.current = true;
              lastCaptionAtRef.current = Date.now();
              setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === role) {
                  // Same-utterance extension: grow, don't duplicate.
                  const text = incoming.startsWith(last.text) ? incoming : `${last.text} ${incoming}`;
                  const next = prev.slice(0, -1);
                  next.push({ ...last, text });
                  return next;
                }
                return [...prev, { id: ++transcriptIdRef.current, role, text: incoming }];
              });
              break;
            }
            case "AgentThinking":
              setState((s) => (s === "listening" ? "thinking" : s));
              break;
            case "AgentStartedSpeaking": {
              agentSpeakStartedAtRef.current = Date.now();
              sawUserCaptionSinceAgentRef.current = false;
              echoSuspectStreakRef.current = 0;
              // First audio may arrive with this event — latch the tap once.
              if (!agentTapAttached.current) {
                const tap = player.getOutputTap();
                if (tap) {
                  voiceAmbience.attachAgent(tap.node);
                  agentTapAttached.current = true;
                }
              }
              setState("speaking");
              break;
            }
            case "AgentAudioDone":
              // Trust the protocol over local queue draining — guarantees we
              // never strand the UI in "speaking" when zero frames arrived.
              setState((s) => (s === "speaking" || s === "thinking" ? "listening" : s));
              break;
            case "Error": {
              const kind =
                /THINK_REQUEST_FAILED|FAILED_TO_THINK/i.test(String(evt.description ?? evt.message ?? ""))
                  ? "think"
                  : undefined;
              if (kind === "think") {
                setErrorKind("think");
                optsRef.current.onError?.("think");
                // Adapter failed but session lives on — show it, keep mic open.
                setState((s) => (s === "thinking" ? "listening" : s));
              }
              break;
            }
            default:
              break;
          }
        },
        onStateChange: (connState, kind) => {
          if (connState === "reconnecting") {
            setState((s) => (s === "off" ? s : "connecting"));
          } else if (connState === "open") {
            setState((s) => (s === "connecting" ? "listening" : s));
          } else if (connState === "closed" && kind === "session_end") {
            // Server policy cap landed first (or we asked to stop) — a clean
            // end, NOT an error state.
            clearSessionTimers();
            teardownAllRef.current();
            setState("off");
          } else if (connState === "error") {
            setErrorKind(kind ?? "connection");
            optsRef.current.onError?.(kind ?? "connection");
            teardownAllRef.current();
            setState("error");
          }
        },
      });
      socketRef.current = socket;

      // Mic can come up while the WS handshake runs — frames are buffered by
      // the socket until open. Failure of either aborts the whole start.
      socket.connect(url);
      connectDeadlineRef.current = Date.now() + CONNECT_TIMEOUT_MS;
      connectTimerRef.current = setInterval(() => {
        if (stateRef.current !== "connecting") {
          if (connectTimerRef.current) clearInterval(connectTimerRef.current);
          connectTimerRef.current = null;
          return;
        }
        if (Date.now() > connectDeadlineRef.current) {
          if (connectTimerRef.current) clearInterval(connectTimerRef.current);
          connectTimerRef.current = null;
          setErrorKind("connection");
          optsRef.current.onError?.("connection");
          teardownAllRef.current();
          setState("error");
        }
      }, 1_000);
      armStallWatchdog();
      await startMic();

      // Duration-cap countdown: self-end EARLY so the cap never cuts mid-word.
      const maxSec = cachedStatus.maxSessionSeconds ?? 300;
      deadlineRef.current = Date.now() + maxSec * 1000;
      setSessionRemainingMs(maxSec * 1000);
      remainingTimerRef.current = setInterval(() => {
        const left = deadlineRef.current - Date.now();
        setSessionRemainingMs(Math.max(0, left));
        if (left <= END_EARLY_MS && !stoppingRef.current && socketRef.current) {
          stoppingRef.current = true;
          // Graceful close: relay flushes the transcript to the thread.
          socketRef.current.sendJson({ type: "close" });
          clearSessionTimers();
          teardownAllRef.current();
          setState("off");
        }
      }, 1_000);

      return true;
    } catch (err) {
      const kind =
        ((err as { kind?: AgentErrorKind }).kind as AgentErrorKind | undefined) ?? "connection";
      setErrorKind(kind);
      optsRef.current.onError?.(kind);
      teardownAllRef.current();
      setState("error");
      return false;
    }
  }, [startMic, teardownAllRef, armStallWatchdog, clearSessionTimers]);

  const stop = useCallback((): void => {
    stoppingRef.current = true;
    socketRef.current?.sendJson({ type: "close" });
    teardownAllRef.current();
    setState("off");
    setErrorKind(null);
  }, [teardownAllRef]);

  /** Mute keeps the session alive; frames simply stop leaving the device. */
  const setMuted = useCallback((next: boolean): void => {
    mutedRef.current = next;
    setMutedState(next);
    const track = micTrackRef.current;
    if (track) track.enabled = !next;
  }, []);

  /** Mid-session voice switch — server builds the UpdateSpeak payload. */
  const setVoice = useCallback((voiceKey: string): void => {
    try { localStorage.setItem("sigma_agent_voice", voiceKey); } catch { /* private mode */ }
    socketRef.current?.sendJson({ type: "set_voice", voice: voiceKey });
  }, []);

  useEffect(() => {
    return () => {
      // Unmount safety: release everything even mid-conversation.
      stoppingRef.current = true;
      socketRef.current?.sendJson({ type: "close" });
      teardownAllRef.current();
    };
  }, []);

  // iOS/mobile backgrounding: browsers suspend AudioContext + sockets off-tab.
  // Resume what resumes; close gracefully on pagehide so the transcript flush
  // happens while the page still exists.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    };
    const onPageHide = () => {
      if (!socketRef.current) return;
      stoppingRef.current = true;
      try { socketRef.current.sendJson({ type: "close" }); } catch { /* noop */ }
      teardownAllRef.current();
      setState("off");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [teardownAllRef]);

  const busy = useMemo(
    () => state === "connecting" || state === "thinking",
    [state],
  );

  // Mirror React state -> imperative ambience controller (event-rate, not frame-rate).
  useEffect(() => {
    switch (state) {
      case "listening":
        voiceAmbience.setState("listening");
        break;
      case "thinking":
      case "connecting":
        voiceAmbience.setState("thinking");
        break;
      case "speaking":
        voiceAmbience.setState("speaking");
        break;
      default:
        voiceAmbience.setState("idle");
        break;
    }
  }, [state]);

  return {
    state,
    busy,
    errorKind,
    transcripts,
    sessionRemainingMs,
    muted,
    setMuted,
    setVoice,
    start,
    stop,
  };
}
