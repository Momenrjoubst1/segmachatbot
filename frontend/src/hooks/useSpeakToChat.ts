/**
 * useSpeakToChat — voice as an INPUT METHOD for the regular chat.
 *
 * The contract with the rest of the app is intentionally thin:
 *   speak → endpoint → auto-submit through the REAL composer →
 *   the REAL chat pipeline answers in the REAL thread (all tools, email,
 *   RAG, memory, permissions — nothing voice-specific) →
 *   the streaming reply is split into sentences and spoken via TTS.
 *
 * Nothing here reimplements the brain. This hook owns only:
 *   turn-taking (silence endpoint + incomplete-utterance guard),
 *   read-aloud (sentence queue), barge-in (sustained loud RMS),
 *   mute (frames never leave the device), and degradation (TTS down → text).
 *
 * Turn cycle:
 *   listening ──endpoint──► sending ──► thinking ──► speaking ──┐
 *        ▲                                                      │
 *        └────────────── queue drained ◄────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";

import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";
import {
  DictationController,
  type DictationState,
} from "@/lib/stt/deepgram-dictation";
import {
  SilenceEndpointDetector,
  isLikelyIncomplete,
} from "@/lib/stt/silence-endpoint-detector";
import { AudioQueuePlayer } from "@/lib/tts/audio-player";
import { StreamingSentenceSplitter } from "@/lib/tts/sentence-splitter";
import {
  synthesizeChunk,
  fetchVoicePersonas,
  TtsError,
} from "@/lib/tts/tts-client";
import { ElevenLabsStreamingTts } from "@/lib/tts/elevenlabs-streaming";

export type SpeakToChatState =
  | "off"
  | "connecting"
  | "listening"
  | "sending"
  | "thinking"
  | "speaking";

export interface UseSpeakToChatOptions {
  /** Writes the given text into the composer input. */
  writeToComposer: (text: string) => void;
  /** Programmatically submits the composer form (the REAL send path). */
  submitComposer: () => void;
  /** Non-fatal notices worth a toast. */
  onNotice?: (notice: "tts_unavailable" | "half_duplex") => void;
  /** Fatal start failures (mic denied, ws down…). Session drops to off. */
  onError?: (reason: "mic" | "ws" | "auth") => void;
}

const BARGE_IN_LOUD_RMS = 550; // above normal speech gate: avoids TTS bleed
const BARGE_IN_SUSTAIN_MS = 350;
/** Barge-in sooner than this after speech starts smells like speaker echo. */
const ECHO_SUSPECT_MS = 900;
const ECHO_SUSPECT_COUNT = 3;

const PERSONA_STORAGE_KEY = "sigma_voice_persona";

function extractMessageText(content: readonly unknown[]): string {
  let out = "";
  for (const part of content as Array<{ type?: string; text?: string }>) {
    if (part?.type === "text" && typeof part.text === "string") out += part.text;
  }
  return out;
}

