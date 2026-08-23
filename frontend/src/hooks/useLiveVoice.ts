/**
 * useLiveVoice — orchestrator for Claude/Grok-style live conversation.
 *
 * Owns the full turn cycle:
 *   listening ──endpoint──► sending ──► thinking ──► speaking ──┐
 *        ▲                                                      │
 *        └────────────────── queue drained ◄────────────────────┘
 *
 * - Endpointing: SilenceEndpointDetector fed by mic RMS (via DictationController).
 * - Auto-send: writes final transcript into the composer and requestSubmit()
 *   the composer form (decoupled from runtime internals).
 * - Voice replies: watches the streaming assistant message, splits complete
 *   sentences, synthesizes via /api/tts, plays sequentially (AudioQueuePlayer).
 * - Barge-in: sustained user loudness while the bot speaks stops playback
 *   instantly and returns to listening.
 * - Degradation: TTS failure flips to text-only for the session (one toast).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  DictationController,
  type DictationState,
} from "@/lib/stt/deepgram-dictation";
import {
  SilenceEndpointDetector,
  isLikelyIncomplete,
} from "@/lib/stt/silence-endpoint-detector";
import {
  AudioQueuePlayer,
} from "@/lib/tts/audio-player";
import {
  StreamingSentenceSplitter,
} from "@/lib/tts/sentence-splitter";
import {
  synthesizeChunk,
  TtsError,
} from "@/lib/tts/tts-client";

export type LiveVoiceState =
  | "off"
  | "listening"
  | "sending"
  | "thinking"
  | "speaking";

export interface UseLiveVoiceOptions {
  personaId: string;
  /** Writes the given text into the composer input. */
  writeToComposer: (text: string) => void;
  /** Programmatically submits the composer form. */
  submitComposer: () => void;
  /** Called once when TTS becomes unavailable (show a single toast). */
  onTtsUnavailable?: () => void;
}

const BARGE_IN_LOUD_RMS = 550; // above normal speech gate: avoids TTS bleed
const BARGE_IN_SUSTAIN_MS = 350;

function extractMessageText(content: readonly unknown[]): string {
  let out = "";
  for (const part of content as Array<{ type?: string; text?: string }>) {
    if (part?.type === "text" && typeof part.text === "string") out += part.text;
  }
  return out;
}

