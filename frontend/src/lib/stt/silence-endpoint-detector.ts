/**
 * Turn-endpointing state machine for live voice chat.
 *
 * Pure and clock-injected so it is fully unit-testable. Implements the
 * production heuristics from voice-AI practice:
 *
 *  - Never endpoint before the user has actually spoken (pre-speech silence
 *    must not trigger a send).
 *  - Hysteresis: speech opens above `speechStartRms` and only counts as
 *    finished below `speechHoldRms` (avoids flicker on plosives/breath —
 *    this IS the hangover; a separate hangover timer would self-perpetuate).
 *  - Semantic extension: when the partial transcript ends mid-clause
 *    (conjunction/preposition/dangling colon), require extra silence before
 *    firing — users pause to think mid-sentence.
 *  - Backstops: minimum utterance length (ignore blips) and maximum utterance
 *    length (never let a noisy room hold the turn hostage).
 */

export type EndpointReason =
  | "silence"
  | "semantic_silence"
  | "semantic_complete"
  | "max_utterance";

export interface EndpointDecision {
  endpoint: boolean;
  reason?: EndpointReason;
}

/** Latest semantic verdict for the live transcript, when one exists. */
export interface SemanticVerdict {
  complete: boolean;
}

export interface EndpointConfig {
  /** Base silence required after last voiced sample (ms). */
  silenceMs: number;
  /** RMS needed to open the speech gate. */
  speechStartRms: number;
  /** RMS below which we consider the speaker paused (hysteresis). */
  speechHoldRms: number;
  /**
   * ZCR above which a frame is treated as noise even when loud (0..1).
   * Speech fundamentals sit below ~0.15; hiss/fans/keyboard clatter cross
   * 0.3+. Frames with zcr > zcrNoiseMax AND rms < speechStartRms*1.6 are
   * ignored for gate-opening. undefined disables the check.
   */
  zcrNoiseMax?: number;
  /** Extra silence added when transcript looks mid-clause (ms). */
  semanticExtendMs: number;
  /** Ignore endpoints for utterances shorter than this (ms). */
  minUtteranceMs: number;
  /** Force-send once an utterance runs this long (ms). */
  maxUtteranceMs: number;
  /**
   * Silence needed to trust a POSITIVE semantic verdict ("user finished").
   * Shorter than `silenceMs` — this is what makes confirmed-complete turns
   * hand over FASTER than pure silence ever could.
   */
  semanticConfirmMs: number;
}

export const DEFAULT_ENDPOINT_CONFIG: EndpointConfig = {
  // Tuned for conversational snappiness: Claude/Grok-class products send
  // after ~500-700ms of silence. 600ms + the Arabic-aware incomplete guard
  // feels near-instant without clipping mid-clause pauses.
  silenceMs: 600,
  speechStartRms: 350,
  speechHoldRms: 220,
  zcrNoiseMax: 0.35,
  semanticExtendMs: 350,
  minUtteranceMs: 700,
  maxUtteranceMs: 60_000,
  semanticConfirmMs: 320,
};

export class SilenceEndpointDetector {
  private cfg: EndpointConfig;
  private now: () => number;

  private speechStarted = false;
  private lastVoicedTs = 0;
  private utteranceStartTs = 0;

  constructor(
    config?: Partial<EndpointConfig>,
    clock: () => number = () => Date.now(),
  ) {
    this.cfg = { ...DEFAULT_ENDPOINT_CONFIG, ...config };
    this.now = clock;
  }

  reset(): void {
    this.speechStarted = false;
    this.lastVoicedTs = 0;
    this.utteranceStartTs = 0;
  }

  get hasSpoken(): boolean {
    return this.speechStarted;
  }

