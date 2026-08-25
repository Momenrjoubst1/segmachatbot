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
import { useAuiState, useAui } from "@assistant-ui/react";

import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";
import {
  DictationController,
  type DictationState,
} from "@/lib/stt/deepgram-dictation";
import {
  SilenceEndpointDetector,
  isLikelyIncomplete,
  type SemanticVerdict,
} from "@/lib/stt/silence-endpoint-detector";
import { judgeTurnComplete } from "@/lib/stt/turn-detection-client";
import { AudioQueuePlayer } from "@/lib/tts/audio-player";
import { StreamingSentenceSplitter } from "@/lib/tts/sentence-splitter";
import {
  synthesizeChunk,
  fetchVoicePersonas,
  TtsError,
} from "@/lib/tts/tts-client";
import { ElevenLabsStreamingTts } from "@/lib/tts/elevenlabs-streaming";
import { voiceKaraoke } from "@/lib/tts/voice-karaoke";
import {
  voiceAmbience,
  type AmbienceState,
} from "@/features/ai-assistant/ui/voice/ambience-controller";

export type SpeakToChatState =
  | "off"
  | "connecting"
  | "listening"
  | "sending"
  | "thinking"
  | "speaking";

/** Session state → orb/waveform ambience state (see ambience-controller). */
const AMBIENCE_OF_STATE: Record<SpeakToChatState, AmbienceState> = {
  off: "off",
  connecting: "idle",
  listening: "listening",
  sending: "thinking",
  thinking: "thinking",
  speaking: "speaking",
};

export interface UseSpeakToChatOptions {
  /** Writes the given text into the composer input. */
  writeToComposer: (text: string) => void;
  /** Programmatically submits the composer form (the REAL send path).
   *  Returns false when the real composer could not be found. */
  submitComposer: () => boolean | void;
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
  /**
   * ALL in-flight HTTP-fallback TTS fetches. Concurrent by design: aborting
   * the previous sentence when a new one starts (the old single-ref
   * behavior) dropped its audio whenever the fallback + slow network
   * coincided. Barge-in/stop aborts the whole set.
   */
  const httpFetchesRef = useRef<Set<AbortController>>(new Set());
  /** Streaming TTS client (ElevenLabs WebSocket). Created per session. */
  const ttsStreamRef = useRef<ElevenLabsStreamingTts | null>(null);
  /** Stops the 10 Hz karaoke playhead interval. */
  const karaokeTickStopRef = useRef<(() => void) | null>(null);
  /** Turn-relative second where the next audio chunk's timings begin. */
  const chunkTimingOffsetRef = useRef(0);

  const turnTextRef = useRef("");
  const lastSentTextRef = useRef("");
  // ---- Semantic endpointing (backend turn detector) -------------------------
  /** Latest verdict, keyed by the EXACT transcript it judged (staleness). */
  const remoteVerdictRef = useRef<{ text: string; verdict: SemanticVerdict } | null>(null);
  const semanticTimerRef = useRef<number | null>(null);
  const semanticGenRef = useRef(0);
  // Floor-watchdog bookkeeping: when the current transitional state began,
  // and the last time the assistant reply produced any text.
  const stateEnteredAtRef = useRef(Date.now());
  const lastReplyDeltaAtRef = useRef(0);
  const reopeningMicRef = useRef(false);
  /** One "TTS unavailable" toast per session, not per sentence. */
  const ttsUnavailableNoticedRef = useRef(false);
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