export function useLiveVoice(opts: UseLiveVoiceOptions) {
  const [state, setState] = useState<LiveVoiceState>("off");

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const controllerRef = useRef<DictationController | null>(null);
  const detectorRef = useRef<SilenceEndpointDetector | null>(null);
  const playerRef = useRef<AudioQueuePlayer | null>(null);
  const splitterRef = useRef<StreamingSentenceSplitter | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const turnTextRef = useRef("");
  const lastSentTextRef = useRef("");
  const suppressSpeechRef = useRef(false); // after barge-in until next send
  const bargeFirstLoudTsRef = useRef(0);

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
    for (const sentence of splitter.push(delta)) void speakSentence(sentence);
  }, [messages, state]);

  // ---- Speech synthesis + playback ----------------------------------------
  const speakSentence = useCallback(async (sentence: string) => {
    const player = playerRef.current;
    if (!player) return;
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    try {
      const audio = await synthesizeChunk(
        sentence,
        optsRef.current.personaId,
        ac.signal,
      );
      await player.enqueue(audio.slice(0));
    } catch (err) {
      if (err instanceof TtsError && err.kind === "unavailable") {
        suppressSpeechRef.current = true;
        optsRef.current.onTtsUnavailable?.();
      }
      // aborted / network blips: skip silently — text still flows
    }
  }, []);

  // ---- Turn ending / auto-send --------------------------------------------
  const endTurn = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    setState("sending");
    try {
      await controller.stop(); // flushes Deepgram finals
    } catch { /* keep going with what we have */ }

    const text = turnTextRef.current.trim();
    const words = text ? text.split(/\s+/).length : 0;

    if (words >= 2 && text !== lastSentTextRef.current) {
      lastSentTextRef.current = text;
      suppressSpeechRef.current = false;
      splitterRef.current = new StreamingSentenceSplitter();
      seenMsgRef.current = { id: "", len: 0 };
      detectorRef.current?.reset();
      turnTextRef.current = "";
      optsRef.current.submitComposer();
      setState("thinking");
      // Mic re-opens automatically below so the next turn can start while
      // the bot thinks/speaks.
      void reopenMic();
    } else {
      // Blip/noise or duplicate — discard and keep listening
      turnTextRef.current = "";
      detectorRef.current?.reset();
      optsRef.current.writeToComposer("");
      setState("listening");
      void reopenMic();
    }
  }, []);

  // ---- Mic management ------------------------------------------------------
  const stateRef = useRef<LiveVoiceState>(state);
  stateRef.current = state;

  const startMicRef = useRef<() => Promise<void>>(async () => {});

  const reopenMic = useCallback(async () => {
    try {
      await startMicRef.current();
    } catch {
      setState("off");
    }
  }, []);

  const startMic = useCallback(async () => {
    const controller = new DictationController({
      onStateChange: (s: DictationState) => {
        if (s === "error" && stateRef.current !== "off") setState("off");
      },
      onInterim: (t) => {
        turnTextRef.current = t;
        optsRef.current.writeToComposer(t);
      },
      onFinalSegment: (seg) => {
        turnTextRef.current = (turnTextRef.current + " " + seg).trim();
        optsRef.current.writeToComposer(turnTextRef.current);
      },
      onRms: (rms) => handleRms(rms),
      onEvent: () => {},
    });
    controllerRef.current = controller;
    await controller.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRms = useCallback((rms: number) => {
    const st = stateRef.current;
    if (st === "speaking") {
      // Barge-in detection: sustain loud input -> stop the bot talking
      const now = Date.now();
      if (rms >= BARGE_IN_LOUD_RMS) {
        if (!bargeFirstLoudTsRef.current) bargeFirstLoudTsRef.current = now;
        else if (now - bargeFirstLoudTsRef.current >= BARGE_IN_SUSTAIN_MS) {
          bargeFirstLoudTsRef.current = 0;
          playerRef.current?.stopAll();
          abortRef.current?.abort();
          setState("listening");
        }
      } else {
        bargeFirstLoudTsRef.current = 0;
      }
      return;
    }
    if (st !== "listening") return;
    const decision = detectorRef.current?.feed(
      rms,
      isLikelyIncomplete(turnTextRef.current),
    );
    if (decision?.endpoint) void endTurn();
  }, [endTurn]);

  // ---- Public controls ------------------------------------------------------
  const start = useCallback(async () => {
    if (controllerRef.current) return;
    detectorRef.current = new SilenceEndpointDetector();
    playerRef.current = new AudioQueuePlayer((speaking) => {
      if (!speaking && stateRef.current === "speaking") {
        // Queue drained — hand the floor back to the user
        suppressSpeechRef.current = false;
        detectorRef.current?.reset();
        setState("listening");
      } else if (speaking) {
        setState("speaking");
      }
    });
    splitterRef.current = new StreamingSentenceSplitter();
    turnTextRef.current = "";
    lastSentTextRef.current = "";
    suppressSpeechRef.current = false;
    seenMsgRef.current = { id: "", len: 0 };
    setState("listening");
    try {
      await startMic();
    } catch {
      teardown();
      setState("off");
    }
  }, [startMic]);
  startMicRef.current = startMic;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    controllerRef.current?.stop().catch(() => undefined);
    playerRef.current?.stopAll();
    teardown();
    setState("off");
  }, []);

  function teardown() {
    controllerRef.current = null;
    detectorRef.current = null;
    playerRef.current?.destroy();
    playerRef.current = null;
    splitterRef.current = null;
    turnTextRef.current = "";
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      controllerRef.current?.stop().catch(() => undefined);
      playerRef.current?.destroy();
    };
  }, []);

  const busy = useMemo(
    () => state === "sending" || state === "thinking",
    [state],
  );

  return { state, busy, start, stop };
}