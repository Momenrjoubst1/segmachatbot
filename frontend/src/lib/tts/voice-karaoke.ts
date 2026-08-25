/**
 * voiceKaraokeBridge — tiny pub/sub carrying the live TTS word-highlight
 * state from the audio pipeline (useSpeakToChat) to the message list UI.
 *
 * Why a bridge and not React context: the highlight state changes ~10x/sec
 * during playback; threading it through context would re-render the whole
 * tree. Instead, only the ONE speaking message's karaoke component
 * subscribes, and updates land via direct DOM writes on its own words.
 *
 * Model:
 *   - startTurn(fullText): called when the bot reply starts being spoken;
 *     carries the complete text so the component can split into words.
 *   - pushTimings(words, chunkOffsetSec): ElevenLabs alignment for one
 *     audio chunk; times are already offset to turn-relative seconds by
 *     the caller.
 *   - tick(playbackSec): driven ~10x/sec by the player's currentTime —
 *     computes the active word index and notifies subscribers.
 *   - endTurn(): playback finished or stopped; clears state.
 */

import type { WordTiming } from "./elevenlabs-streaming";

export interface KaraokeState {
  /** Turn-relative second of speech position. */
  position: number;
  /** Index of the currently-spoken word (-1 = not started yet). */
  activeIndex: number;
}

type Listener = (s: KaraokeState) => void;

class VoiceKaraokeBridge {
  private listeners = new Set<Listener>();
  private timings: WordTiming[] = [];
  private starts: number[] = [];
  private fullText = "";
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  getText(): string {
    return this.fullText;
  }

  startTurn(fullText: string): void {
    this.fullText = fullText;
    this.timings = [];
    this.starts = [];
    this.active = true;
    this.emit({ position: 0, activeIndex: -1 });
  }

  /** Streaming update: the reply text grew; keep timings already collected. */
  updateText(fullText: string): void {
    this.fullText = fullText;
  }

  pushTimings(words: WordTiming[], chunkOffsetSec: number): void {
    if (!this.active) return;
    for (const w of words) {
      this.starts.push(chunkOffsetSec + w.start);
      this.timings.push(w);
    }
  }

  /**
   * Advance the playhead. `playbackSec` is turn-relative seconds of audio
   * actually played so far. Binary-searches the word starts.
   */
  tick(playbackSec: number): void {
    if (!this.active) return;
    let lo = 0;
    let hi = this.starts.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= playbackSec) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    this.emit({ position: playbackSec, activeIndex: idx });
  }

  endTurn(): void {
    if (!this.active && this.timings.length === 0) return;
    this.active = false;
    this.timings = [];
    this.starts = [];
    this.emit({ position: 0, activeIndex: -1 });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(s: KaraokeState): void {
    for (const fn of this.listeners) fn(s);
  }
}

export const voiceKaraoke = new VoiceKaraokeBridge();