export function useSpeakToChat(opts: UseSpeakToChatOptions) {
  const [state, setState] = useState<SpeakToChatState>("off");
  const [muted, setMutedState] = useState(false);
  /** Live interim transcript — shown in the session panel, Claude-style. */
  const [interimText, setInterimText] = useState("");

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const controllerRef = useRef<DictationController | null>(null);
  const detectorRef = useRef<SilenceEndpointDetector | null>(null);
  const playerRef = useRef<AudioQueuePlayer | null>(null);
  const splitterRef = useRef<StreamingSentenceSplitter | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Streaming TTS client (ElevenLabs WebSocket). Created per session. */
  const ttsStreamRef = useRef<ElevenLabsStreamingTts | null>(null);

  const turnTextRef = useRef("");
  const lastSentTextRef = useRef("");
  const suppressSpeechRef = useRef(false); // after barge-in until next send
  const bargeFirstLoudTsRef = useRef(0);
  const speakStartedAtRef = useRef(0);
  const echoStreakRef = useRef(0);
  const halfDuplexRef = useRef(false);
  const mutedRef = useRef(false);
  const stoppingRef = useRef(false);
  const stateRef = useRef<SpeakToChatState>(state);
  stateRef.current = state;
  const teardownRef = useRef<() => void>(() => {});

  // ---- Assistant reply watching -------------------------------------------
  const messages = useAuiState((s) => s.thread.messages);
  const seenMsgRef = useRef<{ id: string; len: number }>({ id: "", len: 0 });

  useEffect(() => {
    if (state === "off") return;
    const lastAssistant = [...(messages ?? [])]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) return;

    const text = extractMessageText(lastAssistant.content);
    if (seenMsgRef.current.id !== lastAssistant.id) {
      // New assistant turn — seed with current text (avoid replaying history)
      seenMsgRef.current = { id: lastAssistant.id, len: text.length };
      if (text) setState((s) => (s === "sending" ? "thinking" : s));
      return;
    }
    const delta = text.slice(seenMsgRef.current.len);
    if (!delta) return;
    seenMsgRef.current.len = text.length;
    setState((s) => (s === "listening" || s === "sending" ? "thinking" : s));

    if (suppressSpeechRef.current) return;
    const splitter = splitterRef.current;
    if (!splitter) return;
    for (const sentence of splitter.push(delta)) void speakSentenceRef.current(sentence);
  }, [messages, state]);

  // ---- Speech synthesis + playback ----------------------------------------
  // WebSocket streaming path (ElevenLabs Flash v2.5, sub-100ms TTFB) when
  // the session has an open TTS stream; otherwise fall back to the HTTP
  // per-sentence route. The HTTP fallback is what surfaces "tts_unavailable"
  // — the WebSocket path degrades silently by playing nothing.
  const speakSentence = useCallback((sentence: string) => {
    const player = playerRef.current;
    if (!player) return;
    const stream = ttsStreamRef.current;
    if (stream && stream.streamState === "open") {
      // Sentence boundary: push the text and flush so ElevenLabs starts
      // generating this sentence immediately even if the next hasn't
      // arrived yet.
      stream.pushText(sentence);
      stream.flush();
      return;
    }
    // HTTP fallback — kept for environments without an ElevenLabs key.
    void (async () => {
      const ac = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ac;
      try {
        const audio = await synthesizeChunk(
          sentence,
          personaIdRef.current,
          ac.signal,
        );
        await player.enqueue(audio.slice(0));
      } catch (err) {
        if (err instanceof TtsError && err.kind === "unavailable") {
          suppressSpeechRef.current = true;
          optsRef.current.onNotice?.("tts_unavailable");
        }
        // aborted / network blips: skip silently — text still flows
      }
    })();
  }, []);
  const speakSentenceRef = useRef(speakSentence);
  speakSentenceRef.current = speakSentence;

  // ---- Persona --------------------------------------------------------------
  const personaIdRef = useRef("sana");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PERSONA_STORAGE_KEY);
      if (saved) {
        personaIdRef.current = saved;
        return;
      }
    } catch { /* private mode */ }
    void fetchVoicePersonas()
      .then((list) => {
        const def = list.find((p) => p.default) ?? list[0];
        if (def) personaIdRef.current = def.id;
      })
      .catch(() => undefined); // default persona stands
  }, []);

  const setPersona = useCallback((personaId: string): void => {
    personaIdRef.current = personaId;
    try { localStorage.setItem(PERSONA_STORAGE_KEY, personaId); } catch { /* private mode */ }
  }, []);

  // ---- Turn ending / auto-send --------------------------------------------
  const endTurn = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || stoppingRef.current) return;
    setState("sending");

    // Finalize NOW: Deepgram emits the is_final transcript in ~100-200ms
    // instead of waiting out its own 800ms endpointing. The session STAYS
    // OPEN — killing it here (the old behavior) destroyed the final
    // in-flight, so every turn arrived empty and was discarded forever.
    let text = turnTextRef.current.trim();
    try {
      text = (await controller.finalize(1200)).trim();
    } catch { /* keep what we have */ }
    if (stoppingRef.current) return;

    const words = text ? text.split(/\s+/).length : 0;

    if (words >= 2 && text !== lastSentTextRef.current) {
      lastSentTextRef.current = text;
      suppressSpeechRef.current = false;
      splitterRef.current = new StreamingSentenceSplitter();
      seenMsgRef.current = { id: "", len: 0 };
      detectorRef.current?.reset();
      echoStreakRef.current = 0; // a real user turn happened — echo suspicion clears
      turnTextRef.current = "";
      setInterimText("");
      voiceDebugBus.event("s2c_send", text.slice(0, 60));
      // THE parity move: the transcript rides the real composer form, so the
      // message travels the exact send path a typed message would take.
      // The settle delay matters: Lexical applies setText asynchronously, and
      // requestSubmit() in the same tick submits an EMPTY box (the message
      // silently vanishes). One frame + a microtask is enough.
      optsRef.current.writeToComposer(text);
      window.setTimeout(() => {
        if (stoppingRef.current) return;
        optsRef.current.submitComposer();
        setState((s) => (s === "sending" ? "thinking" : s));
      }, 120);
      // The mic/session keeps running — the next turn starts instantly with
      // zero reconnect gap while the bot thinks/speaks.
    } else {
      // Blip/noise or duplicate — discard and keep listening
      turnTextRef.current = "";
      setInterimText("");
      detectorRef.current?.reset();
      optsRef.current.writeToComposer("");
      setState("listening");
    }
  }, []);
  const endTurnRef = useRef(endTurn);
  endTurnRef.current = endTurn;

  // ---- Mic management ------------------------------------------------------
  const startMicRef = useRef<() => Promise<void>>(async () => {});

  const reopenMicRef = useRef(async (): Promise<void> => {
    try {
      await startMicRef.current();
    } catch {
      teardownRef.current();
      setState("off");
    }
  });

  const startMic = useCallback(async () => {
    const controller = new DictationController({
      gateFrame: () =>
        mutedRef.current ||
        (halfDuplexRef.current && stateRef.current === "speaking"),
      onStateChange: (s: DictationState) => {
        if (s === "error" && stateRef.current !== "off") {
          optsRef.current.onError?.("ws");
          teardownRef.current();
          setState("off");
          return;
        }
        // Relay's per-session cap auto-stopped capture mid-conversation —
        // reopen so long listening stretches never silently go deaf.
        if (s === "idle" && stateRef.current === "listening" && !stoppingRef.current) {
          void reopenMicRef.current();
        }
      },
      onInterim: (t) => {
        turnTextRef.current = t;
        setInterimText(t);
        // Live words IN THE COMPOSER — the user watches the box fill as they
        // speak (their explicit requirement; matches dictation UX).
        optsRef.current.writeToComposer(t);
        voiceDebugBus.event("s2c_interim", t.slice(0, 60));
      },
      onFinalSegment: (seg) => {
        turnTextRef.current = (turnTextRef.current + " " + seg).trim();
        setInterimText(turnTextRef.current);
        optsRef.current.writeToComposer(turnTextRef.current);
      },
      onRms: (rms) => handleRmsRef.current(rms),
      // Full relay visibility in the ?voiceDebug=1 overlay: ready/partial/
      // final/ws_close/mic_config — pinpoints the broken hop in one test.
      onEvent: (evt) => {
        voiceDebugBus.event(`relay_${evt.kind}`, evt.detail);
      },
    });
    controllerRef.current = controller;
    await controller.start();
  }, []);
  startMicRef.current = startMic;

  const handleRms = useCallback((rms: number) => {
    const st = stateRef.current;
    if (st === "speaking") {
      // Barge-in detection: sustain loud input -> stop the bot talking
      const now = Date.now();
      if (rms >= BARGE_IN_LOUD_RMS) {
        if (!bargeFirstLoudTsRef.current) bargeFirstLoudTsRef.current = now;
        else if (now - bargeFirstLoudTsRef.current >= BARGE_IN_SUSTAIN_MS) {
          bargeFirstLoudTsRef.current = 0;
          abortRef.current?.abort();
          playerRef.current?.stopAll();
          // Echo heuristic: a barge that fires almost immediately after the
          // bot starts talking, with nothing the user said in between, is
          // usually our own audio looping back where AEC is weak. Three in
          // a row -> stop listening during playback entirely.
          if (
            speakStartedAtRef.current &&
            now - speakStartedAtRef.current < ECHO_SUSPECT_MS
          ) {
            echoStreakRef.current += 1;
            if (echoStreakRef.current >= ECHO_SUSPECT_COUNT && !halfDuplexRef.current) {
              halfDuplexRef.current = true;
              optsRef.current.onNotice?.("half_duplex");
            }
          } else {
            echoStreakRef.current = 0;
          }
          setState("listening");
        }
      } else {
        bargeFirstLoudTsRef.current = 0;
      }
      return;
    }
    if (st !== "listening" || mutedRef.current) return;
    const decision = detectorRef.current?.feed(
      rms,
      isLikelyIncomplete(turnTextRef.current),
    );
    if (decision?.endpoint) void endTurnRef.current();
  }, []);
  const handleRmsRef = useRef(handleRms);
  handleRmsRef.current = handleRms;

  // ---- Public controls ------------------------------------------------------
  const start = useCallback(async (): Promise<boolean> => {
    if (controllerRef.current || playerRef.current) return false; // already running

    stoppingRef.current = false;
    detectorRef.current = new SilenceEndpointDetector();
    playerRef.current = new AudioQueuePlayer((speaking) => {
      if (!speaking) {
        speakStartedAtRef.current = 0;
        if (stateRef.current === "speaking") {
          // Queue drained — hand the floor back to the user
          suppressSpeechRef.current = false;
          detectorRef.current?.reset();
          setState("listening");
        }
      } else {
        if (!speakStartedAtRef.current) speakStartedAtRef.current = Date.now();
        setState((s) => (s === "thinking" || s === "listening" ? "speaking" : s));
      }
    });

    // Open the ElevenLabs streaming TTS WebSocket (non-blocking: a connect
    // failure is silent — speakSentence() falls back to the HTTP route).
    ttsStreamRef.current = new ElevenLabsStreamingTts(
      { voiceId: personaIdRef.current, autoMode: true },
      {
        onAudio: (chunk) => {
          // Forward the MP3 chunk straight to the existing player queue.
          // The player's enqueue() decodes asynchronously so it never blocks
          // the WS callback.
          playerRef.current?.enqueue(chunk.slice(0)).catch(() => undefined);
        },
        onError: (err) => {
          voiceDebugBus.event("tts_stream_error", err.message);
          // Don't surface as a toast on every transient hiccup; the HTTP
          // fallback is the safety net and the user will hear silence.
        },
        onClosed: (info) => {
          voiceDebugBus.event("tts_stream_closed", `${info.code} ${info.reason}`);
        },
      },
    );
    void ttsStreamRef.current.connect().then((ok) => {
      if (!ok) {
        voiceDebugBus.event("tts_stream_connect_failed", "");
      }
    });

    splitterRef.current = new StreamingSentenceSplitter();
    turnTextRef.current = "";
    lastSentTextRef.current = "";
    suppressSpeechRef.current = false;
    seenMsgRef.current = { id: "", len: 0 };
    setState("connecting");
    try {
      await startMicRef.current();
      setState("listening");
      return true;
    } catch (err) {
      teardownRef.current();
      setState("off");
      const msg = String((err as Error)?.message ?? "");
      optsRef.current.onError?.(
        /denied|permission/i.test(msg) ? "mic" : /auth/i.test(msg) ? "auth" : "ws",
      );
      return false;
    }
  }, []);

  const stop = useCallback((): void => {
    stoppingRef.current = true;
    abortRef.current?.abort();
    controllerRef.current?.stop().catch(() => undefined);
    playerRef.current?.stopAll();
    ttsStreamRef.current?.endStream();
    ttsStreamRef.current?.close();
    ttsStreamRef.current = null;
    teardownRef.current();
    setInterimText("");
    setState("off");
  }, []);

  function teardown() {
    stoppingRef.current = true;
    controllerRef.current = null;
    detectorRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    splitterRef.current = null;
    turnTextRef.current = "";
    halfDuplexRef.current = false;
    echoStreakRef.current = 0;
    speakStartedAtRef.current = 0;
  }
  teardownRef.current = teardown;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      controllerRef.current?.stop().catch(() => undefined);
      playerRef.current?.destroy();
    };
  }, []);

  // Backgrounding: browsers kill audio + sockets off-tab. End gracefully so
  // the thread stays consistent instead of leaving a zombie listener.
  useEffect(() => {
    const onPageHide = () => {
      if (stateRef.current === "off") return;
      stopRef.current();
      setState("off");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  /** Mute keeps the conversation alive; frames simply never leave the device. */
  const setMuted = useCallback((next: boolean): void => {
    mutedRef.current = next;
    setMutedState(next);
  }, []);

  const busy = useMemo(
    () => state === "sending" || state === "thinking",
    [state],
  );

  // Debug overlay (?voiceDebug=1) mirrors the state machine for diagnosis.
  useEffect(() => {
    voiceDebugBus.event("s2c_state", state);
    voiceDebugBus.setState(state === "off" ? "idle" : `s2c:${state}`);
  }, [state]);

  return { state, busy, muted, setMuted, start, stop, setPersona, interimText };
}