  /**
   * Feed one audio frame's RMS (+ optional ZCR).
   *
   * @param rms Int16-domain root-mean-square of the frame.
   * @param semanticContinuation true while the live transcript looks like an
   *        unfinished clause ("...و", "...that", trailing comma/colon).
   * @param zcr Zero-crossing rate in [0,1] — optional noise discriminator.
   *        Loud frames with very high ZCR (hiss/fans) do not open the gate.
   * @param semantic Latest model verdict for the live transcript, when one
   *        exists. `complete: true` enables the EARLY endpoint at
   *        `semanticConfirmMs` — faster than any silence timer. Absent/null
   *        (no verdict yet, stale, or engine off) keeps pure-silence timing.
   */
  feed(
    rms: number,
    semanticContinuation = false,
    zcr?: number,
    semantic?: SemanticVerdict | null,
  ): EndpointDecision {
    const t = this.now();

    if (!this.speechStarted) {
      // Noise gate: loud-but-noisy frames (high zero-crossing rate — hiss,
      // fans, keyboard clatter) must not open the speech gate on their own.
      const zcrNoisy =
        zcr !== undefined &&
        this.cfg.zcrNoiseMax !== undefined &&
        zcr > this.cfg.zcrNoiseMax &&
        rms < this.cfg.speechStartRms * 1.6;
      if (!zcrNoisy && rms >= this.cfg.speechStartRms) {
        this.speechStarted = true;
        this.utteranceStartTs = t;
        this.lastVoicedTs = t;
      }
      // Pre-speech silence NEVER ends a turn.
      return { endpoint: false };
    }

    if (rms >= this.cfg.speechHoldRms) {
      this.lastVoicedTs = t;
    }
    // Note: no hangover refresh here — refreshing during silence would make
    // the timer self-perpetuating. Hysteresis alone smooths plosives/breath.

    const utteranceLen = t - this.utteranceStartTs;

    if (utteranceLen >= this.cfg.maxUtteranceMs) {
      return { endpoint: true, reason: "max_utterance" };
    }

    const silenceFor = t - this.lastVoicedTs;
    const required =
      this.cfg.silenceMs + (semanticContinuation ? this.cfg.semanticExtendMs : 0);

    // Early hand-over: the semantic engine CONFIRMED the utterance is
    // complete, so a short quiet stretch is enough — this is the whole point
    // of model-based endpointing (Claude/Grok-class turn latency).
    if (
      semantic?.complete &&
      !semanticContinuation &&
      silenceFor >= this.cfg.semanticConfirmMs &&
      utteranceLen >= this.cfg.minUtteranceMs
    ) {
      return { endpoint: true, reason: "semantic_complete" };
    }

    if (
      silenceFor >= required &&
      utteranceLen >= this.cfg.minUtteranceMs
    ) {
      return {
        endpoint: true,
        reason: semanticContinuation ? "semantic_silence" : "silence",
      };
    }

    return { endpoint: false };
  }
}

/**
 * Heuristic: does this partial transcript look like an unfinished clause?
 * Used as the semantic-extension signal for endpointing. Deliberately cheap
 * (token list + punctuation), no model calls on the hot path.
 */

const CONTINUATION_TOKENS = new Set([
  // Arabic
  "و","أو","في","من","إلى","على","عن","أن","إن","لكن","ثم","مع","هذا","هذه",
  "التي","الذي","كل","بين","بعد","قبل","حتى","إذا","كما","لأن","عندما","هل",
  "ليش","كيف","وين","متى","شو","ايش","ايمتى",
  // English
  "the","a","an","and","or","but","so","if","of","to","in","on","with","for",
  "which","who","that","because","when","while","before","after","then","is",
  "are","was","were","my","our",
]);

export function isLikelyIncomplete(text: string): boolean {
  const trimmed = text.replace(/[\s\u200f\u200e]+$/g, "");
  if (!trimmed) return false;
  // Dangling punctuation clearly mid-thought:
  if (/[:،,;\-–—]$/.test(trimmed)) return true;
  const lastToken = trimmed.split(/\s+/).pop() ?? "";
  return CONTINUATION_TOKENS.has(lastToken.toLowerCase());
}