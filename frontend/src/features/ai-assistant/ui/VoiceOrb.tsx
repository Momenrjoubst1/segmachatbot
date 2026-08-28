/**
 * VoiceOrb — Central visual identity for voice sessions.
 *
 * A floating orb with:
 *  - State-driven color (idle/connecting/listening/thinking/speaking/error)
 *  - Amplitude-reactive outer glow (via CSS custom properties --voice-amp/--voice-amp-fast)
 *  - Canvas-rendered waveform ring (64 bars around circumference)
 *  - Inner core with subtle pulse animation
 *  - State icon in center (mic/loader/brain/volume/x)
 *  - Connecting animation (orbiting dots)
 *  - Hover/focus controls overlay (mute, end)
 *  - Session time display with low-time warning
 *  - Barge-in flash effect
 *  - Full reduced-motion support
 *
 * Consumes amplitude from VoiceAmbienceController via data-attributes on the root element.
 */
import { type FC, useEffect, useRef, useMemo, useCallback } from "react";
import {
  MicIcon,
  BrainIcon,
  Volume2Icon,
  XIcon,
  MicOffIcon,
  PhoneOffIcon,
  Loader2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { voiceAmbience, type AmbienceState } from "./voice/ambience-controller";

interface VoiceOrbProps {
  /** Current session state */
  state: "idle" | "connecting" | "listening" | "thinking" | "speaking" | "sending" | "error" | "off";
  /** Whether microphone is muted */
  muted?: boolean;
  /** Callback to toggle mute */
  onToggleMute?: (next?: boolean) => void;
  /** Callback to end session */
  onEndSession?: () => void;
  /** Remaining session time in ms (optional countdown) */
  sessionRemainingMs?: number | null;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional className */
  className?: string;
  /** Monotonic barge-in counter — each increment triggers one flash */
  bargeInSeq?: number;
  /** ARIA label for the orb */
  ariaLabel?: string;
}

const STATE_ICON_MAP: Record<VoiceOrbProps["state"], React.ComponentType<{ className?: string }>> = {
  idle: MicIcon,
  connecting: Loader2Icon,
  listening: MicIcon,
  sending: MicIcon,
  thinking: BrainIcon,
  speaking: Volume2Icon,
  error: XIcon,
  off: MicIcon,
};

const STATE_LABELS: Record<VoiceOrbProps["state"], string> = {
  idle: "voice.orb_idle",
  connecting: "voice.orb_connecting",
  listening: "voice.orb_listening",
  sending: "voice.orb_sending",
  thinking: "voice.orb_thinking",
  speaking: "voice.orb_speaking",
  error: "voice.orb_error",
  off: "voice.orb_off",
};

export const VoiceOrb: FC<VoiceOrbProps> = ({
  state,
  muted = false,
  onToggleMute,
  onEndSession,
  sessionRemainingMs = null,
  size = "md",
  className,
  bargeInSeq = 0,
  ariaLabel,
}) => {
  const { t } = useTranslation("chat");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const micLevelRef = useRef(0);
  const agentLevelRef = useRef(0);
  const reducedMotionRef = useRef(false);
  /** Mirrors `state` for callbacks that must not re-subscribe on change. */
  const stateRef = useRef(state);
  stateRef.current = state;

  // Reduced motion detection
  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches; };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // REAL amplitude: consume the live probes owned by VoiceAmbienceController
  // (mic analyser while listening, agent playback analyser while speaking).
  // Values land in refs for the canvas waveform and in CSS custom properties
  // on the orb root for the glow — no simulation, no duplicate rAF loop.
  useEffect(() => {
    const apply = (smoothed: number, fast: number) => {
      const st = stateRef.current;
      if (st === "listening") micLevelRef.current = smoothed;
      else if (st === "speaking") agentLevelRef.current = smoothed;
      const el = rootRef.current;
      if (el) {
        el.style.setProperty("--voice-amp", smoothed.toFixed(3));
        el.style.setProperty("--voice-amp-fast", fast.toFixed(3));
      }
    };
    const unsubscribe = voiceAmbience.subscribeAmp(apply);
    return () => {
      unsubscribe();
      micLevelRef.current = 0;
      agentLevelRef.current = 0;
      const el = rootRef.current;
      if (el) {
        el.style.setProperty("--voice-amp", "0");
        el.style.setProperty("--voice-amp-fast", "0");
      }
    };
  }, []);

  // Transitional states have no active probe — freeze the glow at rest.
  useEffect(() => {
    if (state === "listening" || state === "speaking") return;
    micLevelRef.current = 0;
    agentLevelRef.current = 0;
    const el = rootRef.current;
    if (el) {
      el.style.setProperty("--voice-amp", "0");
      el.style.setProperty("--voice-amp-fast", "0");
    }
  }, [state]);

  // Waveform rendering loop
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = canvas.width / dpr; // CSS size
    const center = size / 2;
    const radius = center - 10; // inset from edge

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get current amplitude for bar heights
    const micAmp = micLevelRef.current;
    const agentAmp = agentLevelRef.current;
    const combinedAmp = Math.max(micAmp, agentAmp);

    // Only draw when listening or speaking
    if (state !== "listening" && state !== "speaking") return;

    const bars = 64;
    const barWidth = 2 * dpr;
    const maxHeight = radius * 0.35 * dpr;

    // Color based on state
    const isSpeaking = state === "speaking";
    const hue = isSpeaking ? 25 : 198; // orange vs sky
    const sat = "85%";
    const light = "55%";

    ctx.save();
    ctx.translate(center * dpr, center * dpr);

    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2;
      // Add some pseudo-randomness based on index for visual variety
      const seed = Math.sin(i * 7.3) * 0.5 + 0.5;
      const height = (0.15 + combinedAmp * 0.85 + seed * 0.15) * maxHeight;

      ctx.rotate(angle);
      ctx.fillStyle = `hsl(${hue}, ${sat}, ${light})`;
      ctx.globalAlpha = 0.6 + combinedAmp * 0.4;
      ctx.fillRect(
        (radius - 2) * dpr,
        -barWidth / 2,
        height,
        barWidth
      );
      ctx.rotate(-angle);
    }

    ctx.restore();

    if (!reducedMotionRef.current) {
      animationRef.current = requestAnimationFrame(drawWaveform);
    }
  }, [state]);

  // Start/stop waveform animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssSize = size === "sm" ? 72 : size === "lg" ? 120 : 96;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;

    if (state === "listening" || state === "speaking") {
      if (!reducedMotionRef.current && !animationRef.current) {
        animationRef.current = requestAnimationFrame(drawWaveform);
      }
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      // Clear canvas
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [state, size, drawWaveform]);

  // Barge-in flash effect — fires once per bargeInSeq increment
  useEffect(() => {
    if (!bargeInSeq) return;
    const orbEl = canvasRef.current?.parentElement;
    if (!orbEl) return;
    orbEl.classList.add("voice-orb--barge-in");
    const timer = window.setTimeout(() => {
      orbEl.classList.remove("voice-orb--barge-in");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [bargeInSeq]);

  // Format session time
  const timeText = useMemo(() => {
    if (sessionRemainingMs === null || sessionRemainingMs <= 0) return null;
    const mins = Math.floor(sessionRemainingMs / 60000);
    const secs = Math.floor((sessionRemainingMs % 60000) / 1000);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }, [sessionRemainingMs]);

  const isLowTime = sessionRemainingMs !== null && sessionRemainingMs <= 30000;

  const IconComponent = STATE_ICON_MAP[state];
  const stateLabel = t(STATE_LABELS[state]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "voice-orb relative inline-flex flex-col items-center",
        size === "sm" && "voice-orb--sm",
        size === "lg" && "voice-orb--lg",
        className
      )}
      data-state={state === "off" ? "idle" : state}
      data-amp-live="true"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel || stateLabel}
      data-testid="voice-orb"
    >
      {/* Session time (top) */}
      {timeText && (
        <div
          className={cn(
            "voice-orb__time",
            isLowTime && "voice-orb__time--low"
          )}
          aria-label={t("voice.time_left", { defaultValue: "Time left" })}
        >
          {timeText}
        </div>
      )}

      {/* Orb visual layers */}
      <div className="relative" style={{ width: "100%", height: "100%" }}>
        {/* 1. Outer Glow */}
        <div className="voice-orb__glow" aria-hidden="true" />

        {/* 2. Waveform Ring (Canvas) */}
        <canvas
          ref={canvasRef}
          className="voice-orb__waveform"
          aria-hidden="true"
        />

        {/* 3. Inner Core */}
        <div className="voice-orb__core" aria-hidden="true">
          {/* State Icon */}
          <IconComponent
            className={cn(
              "voice-orb__icon",
              state === "connecting" && "voice-orb__icon--loader",
              state === "thinking" && "voice-orb__icon--brain",
              state === "speaking" && "voice-orb__icon--volume",
              state === "error" && "voice-orb__icon--x",
              state === "listening" && "voice-orb__icon--mic"
            )}
            aria-hidden="true"
          />

          {/* Connecting orbiting dots */}
          {state === "connecting" && !reducedMotionRef.current && (
            <div className="voice-orb__connecting-ring" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="voice-orb__connecting-dot"
                  style={
                    {
                      "--angle": `${(i / 4) * 360}deg`,
                      "--dot-opacity": 0.4 + i * 0.15,
                    } as React.CSSProperties
                  }
                  aria-hidden="true"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Controls Overlay (hover/focus) */}
      {(onToggleMute || onEndSession) && (
        <div className="voice-orb__controls" role="group" aria-label={t("voice.orb_controls", { defaultValue: "Voice session controls" })}>
          {onToggleMute && (
            <button
              type="button"
              className="voice-orb__control-btn"
              onClick={() => onToggleMute(!muted)}
              aria-pressed={muted}
              aria-label={muted ? t("voice.unmute") : t("voice.mute")}
              data-testid="voice-orb-mute"
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </button>
          )}
          {onEndSession && (
            <button
              type="button"
              className="voice-orb__control-btn"
              onClick={onEndSession}
              aria-label={t("voice.end_session")}
              data-testid="voice-orb-end"
            >
              <PhoneOffIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * VoiceOrbWrapper — Convenience wrapper that connects VoiceOrb to the
 * VoiceAmbienceController for amplitude-driven glow.
 *
 * Usage:
 * <VoiceOrbWrapper
 *   state={s2cState}
 *   muted={muted}
 *   onToggleMute={toggleMute}
 *   onEndSession={stop}
 *   sessionRemainingMs={remainingMs}
 * />
 */
export const VoiceOrbWrapper: FC<VoiceOrbProps> = (props) => {
  const orbRef = useRef<HTMLDivElement | null>(null);

  // Register with ambience controller for amplitude-driven glow
  useEffect(() => {
    const el = orbRef.current;
    if (!el) return;
    voiceAmbience.registerElement(el);
    voiceAmbience.setState(mapStateToAmbience(props.state));
    return () => {
      voiceAmbience.registerElement(null);
      voiceAmbience.setState("off");
    };
  }, [props.state]);

  // Update ambience state when props change
  useEffect(() => {
    voiceAmbience.setState(mapStateToAmbience(props.state));
  }, [props.state]);

  return (
    <div ref={orbRef} className="inline-block">
      <VoiceOrb {...props} />
    </div>
  );
};

function mapStateToAmbience(state: VoiceOrbProps["state"]): AmbienceState {
  switch (state) {
    case "listening": return "listening";
    case "thinking": return "thinking";
    case "speaking": return "speaking";
    case "connecting": return "idle";
    case "idle": return "idle";
    case "error": return "off";
    case "off": return "off";
    case "sending": return "thinking";
  }
}