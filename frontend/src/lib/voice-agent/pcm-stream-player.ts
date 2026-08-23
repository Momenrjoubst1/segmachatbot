/**
 * PcmStreamPlayer — streaming playback of raw PCM16 LE mono frames.
 *
 * The Voice Agent streams raw audio chunks over the same WebSocket as the
 * events; there is no container and no MP3 decoding — chunks are scheduled
 * back-to-back on a 24 kHz AudioContext for gapless speech.
 *
 * Barge-in contract: stopAll() must silence output IMMEDIATELY (the agent
 * sends "UserStartedSpeaking" the moment the user talks). Every scheduled
 * source is stopped at once; pushes after stopAll() are accepted again right
 * away — unlike the old MP3 queue, there is no dead window.
 */

interface ScheduledSource {
  source: AudioBufferSourceNode;
  endAt: number;
}

export class PcmStreamPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources = new Set<ScheduledSource>();
  private nextStartTime = 0;
  private speaking = false;

  constructor(private readonly onSpeakingChange?: (speaking: boolean) => void) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Sample rate declared in the agent Settings `audio.output` block. */
  static readonly OUTPUT_SAMPLE_RATE = 24000;

  private async ensureCtx(): Promise<AudioContext | null> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor({ sampleRate: PcmStreamPlayer.OUTPUT_SAMPLE_RATE });
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /**
   * Queue one raw PCM16LE mono chunk. Safe to call at event rate —
   * scheduling is O(n) in samples with no allocations beyond the buffer.
   */
  async push(chunk: ArrayBuffer): Promise<void> {
    const ctx = await this.ensureCtx();
    if (!ctx || chunk.byteLength < 2) return;

    const src = new Int16Array(
      chunk.byteLength % 2 === 0 ? chunk : chunk.slice(0, chunk.byteLength - 1),
    );
    if (src.length === 0) return;

    // Int16 → Float32 in [-1, 1]
    const floats = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      floats[i] = src[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, floats.length, ctx.sampleRate);
    buffer.copyToChannel(floats, 0);

    // Seamless chaining: schedule at the tail of everything queued so far,
    // or just ahead of "now" when the pipeline has gone quiet.
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.05, this.nextStartTime);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.connect(ctx.destination);
    }
    node.connect(this.gain);

    const entry: ScheduledSource = { source: node, endAt: startAt + buffer.duration };
    this.sources.add(entry);
    this.setSpeaking(true);

    node.onended = () => {
      this.sources.delete(entry);
      if (this.sources.size === 0) this.setSpeaking(false);
    };

    try {
      node.start(startAt);
      this.nextStartTime = entry.endAt;
    } catch {
      this.sources.delete(entry);
      if (this.sources.size === 0) this.setSpeaking(false);
    }
  }

  setVolume(v: number): void {
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Tap for UI ambience: the master gain node feeding the destination.
   * Callers may connect an AnalyserNode to it; playback is unaffected.
   * Returns null before the first push() creates the audio graph.
   */
  getOutputTap(): { node: AudioNode; context: AudioContext } | null {
    if (!this.gain || !this.ctx) return null;
    return { node: this.gain, context: this.ctx };
  }

  /**
   * Kill all scheduled/playing audio NOW (barge-in / turn stop / teardown).
   *
   * Sources cut mid-waveform end at full amplitude → an audible click on
   * every barge-in. A ~6 ms gain fade masks the discontinuity while staying
   * well inside "instant" barge-in latency, then sources are hard-stopped.
   * Audio pushed DURING the fade window (generation bump) is left alone.
   */
  stopAll(): void {
    const ctx = this.ctx;
    const gain = this.gain;
    if (!ctx || !gain || this.sources.size === 0) {
      this.hardStopSources();
      return;
    }
    const generation = ++this.stopGeneration;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.006);
    } catch { /* graph gone — fall through to hard stop */ }
    // Hard-stop after the fade window; restore headroom for the next turn.
    setTimeout(() => {
      if (generation === this.stopGeneration) this.hardStopSources();
      if (ctx && gain) {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.setValueAtTime(1, ctx.currentTime);
        } catch { /* noop */ }
      }
    }, 30);
  }

  private stopGeneration = 0;

  private hardStopSources(): void {
    for (const entry of [...this.sources]) {
      try { entry.source.onended = null; } catch { /* noop */ }
      try { entry.source.stop(); } catch { /* already stopped */ }
      try { entry.source.disconnect(); } catch { /* noop */ }
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.setSpeaking(false);
  }

  destroy(): void {
    this.stopAll();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.gain = null;
  }

  private setSpeaking(v: boolean): void {
    if (this.speaking === v) return;
    this.speaking = v;
    this.onSpeakingChange?.(v);
  }
}
