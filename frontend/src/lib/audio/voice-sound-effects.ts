/**
 * Web Audio API Sound Effects Manager for Voice Mode.
 *
 * - Pre-loads and decodes 'voice-start.mp3' into memory for zero-latency instant playback.
 * - Start Sound: Plays voice-start.mp3 directly at normal speed (playbackRate = 1.0, volume = 0.65).
 * - Stop Sound: Programmatically derives a descending, low-pitch deactivation sound from the same
 *   audio buffer (playbackRate = 0.72 + lowpass filter).
 * - Manages rapid toggling and overlapping audio with smooth gain crossfades.
 * - Includes a fallback synthesizer if the audio file fails to load.
 */

const AUDIO_SRC = `${import.meta.env.BASE_URL || "/"}voice-start.mp3`;

class VoiceSoundEffects {
  private ctx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private isPreloading = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;

  constructor() {
    // Eagerly preload in browser environment when idle or on first load
    if (typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => void this.preload());
      } else {
        setTimeout(() => void this.preload(), 500);
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /**
   * Pre-load and decode the MP3 file into memory.
   */
  async preload(): Promise<AudioBuffer | null> {
    if (this.audioBuffer) return this.audioBuffer;
    if (this.isPreloading) return null;

    const ctx = this.getAudioContext();
    if (!ctx) return null;

    this.isPreloading = true;
    try {
      const response = await fetch(AUDIO_SRC);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      return this.audioBuffer;
    } catch {
      // Audio buffer will fall back to synthesized tones if not found
      return null;
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * Fade out and cancel any currently active sound to handle rapid toggles gracefully.
   */
  private stopCurrent(_ctx: AudioContext, now: number): void {
    if (this.currentGain && this.currentSource) {
      try {
        this.currentGain.gain.cancelScheduledValues(now);
        this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, now);
        this.currentGain.gain.linearRampToValueAtTime(0.0001, now + 0.04);
        this.currentSource.stop(now + 0.045);
      } catch {
        // Ignore if already stopped
      }
      this.currentGain = null;
      this.currentSource = null;
    }
  }

  /**
   * Play the Start Sound (voice-start.mp3 at playbackRate = 1.0, volume = 0.65).
   */
  playActivate(volume = 0.65): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      this.stopCurrent(ctx, now);

      if (this.audioBuffer) {
        const source = ctx.createBufferSource();
        source.buffer = this.audioBuffer;
        source.playbackRate.setValueAtTime(1.0, now);

        const gainNode = ctx.createGain();
        const safeVolume = Math.min(Math.max(volume, 0.05), 1.0);
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(safeVolume, now + 0.01);

        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        source.start(now);
        this.currentSource = source;
        this.currentGain = gainNode;

        source.onended = () => {
          if (this.currentSource === source) {
            this.currentSource = null;
            this.currentGain = null;
          }
        };
      } else {
        // Fallback: start preloading and use pure Web Audio synthesis
        void this.preload();
        this.synthesizeActivate(ctx, now, volume);
      }
    } catch {
      // Graceful fallback
    }
  }

  /**
   * Play the Stop Sound (Derived from voice-start.mp3 at playbackRate = 0.72 with lowpass filter).
   */
  playDeactivate(volume = 0.55): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      this.stopCurrent(ctx, now);

      if (this.audioBuffer) {
        const source = ctx.createBufferSource();
        source.buffer = this.audioBuffer;

        // Programmatic derived low-pitch / descending tone
        source.playbackRate.setValueAtTime(0.72, now);

        // Lowpass filter to give a warmer, descending muted character
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2400, now);
        filter.frequency.exponentialRampToValueAtTime(900, now + 0.2);

        const gainNode = ctx.createGain();
        const safeVolume = Math.min(Math.max(volume, 0.05), 1.0);
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(safeVolume, now + 0.015);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        source.start(now);
        this.currentSource = source;
        this.currentGain = gainNode;

        source.onended = () => {
          if (this.currentSource === source) {
            this.currentSource = null;
            this.currentGain = null;
          }
        };
      } else {
        // Fallback: start preloading and use pure Web Audio synthesis
        void this.preload();
        this.synthesizeDeactivate(ctx, now, volume);
      }
    } catch {
      // Graceful fallback
    }
  }

  /**
   * Fallback synthesizers in case the MP3 file is still loading or network fails.
   */
  private synthesizeActivate(ctx: AudioContext, now: number, volume: number): void {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(volume, 0.3), now);
    masterGain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(740, now);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.65, now + 0.012);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc1.connect(g1);
    g1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.12);

    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1108, now + 0.055);
    g2.gain.setValueAtTime(0.0001, now + 0.055);
    g2.gain.exponentialRampToValueAtTime(0.85, now + 0.075);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc2.connect(g2);
    g2.connect(masterGain);
    osc2.start(now + 0.055);
    osc2.stop(now + 0.28);
  }

  private synthesizeDeactivate(ctx: AudioContext, now: number, volume: number): void {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.min(volume, 0.25), now);
    masterGain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(360, now + 0.14);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.75, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }
}

export const voiceSoundEffects = new VoiceSoundEffects();