  // Claude-style truncate: a barge-in cancels the in-flight generation via
  // the runtime (same path the composer's Stop button takes), so the reply
  // stops growing and the unheard tail never lands in history or TTS.
  const aui = useAui();
  const cancelActiveRunRef = useRef<() => void>(() => {});
  cancelActiveRunRef.current = () => {
    try {
      aui.thread().cancelRun();
    } catch { /* no active run — nothing to cancel */ }
  };

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
      if (text) {
        lastReplyDeltaAtRef.current = Date.now();
        // TTS-dead mode (quota/payment outage): replies are text-only, so do
        // NOT climb into "thinking" — staying in "listening" keeps
        // endpointing alive and the conversation keeps flowing voice-in /
        // text-out instead of wedging until the watchdog.
        if (!suppressSpeechRef.current) {
          setState((s) => (s === "sending" ? "thinking" : s));
        }
      }
      return;
    }
    const delta = text.slice(seenMsgRef.current.len);
    if (!delta) return;
    seenMsgRef.current.len = text.length;
    lastReplyDeltaAtRef.current = Date.now();
    if (!suppressSpeechRef.current) {
      setState((s) => (s === "listening" || s === "sending" ? "thinking" : s));
    }

    if (suppressSpeechRef.current) return;
    // Karaoke: seed the bridge with the full (streaming) reply text so the
    // message bubble can split into words before timings arrive.
    if (!voiceKaraoke.isActive) voiceKaraoke.startTurn(text);
    else voiceKaraoke.updateText(text);
    const splitter = splitterRef.current;
    if (!splitter) return;
    for (const sentence of splitter.push(delta)) void speakSentenceRef.current(sentence);
  }, [messages, state]);

  // ---- Semantic endpointing queries ----------------------------------------
  // One backend call per speech pause: debounce trailing speech, then ask
  // whether the partial is a complete thought. A "complete" verdict lets the
  // detector hand the turn over EARLY (~320ms of silence); "incomplete"
  // extends the wait so thinking-pauses don't get clipped.
  useEffect(() => {
    if (state !== "listening") return;
    const genAtSchedule = ++semanticGenRef.current;
    if (semanticTimerRef.current) window.clearTimeout(semanticTimerRef.current);
    if (!interimText.trim()) return;
    semanticTimerRef.current = window.setTimeout(() => {
      void judgeTurnComplete(interimText)
        .then((verdict) => {
          if (genAtSchedule !== semanticGenRef.current) return; // stale response
          remoteVerdictRef.current = { text: interimText, verdict };
          voiceDebugBus.event(
            "turn_verdict",
            `${verdict.source}:${verdict.complete ? "done" : "cont"}${verdict.probability != null ? `:${verdict.probability.toFixed(2)}` : ""}`,
          );
        })
        .catch(() => undefined); // failure → silence timers decide alone
    }, 180);
  }, [interimText, state]);

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
      httpFetchesRef.current.add(ac);
      try {
        const audio = await synthesizeChunk(
          sentence,
          personaIdRef.current,
          ac.signal,
        );
        if (suppressSpeechRef.current) return; // barge-in landed mid-fetch
        await player.enqueue(audio.slice(0));
      } catch (err) {
        if (err instanceof TtsError && err.kind === "unavailable") {
          suppressSpeechRef.current = true;
          // One notice per SESSION, not per sentence — an exhausted ElevenLabs
          // quota used to spam a toast for every streamed sentence.
          if (!ttsUnavailableNoticedRef.current) {
            ttsUnavailableNoticedRef.current = true;
            voiceDebugBus.event("tts_unavailable", "suppressing speech this session");
            optsRef.current.onNotice?.("tts_unavailable");
          }
        }
        // aborted / network blips: skip silently — text still flows
      } finally {
        httpFetchesRef.current.delete(ac);
      }
    })();
  }, []);
  const speakSentenceRef = useRef(speakSentence);
  speakSentenceRef.current = speakSentence;

  // ---- Persona --------------------------------------------------------------
  const personaIdRef = useRef("sana");
  /** Mirrors personaIdRef so React UI (overlay picker) re-renders on change. */
  const [personaId, setPersonaId] = useState("sana");
  useEffect(() => {
    let initial = "sana";
    try {
      const saved = localStorage.getItem(PERSONA_STORAGE_KEY);
      if (saved) initial = saved;
    } catch { /* private mode */ }
    personaIdRef.current = initial;
    setPersonaId(initial);
    if (initial !== "sana") return; // saved choice wins; no fetch needed
    void fetchVoicePersonas()
      .then((list) => {
        const def = list.find((p) => p.default) ?? list[0];
        if (def && personaIdRef.current === "sana") {
          personaIdRef.current = def.id;
          setPersonaId(def.id);
        }
      })
      .catch(() => undefined); // default persona stands
  }, []);

  const setPersona = useCallback((personaId: string): void => {
    personaIdRef.current = personaId;
    setPersonaId(personaId);
    try { localStorage.setItem(PERSONA_STORAGE_KEY, personaId); } catch { /* private mode */ }
  }, []);

  // ---- Turn ending / auto-send --------------------------------------------
  const endTurn = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || stoppingRef.current) return;
    if (endTurnInFlightRef.current) return; // detector + flush + watchdog race
    endTurnInFlightRef.current = true;
    setState("sending");

    // Finalize NOW: Deepgram emits the is_final transcript in ~100-200ms
    // instead of waiting out its own 800ms endpointing. The session STAYS
    // OPEN — killing it here (the old behavior) destroyed the final
    // in-flight, so every turn arrived empty and was discarded forever.
    // Turn-scoped snapshot FIRST: finals locked before this turn belong to
    // EARLIER messages — one socket serves the whole hands-free session.
    const baseCount = controller.finalSegmentCount;
    try {
      await controller.finalize(1200);
    } catch { /* fall back to whatever interim we hold */ }
    if (stoppingRef.current) {
      endTurnInFlightRef.current = false;
      return;
    }

    const text =
      controller.getTranscriptSince(baseCount).trim() || turnTextRef.current.trim();

    const words = text ? text.split(/\s+/).length : 0;

    if (words >= 2 && text !== lastSentTextRef.current) {
      lastSentTextRef.current = text;
      suppressSpeechRef.current = false;
      // eagerFirstChunk: speak the first clause while the first sentence is
      // still generating — first audio lands ~1-2s earlier on long answers.
      splitterRef.current = new StreamingSentenceSplitter({ eagerFirstChunk: true });
      seenMsgRef.current = { id: "", len: 0 };
      detectorRef.current?.reset();
      remoteVerdictRef.current = null; // fresh turn → stale verdict must not fire
      echoStreakRef.current = 0; // a real user turn happened — echo suspicion clears
      controller.resetTranscriptForNextTurn(); // consumed — scope next turn cleanly
      turnTextRef.current = "";
      setInterimText("");
      // New spoken turn begins — reset the karaoke timing accumulator so
      // chunk-relative alignment maps onto a fresh turn timeline.
      chunkTimingOffsetRef.current = 0;
      voiceKaraoke.endTurn();
      voiceDebugBus.event("s2c_send", text.slice(0, 60));
      // THE parity move: the transcript rides the real composer form, so the
      // message travels the exact send path a typed message would take.
      // The settle delay matters: Lexical applies setText asynchronously, and
      // requestSubmit() in the same tick submits an EMPTY box (the message
      // silently vanishes). One frame + a microtask is enough.
      optsRef.current.writeToComposer(text);
      window.setTimeout(() => {
        if (stoppingRef.current) return;
        const submitted = optsRef.current.submitComposer();
        if (submitted === false) {
          // Real composer missing from the DOM — leave the text visible for
          // a manual send instead of wedging the whole session in "sending".
          voiceDebugBus.event("s2c_submit_failed", "");
          endTurnInFlightRef.current = false;
          setState("listening");
          return;
        }
        endTurnInFlightRef.current = false;
        // TTS-dead mode: skip "thinking" (nothing will ever play) and keep
        // the listening floor so the user can speak the next turn instantly.
        setState((s) =>
          s === "sending"
            ? suppressSpeechRef.current
              ? "listening"
              : "thinking"
            : s,
        );
      }, 120);
      // The mic/session keeps running — the next turn starts instantly with
      // zero reconnect gap while the bot thinks/speaks.
    } else {
      // Blip/noise or duplicate — discard and keep listening
      controller.resetTranscriptForNextTurn();
      turnTextRef.current = "";
      setInterimText("");
      detectorRef.current?.reset();
      optsRef.current.writeToComposer("");
      endTurnInFlightRef.current = false;
      setState("listening");
    }
  }, []);
  const endTurnRef = useRef(endTurn);
  endTurnRef.current = endTurn;

  /** True while an endTurn is between "started" and "floor handed over". */
  const endTurnInFlightRef = useRef(false);

  /**
   * Flush a turn the user FINISHED while the floor was elsewhere. Endpointing
   * only runs in "listening", so speech during the bot's thinking/speaking
   * transcribed into the composer but its ending moment passed unobserved —
   * the words sat there forever ("I talk and nothing sends"). When the floor
   * comes back, whatever is already fully spoken goes out immediately.
   * (After a barge-in we deliberately DON'T call this: the user is actively
   * mid-utterance and the detector owns that turn.)
   */
  const maybeFlushPendingTurnRef = useRef<() => void>(() => {});
  maybeFlushPendingTurnRef.current = () => {
    const controller = controllerRef.current;
    if (!controller || stoppingRef.current || endTurnInFlightRef.current) return;
    const pending = controller.getTranscript().trim();
    const words = pending ? pending.split(/\s+/).length : 0;
    if (words >= 2 && pending !== lastSentTextRef.current) {
      voiceDebugBus.event("s2c_pending_flush", pending.slice(0, 60));
      void endTurnRef.current();
    } else if (words === 0) {
      // Nothing real was said — clear any gated-period crumbs from the box.
      controller.resetTranscriptForNextTurn();
      turnTextRef.current = "";
      setInterimText("");
      optsRef.current.writeToComposer("");
    }
  };

  // ---- Floor watchdog -------------------------------------------------------
  // Claude-style recovery: the mic floor must NEVER stay trapped in a
  // transitional state. A submit that silently no-ops, a reply that streams
  // no speakable audio (TTS outage / code-only answer), or a zombie playback
  // would otherwise wedge the session in sending/thinking/speaking forever —
  // words keep appearing in the composer while endpointing is dead, so the
  // user can talk but nothing ever sends. Expire the state, restore listening.
  useEffect(() => {
    if (state !== "sending" && state !== "thinking" && state !== "speaking") return;
    stateEnteredAtRef.current = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const entered = stateEnteredAtRef.current;
      // "thinking" makes progress on every streamed delta — measure from the
      // latest one so genuinely-long generations aren't cut off.
      const progress =
        state === "thinking"
          ? Math.max(entered, lastReplyDeltaAtRef.current || entered)
          : entered;
      const budget =
        state === "sending" ? 8_000 : state === "thinking" ? 45_000 : 120_000;
      if (now - progress <= budget) return;
      voiceDebugBus.event(
        "s2c_watchdog",
        `${state} stalled ${Math.round((now - progress) / 1000)}s`,
      );
      suppressSpeechRef.current = false;
      detectorRef.current?.reset();
      setState("listening");
      // Whatever the user finished saying while we were stuck goes out now.
      maybeFlushPendingTurnRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  // ---- Mic management ------------------------------------------------------
  const startMicRef = useRef<() => Promise<void>>(async () => {});

  const reopenMicRef = useRef(async (): Promise<void> => {
    if (reopeningMicRef.current) return; // a reopen is already in flight
    reopeningMicRef.current = true;
    try {
      // Transient STT failures must SELF-HEAL, not kill hands-free mode:
      // retry with backoff and only drop to "off" after all attempts fail.
      // Every failure reason lands in the debug bus — a recurrence names
      // its culprit instead of dying silently.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await startMicRef.current();
          voiceDebugBus.event("s2c_reopened", `attempt ${attempt}`);
          return;
        } catch (err) {
          voiceDebugBus.event(
            "s2c_reopen_failed",
            `attempt ${attempt}: ${String((err as Error)?.message ?? err).slice(0, 140)}`,
          );
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      }
      optsRef.current.onError?.("ws");
      teardownRef.current();
      setState("off");
    } finally {
      reopeningMicRef.current = false;
    }
  });

  const startMic = useCallback(async () => {
    const controller = new DictationController({
      gateFrame: () =>
        mutedRef.current ||
        (halfDuplexRef.current && stateRef.current === "speaking"),
      onStateChange: (s: DictationState) => {
        if (s === "error" && stateRef.current !== "off") {
          // Same recovery ladder as a dropped socket — never hard-off here.
          // The failed controller already cleaned itself up internally.
          controllerRef.current = null;
          void reopenMicRef.current();
          return;
        }
        // Session cap auto-stopped capture mid-conversation (relay 4028 or
        // the client timer). This can land in ANY sub-state — thinking or
        // speaking included — and skipping the reopen there killed the whole
        // hands-free session after a message or two. Reopen whenever the
        // session itself is still alive.
        if (
          s === "idle" &&
          !stoppingRef.current &&
          stateRef.current !== "off" &&
          stateRef.current !== "connecting"
        ) {
          void reopenMicRef.current();
        }
      },
      onInterim: () => {
        // COMPOSED display: locked-in finals + the live interim. Deepgram
        // interims cover ONLY their own utterance, so writing them raw made
        // earlier segments vanish whenever server-side endpointing split a
        // mid-thought pause; appending finals onto their identical interim
        // flashed duplicates. getTranscript() folds both sides cleanly —
        // same append-only model Claude-style captions use.
        const composed = controllerRef.current?.getTranscript() ?? "";
        turnTextRef.current = composed;
        setInterimText(composed);
        optsRef.current.writeToComposer(composed);
        voiceDebugBus.event("s2c_interim", composed.slice(0, 60));
      },
      onFinalSegment: () => {
        // The controller already folded this segment into its finals before
        // emitting — re-read the composition instead of appending here
        // (appending onto the matching interim duplicated it visually).
        const composed = controllerRef.current?.getTranscript() ?? "";
        turnTextRef.current = composed;
        setInterimText(composed);
        optsRef.current.writeToComposer(composed);
      },
      onRms: (rms, zcr) => handleRmsRef.current(rms, zcr),
      // Full relay visibility in the ?voiceDebug=1 overlay: ready/partial/
      // final/ws_close/mic_config — pinpoints the broken hop in one test.
      onEvent: (evt) => {
        voiceDebugBus.event(`relay_${evt.kind}`, evt.detail);
      },
    });
    controllerRef.current = controller;
    await controller.start();
    // Feed the orb/waveform: mic loudness drives the visuals while listening.
    const ctx = controller.audioContextRef;
    const stream = controller.mediaStreamRef;
    if (ctx && stream) voiceAmbience.attachMic(ctx, stream);
  }, []);
  startMicRef.current = startMic;

  const handleRms = useCallback((rms: number, zcr?: number) => {
    const st = stateRef.current;
    if (st === "speaking") {
      // Barge-in detection: sustain loud input -> stop the bot talking
      const now = Date.now();
      if (rms >= BARGE_IN_LOUD_RMS) {
        if (!bargeFirstLoudTsRef.current) bargeFirstLoudTsRef.current = now;
        else if (now - bargeFirstLoudTsRef.current >= BARGE_IN_SUSTAIN_MS) {
          bargeFirstLoudTsRef.current = 0;
          for (const ac of httpFetchesRef.current) ac.abort();
          httpFetchesRef.current.clear();
          playerRef.current?.stopAll();
          // The interrupted assistant turn is DEAD for speech. Its message
          // usually keeps streaming deltas and ElevenLabs keeps emitting
          // chunks flushed before the cut — without this flag both resurrect
          // the bot's voice over the user mid-interruption. Cleared by
          // endTurn() when the user's next turn actually sends.
          suppressSpeechRef.current = true;
          // Stop the generation itself (truncate): the runtime aborts the
          // chat request, the backend sees the disconnect and persists only
          // what was actually generated — context stays truthful.
          cancelActiveRunRef.current();
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
    const turnText = turnTextRef.current;
    const localIncomplete = isLikelyIncomplete(turnText);
    // Trust the model verdict only while it matches the CURRENT transcript —
    // anything older is stale and falls back to the local heuristic.
    const remote = remoteVerdictRef.current;
    const verdictFresh = !!remote && remote.text === turnText;
    const semanticContinuation =
      localIncomplete || (verdictFresh ? !remote.verdict.complete : false);
    const decision = detectorRef.current?.feed(
      rms,
      semanticContinuation,
      zcr,
      verdictFresh ? remote.verdict : null,
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
        voiceKaraoke.endTurn();
        karaokeTickStopRef.current?.();
        karaokeTickStopRef.current = null;
        if (stateRef.current === "speaking") {
          // Queue drained — hand the floor back to the user
          suppressSpeechRef.current = false;
          detectorRef.current?.reset();
          setState("listening");
          // The user may have FINISHED a whole sentence while the bot was
          // talking or thinking (endpointing sleeps outside "listening") —
          // send it now instead of leaving it stuck in the composer.
          maybeFlushPendingTurnRef.current();
        }
      } else {
        if (!speakStartedAtRef.current) speakStartedAtRef.current = Date.now();
        setState((s) => (s === "thinking" || s === "listening" ? "speaking" : s));
        // ~10 Hz playhead → karaoke highlight sync.
        if (!karaokeTickStopRef.current) {
          const id = window.setInterval(() => {
            const player = playerRef.current;
            if (player?.speaking) voiceKaraoke.tick(player.playbackSeconds);
          }, 100);
          karaokeTickStopRef.current = () => window.clearInterval(id);
        }
      }
    });
    // Bot playback loudness drives the orb while speaking. Eager tap: the
    // audio graph exists before the first chunk so the probe never misses.
    const agentTap = playerRef.current.getAnalyserTap();
    if (agentTap) voiceAmbience.attachAgent(agentTap);

    // Open the ElevenLabs streaming TTS WebSocket (non-blocking: a connect
    // failure is silent — speakSentence() falls back to the HTTP route).
    ttsStreamRef.current = new ElevenLabsStreamingTts(
      { voiceId: personaIdRef.current, autoMode: true },
      {
        onAudio: (chunk) => {
          // Post-barge-in tail: chunks for text flushed before the interrupt
          // keep arriving on the open socket — drop them, don't resurrect.
          if (suppressSpeechRef.current) return;
          // Forward the MP3 chunk straight to the existing player queue.
          // The player's enqueue() decodes asynchronously so it never blocks
          // the WS callback.
          playerRef.current?.enqueue(chunk.slice(0)).catch(() => undefined);
        },
        onAlignment: (words) => {
          // Word timestamps are chunk-relative; offset them to turn-relative
          // using the queue position at enqueue time (same order as audio).
          const offset = chunkTimingOffsetRef.current;
          voiceKaraoke.pushTimings(words, offset);
          // Approximate the NEXT chunk's start from this chunk's last end.
          const last = words[words.length - 1];
          if (last) chunkTimingOffsetRef.current = offset + last.end;
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

    splitterRef.current = new StreamingSentenceSplitter({ eagerFirstChunk: true });
    turnTextRef.current = "";
    lastSentTextRef.current = "";
    suppressSpeechRef.current = false;
    remoteVerdictRef.current = null;
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
    for (const ac of httpFetchesRef.current) ac.abort();
    httpFetchesRef.current.clear();
    controllerRef.current?.stop().catch(() => undefined);
    playerRef.current?.stopAll();
    ttsStreamRef.current?.endStream();
    ttsStreamRef.current?.close();
    ttsStreamRef.current = null;
    voiceAmbience.reset();
    teardownRef.current();
    setInterimText("");
    setState("off");
  }, []);

  function teardown() {
    stoppingRef.current = true;
    // HARD RULE: never orphan a live controller. Dropping the ref without
    // stopping it leaves mic + socket running as a ghost — UI shows voice
    // "off" while dictation keeps filling the composer with text that can
    // never be sent (the exact auto-dead session users reported).
    controllerRef.current?.abort();
    controllerRef.current = null;
    detectorRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    splitterRef.current = null;
    turnTextRef.current = "";
    remoteVerdictRef.current = null;
    if (semanticTimerRef.current) {
      window.clearTimeout(semanticTimerRef.current);
      semanticTimerRef.current = null;
    }
    halfDuplexRef.current = false;
    echoStreakRef.current = 0;
    speakStartedAtRef.current = 0;
  }
  teardownRef.current = teardown;

  useEffect(() => {
    return () => {
      for (const ac of httpFetchesRef.current) ac.abort();
      httpFetchesRef.current.clear();
      controllerRef.current?.stop().catch(() => undefined);
      playerRef.current?.destroy();
      if (semanticTimerRef.current) window.clearTimeout(semanticTimerRef.current);
      voiceAmbience.reset();
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

  // Debug overlay (?voiceDebug=1) mirrors the state machine for diagnosis;
  // the ambience controller rides the same signal to gate its probes.
  useEffect(() => {
    voiceDebugBus.event("s2c_state", state);
    voiceDebugBus.setState(state === "off" ? "idle" : `s2c:${state}`);
    voiceAmbience.setState(AMBIENCE_OF_STATE[state]);
  }, [state]);

  return { state, busy, muted, setMuted, start, stop, setPersona, personaId, interimText };
}
