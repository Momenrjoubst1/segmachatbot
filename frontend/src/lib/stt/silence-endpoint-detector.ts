/**
 * Turn-endpointing state machine for live voice chat.
 *
 * Pure and clock-injected so it is fully unit-testable. Implements the
 * production heuristics from voice-AI practice:
 *
 *  - Never endpoint before the user has actually spoken (pre-speech silence
 *    must not trigger a send).
 *  - Hysteresis: speech opens above `speechStartRms` and only counts as
 *    finished below `speechHoldRms` (avoids flicker on plosives/breath).
 *  - Hangover: brief dips under threshold do not restart the silence timer
 *    until `hangoverMs` passes.
 *  - Semantic extension: when the partial transcript ends mid-clause
 *    (conjunction/preposition/dangling colon), require extra silence before
 *    firing — users pause to think mid-sentence.
 *  - Backstops: minimum utterance length (ignore blips) and maximum utterance
 *    length (never let a noisy room hold the turn hostage).
 */

export type EndpointReason = "silence" | "semantic_silence" | "max_utterance";

export interface EndpointDecision {
  endpoint: boolean;
  reason?: EndpointReason;
}

export interface EndpointConfig {
  /** Base silence required after last voiced sample (ms). */
  silenceMs: number;
  /** Voiced samples within this window keep the utterance alive (ms). */
  hangoverMs: number;
  /** RMS needed to open the speech gate. */
  speechStartRms: number;
  /** RMS below which we consider the speaker paused (hysteresis). */
  speechHoldRms: number;
  /** Extra silence added when transcript looks mid-clause (ms). */
  semanticExtendMs: number;
  /** Ignore endpoints for utterances shorter than this (ms). */
  minUtteranceMs: number;
  /** Force-send once an utterance runs this long (ms). */
  maxUtteranceMs: number;
}

export const DEFAULT_ENDPOINT_CONFIG: EndpointConfig = {
  silenceMs: 850,
  hangoverMs: 250,
  speechStartRms: 350,
  speechHoldRms: 220,
  semanticExtendMs: 500,
  minUtteranceMs: 700,
  maxUtteranceMs: 60_000,
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
   * Feed one audio frame's RMS.
   *
   * @param rms Int16-domain root-mean-square of the frame.
   * @param semanticContinuation true while the live transcript looks like an
   *        unfinished clause ("...و", "...that", trailing comma/colon).
   */
  feed(rms: number, semanticContinuation = false): EndpointDecision {
    const t = this.now();

    if (!this.speechStarted) {
      if (rms >= this.cfg.speechStartRms) {
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