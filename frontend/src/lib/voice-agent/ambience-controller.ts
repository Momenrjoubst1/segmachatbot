/**
 * VoiceAmbience — module-level singleton controller for audio-reactive UI.
 *
 * Owns ONE requestAnimationFrame loop while a live session is in an
 * amplitude-driven state (listening / speaking). Every frame it:
 *   1. reads the active probe (mic while listening, agent tap while speaking)
 *   2. EMA-smooths it: s = s*0.8 + raw*0.2
 *   3. writes two CSS custom properties on the registered layer root:
 *        --voice-amp        (0..1)
 *        --voice-amp-fast   (snappier curve for scale/ring effects)
 *
 * NO React state per frame. React only mounts <VoiceAmbienceLayer/>, which
 * registers its element here; every other mutation (data-state attribute
 * included) is imperative, so state changes cost zero re-renders.
 *
 * State colors/motion live in CSS keyed off [data-voice-state]; transitions
 * are 240ms ease so rapid listening/thinking/speaking alternation cross-fades
 * instead of snapping.
 *
 * Reduced motion (`prefers-reduced-motion: reduce`): the rAF loop never
 * starts; the layer falls back to static tinted indicators via CSS media
 * query. Analyser failures degrade to the same fixed CSS pulse (the layer
 * gets data-amp-live="false" and CSS ignores --voice-amp).
 */

import type { ProbeHandle } from "./amplitude-probe";
import { probeFromNode, probeFromStream } from "./amplitude-probe";

export type AmbienceState = "idle" | "listening" | "thinking" | "speaking" | "off";

const AMP_SMOOTH = 0.2; // EMA weight for the new sample (task spec 80/20)
const AMP_FAST = 0.45; // snappier channel for ring/scale

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

  // ---- registration ---------------------------------------------------------

  registerElement(el: HTMLElement | null): void {
    this.el = el;
    this.applyState();
  }

  // ---- probes ---------------------------------------------------------------

  /** Attach mic loudness; pass the capture stream + its AudioContext. */
  attachMic(ctx: AudioContext, stream: MediaStream): void {
    this.detachMic();
    this.micProbe = probeFromStream(ctx, stream);
    this.syncAmpLiveFlag();
    this.syncLoop();
  }

  detachMic(): void {
    this.micProbe?.destroy();
    this.micProbe = null;
    this.syncAmpLiveFlag();
  }

  /** Attach the agent playback tap (master gain of PcmStreamPlayer). */
  attachAgent(node: AudioNode): void {
    this.detachAgent();
    this.agentProbe = probeFromNode(node);
    this.syncAmpLiveFlag();
    this.syncLoop();
  }

  detachAgent(): void {
    this.agentProbe?.destroy();
    this.agentProbe = null;
    this.syncAmpLiveFlag();
  }

  private activeProbe(): ProbeHandle | null {
    if (this.state === "listening") return this.micProbe ?? this.agentProbe ?? null;
    if (this.state === "speaking") return this.agentProbe ?? null;
    return null;
  }

  private syncAmpLiveFlag(): void {
    const live =
      (this.state === "listening" && !!this.micProbe) ||
      (this.state === "speaking" && !!this.agentProbe);
    this.el?.setAttribute("data-amp-live", live ? "true" : "false");
  }

  // ---- state ----------------------------------------------------------------

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
    this.el.setAttribute("data-voice-state", this.state === "off" ? "idle" : this.state);
    if (this.state === "idle" || this.state === "thinking") {
      // No amplitude-driven states: rest the custom props so CSS pulse owns.
      this.el.style.setProperty("--voice-amp", "0");
      this.el.style.setProperty("--voice-amp-fast", "0");
    }
    this.syncAmpLiveFlag();
  }

  // ---- frame loop -----------------------------------------------------------

  private syncLoop(): void {
    const needsFrames = !this.reducedMotion && this.activeProbe() !== null;
    if (needsFrames && this.raf === 0) {
      this.raf = requestAnimationFrame(this.frame);
    } else if (!needsFrames && this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      // Settle back to rest values so the glow doesn't freeze mid-glow.
      if (this.el) {
        this.el.style.setProperty("--voice-amp", "0");
        this.el.style.setProperty("--voice-amp-fast", "0");
      }
      this.smoothed = 0;
      this.fast = 0;
    }
  }

  private frame = (): void => {
    this.raf = 0;
    const probe = this.activeProbe();
    if (!probe || !this.el) return;

    const raw = probe.read();
    this.smoothed = this.smoothed * (1 - AMP_SMOOTH) + raw * AMP_SMOOTH;
    this.fast = this.fast * (1 - AMP_FAST) + raw * AMP_FAST;

    this.el.style.setProperty("--voice-amp", this.smoothed.toFixed(3));
    this.el.style.setProperty("--voice-amp-fast", Math.min(1, this.fast * 1.35).toFixed(3));

    this.raf = requestAnimationFrame(this.frame);
  };

  /** Full teardown on voice-mode close / unmount. */
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
