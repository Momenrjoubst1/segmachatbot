/**
 * VoiceAmbienceController — writes --voice-amp to the active overlay root
 * per rAF so the orb / waveform / halo can react to live mic loudness.
 *
 * Singleton: only ONE active overlay at a time. registerElement() swaps the
 * target; the rAF loop continues to read whichever probe is live.
 *
 * Two probes:
 *   - attachMic(ctx, stream): mic loudness while the user is talking
 *   - attachAgent(node): bot playback loudness while the agent is talking
 *
 * Reduced motion: the loop never starts; CSS pulse handles the visual.
 */

export type AmbienceState = "idle" | "listening" | "thinking" | "speaking" | "off";

export interface ProbeHandle {
  /** RMS in [0,1] from the most recent frame. */
  read(): number;
  destroy(): void;
}

const AMP_SMOOTH = 0.2;
const AMP_FAST = 0.45;

const FFT_SIZE = 512;

function makeProbe(analyser: AnalyserNode, cleanup: () => void): ProbeHandle {
  const buf = new Uint8Array(analyser.fftSize);
  let last = 0;
  return {
    read() {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const d = (buf[i] - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      const norm = Math.min(1, Math.max(0, rms * 4));
      last = norm < last ? last * 0.7 : norm;
      return Math.max(last, norm);
    },
    destroy() {
      try { analyser.disconnect(); } catch { /* noop */ }
      cleanup();
    },
  };
}

function probeFromStream(ctx: AudioContext, stream: MediaStream): ProbeHandle | null {
  try {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5;
    src.connect(analyser);
    return makeProbe(analyser, () => {
      try { src.disconnect(); } catch { /* noop */ }
    });
  } catch {
    return null;
  }
}

function probeFromNode(node: AudioNode): ProbeHandle | null {
  try {
    const analyser = node.context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5;
    node.connect(analyser);
    return makeProbe(analyser, () => { /* node owned elsewhere */ });
  } catch {
    return null;
  }
}

type AmpListener = (smoothed: number, fast: number) => void;

class VoiceAmbienceController {
  private el: HTMLElement | null = null;
  private micProbe: ProbeHandle | null = null;
  private agentProbe: ProbeHandle | null = null;
  private raf = 0;
  private smoothed = 0;
  private fast = 0;
  private state: AmbienceState = "off";
  private reducedMotion = false;
  private mq: MediaQueryList | null = null;
  /** Extra consumers (e.g. VoiceOrb canvas waveform) of live amplitude. */
  private ampListeners = new Set<AmpListener>();

  /**
   * Subscribe to per-frame amplitude. Fires with the same smoothed/fast pair
   * written to --voice-amp/--voice-amp-fast, and with (0, 0) whenever the
   * frame loop stops so consumers can reset their visuals.
   */
  subscribeAmp(fn: AmpListener): () => void {
    this.ampListeners.add(fn);
    return () => {
      this.ampListeners.delete(fn);
    };
  }

  private emitAmp(smoothed: number, fast: number): void {
    for (const fn of this.ampListeners) fn(smoothed, fast);
  }

  constructor() {
    if (typeof window !== "undefined" && "matchMedia" in window) {
      this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.mq.matches;
      this.mq.addEventListener?.("change", this.onMqChange);
    }
  }

  private onMqChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = e.matches;
    this.syncLoop();
  };

  registerElement(el: HTMLElement | null): void {
    this.el = el;
    this.applyState();
  }

  attachMic(ctx: AudioContext, stream: MediaStream): void {
    this.detachMic();
    this.micProbe = probeFromStream(ctx, stream);
    this.syncLoop();
  }

  detachMic(): void {
    this.micProbe?.destroy();
    this.micProbe = null;
    this.syncLoop();
  }

  attachAgent(node: AudioNode): void {
    this.detachAgent();
    this.agentProbe = probeFromNode(node);
    this.syncLoop();
  }

  detachAgent(): void {
    this.agentProbe?.destroy();
    this.agentProbe = null;
    this.syncLoop();
  }

  setState(next: AmbienceState): void {
    if (this.state === next) return;
    this.state = next;
    this.applyState();
    this.syncLoop();
  }

  getState(): AmbienceState {
    return this.state;
  }

  private applyState(): void {
    if (!this.el) return;
    this.el.setAttribute("data-state", this.state === "off" ? "idle" : this.state);
    if (this.state === "idle" || this.state === "thinking") {
      this.el.style.setProperty("--voice-amp", "0");
      this.el.style.setProperty("--voice-amp-fast", "0");
    }
  }

  private activeProbe(): ProbeHandle | null {
    if (this.state === "listening") return this.micProbe ?? this.agentProbe ?? null;
    if (this.state === "speaking") return this.agentProbe ?? null;
    return null;
  }

  private syncLoop(): void {
    const needsFrames = !this.reducedMotion && this.activeProbe() !== null;
    if (needsFrames && this.raf === 0) {
      this.raf = requestAnimationFrame(this.frame);
    } else if (!needsFrames && this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.el) {
        this.el.style.setProperty("--voice-amp", "0");
        this.el.style.setProperty("--voice-amp-fast", "0");
      }
      this.smoothed = 0;
      this.fast = 0;
      this.emitAmp(0, 0);
    }
  }

  private frame = (): void => {
    this.raf = 0;
    const probe = this.activeProbe();
    if (!probe) return;
    const raw = probe.read();
    this.smoothed = this.smoothed * (1 - AMP_SMOOTH) + raw * AMP_SMOOTH;
    this.fast = this.fast * (1 - AMP_FAST) + raw * AMP_FAST;
    if (this.el) {
      this.el.style.setProperty("--voice-amp", this.smoothed.toFixed(3));
      this.el.style.setProperty(
        "--voice-amp-fast",
        Math.min(1, this.fast * 1.35).toFixed(3),
      );
    }
    // Listeners get the values even when no element is registered — the orb
    // writes them to its OWN root instead of stealing the layer's registration.
    this.emitAmp(this.smoothed, Math.min(1, this.fast * 1.35));
    this.raf = requestAnimationFrame(this.frame);
  };

  reset(): void {
    this.setState("off");
    this.detachMic();
    this.detachAgent();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.smoothed = 0;
    this.fast = 0;
  }
}

export const voiceAmbience = new VoiceAmbienceController();
