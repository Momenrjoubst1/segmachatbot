/**
 * AudioQueuePlayer — sequential MP3 playback for live voice replies.
 *
 * - Single lazily-created AudioContext (resumed on gesture-driven flows;
 *   Safari-safe).
 * - enqueue(arrayBuffer) decodes and appends; items play back-to-back.
 * - stopAll() aborts current + queued instantly (barge-in / turn stop);
 *   every pending promise resolves(false) exactly once.
 * - onSpeakingChange drives the "speaking" UI state.
 */

interface QueueItem {
  encoded: ArrayBuffer;
  resolve: (played: boolean) => void;
}

export class AudioQueuePlayer {
  private ctx: AudioContext | null = null;
  private queue: QueueItem[] = [];
  private playing = false;
  private stopped = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  constructor(private onSpeakingChange?: (speaking: boolean) => void) {}

  get speaking(): boolean {
    return this.playing;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  private async ensureCtx(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /** Append encoded audio to the queue. Resolves false if never played. */
  enqueue(encoded: ArrayBuffer): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (this.stopped) {
        resolve(false);
        return;
      }
      this.queue.push({ encoded, resolve });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.playing || this.stopped) return;
    const item = this.queue.shift();
    if (!item) {
      this.onSpeakingChange?.(false);
      return;
    }
    await this.playItem(item);
  }

  private async playItem(item: QueueItem): Promise<void> {
    let decoded: AudioBuffer | null = null;
    try {
      const ctx = await this.ensureCtx();
      decoded = await ctx.decodeAudioData(item.encoded.slice(0));
    } catch {
      item.resolve(false);
      void this.drain();
      return;
    }
    if (this.stopped || !decoded) {
      item.resolve(false);
      void this.drain();
      return;
    }

    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.connect(ctx.destination);
    }
    src.connect(this.gain);

    const wasPlaying = this.playing;
    this.playing = true;
    this.currentSource = src;
    if (!wasPlaying) this.onSpeakingChange?.(true);

    let settled = false;
    const done = (played: boolean) => {
      if (settled) return;
      settled = true;
      if (this.currentSource === src) this.currentSource = null;
      item.resolve(played);
      // Chain after a microtask so stopAll() during onended still wins.
      setTimeout(() => void this.drain(), 0);
    };

    src.onended = () => done(true);
    try {
      src.start();
    } catch {
      done(false);
    }
  }

  setVolume(v: number): void {
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Stop everything immediately; all pending items resolve(false).
   * Re-armed automatically for the next turn.
   *
   * The playing source is cut through a ~6 ms gain fade first — stopping a
   * buffer mid-waveform at full amplitude clicks audibly on every barge-in.
   */
  stopAll(): void {
    this.stopped = true;

    const ctx = this.ctx;
    const gain = this.gain;
    const src = this.currentSource;
    this.currentSource = null;

    if (src && ctx && gain) {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.006);
      } catch { /* graph gone — fall back to hard stop */ }
      setTimeout(() => {
        try { src.stop(); } catch { /* already stopped */ }
        if (gain && ctx) {
          try {
            gain.gain.cancelScheduledValues(ctx.currentTime);
            gain.gain.setValueAtTime(1, ctx.currentTime);
          } catch { /* noop */ }
        }
      }, 30);
    }

    const pending = [...this.queue];
    this.queue = [];
    for (const it of pending) it.resolve(false);

    this.playing = false;
    this.onSpeakingChange?.(false);

    setTimeout(() => {
      this.stopped = false;
    }, 0);
  }

  destroy(): void {
    this.stopAll();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.gain = null;
  }
}