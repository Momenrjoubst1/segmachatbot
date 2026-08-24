/**
 * VoiceOverlay — Claude/Grok-style full-screen live-voice canvas.
 *
 * Composition:
 *   - Animated orb (VoiceOrb) reacting to mic amplitude
 *   - Live waveform bars (LiveWaveform) driven by the same amplitude
 *   - State pill (Listening / Thinking / Speaking)
 *   - Live transcript of what the user is saying (interim) or what the
 *     assistant is replying with (from the thread's last assistant message)
 *   - Sample prompts while the user hasn't spoken yet
 *   - Persona picker + mute/end controls
 *
 * Amplitude plumbing: the ambience controller writes --voice-amp on the
 * root element per rAF; CSS + LiveWaveform consume it. No React state
 * changes per frame — only state-pill and transcript text re-render.
 */

import "./voice-overlay.css";

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { VoiceOrb } from "./VoiceOrb";
import { LiveWaveform } from "./LiveWaveform";
import { SamplePrompts } from "./SamplePrompts";

export type VoiceOverlayState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking";

interface SpeakToChatController {
  state:
    | "off"
    | "connecting"
    | "listening"
    | "sending"
    | "thinking"
    | "speaking";
  muted: boolean;
  setMuted: (next: boolean) => void;
  stop: () => void;
  interimText: string;
  setPersona: (personaId: string) => void;
}

interface PersonaInfo {
  id: string;
  nameAr: string;
  nameEn: string;
  default?: boolean;
}

interface VoiceOverlayProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** The useSpeakToChat controller instance driving this overlay. */
  s2c: SpeakToChatController;
  /** Optional persona catalog for the picker. */
  personas?: PersonaInfo[];
}

const STATE_TO_OVERLAY: Record<string, VoiceOverlayState> = {
  connecting: "connecting",
  listening: "listening",
  sending: "thinking",
  thinking: "thinking",
  speaking: "speaking",
};

export const VoiceOverlay: FC<VoiceOverlayProps> = ({
  open,
  onOpenChange,
  s2c,
  personas = [],
}) => {
  const { t, i18n } = useTranslation("chat");
  const isAr = i18n.language?.startsWith("ar");

  const overlayState =
    STATE_TO_OVERLAY[s2c.state] ?? ("connecting" as VoiceOverlayState);

  const stateLabel = useMemo(() => {
    if (overlayState === "connecting") return t("voice.agent_connecting");
    if (overlayState === "thinking") return t("voice.agent_thinking");
    if (overlayState === "speaking") return t("voice.agent_speaking");
    return s2c.muted
      ? t("voice.agent_muted")
      : t("voice.agent_listening");
  }, [overlayState, s2c.muted, t]);

  const showPrompts =
    overlayState === "listening" && !s2c.interimText.trim() && !s2c.muted;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="voice-overlay-stub border-none bg-transparent p-0 shadow-none outline-none focus:outline-none"
        style={{ maxWidth: "none", width: "auto" }}
        aria-describedby={undefined}
        data-testid="voice-overlay"
      >
        <DialogTitle className="sr-only">
          {t("voice.overlay_title", { defaultValue: "Live voice session" })}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("voice.overlay_description", {
            defaultValue:
              "Speak naturally. Your words appear as you talk; the assistant replies in both text and voice.",
          })}
        </DialogDescription>

        <div
          className="voice-overlay"
          data-state={overlayState}
          role="region"
          aria-label={stateLabel}
        >
          <div className="voice-overlay-shell">
            <span className="voice-overlay-halo" aria-hidden="true" />

            {/* Orb */}
            <VoiceOrb />

            {/* Waveform */}
            <LiveWaveform active={!s2c.muted && overlayState === "listening"} />

            {/* State pill */}
            <div className="vo-state-pill">
              <span className="vo-state-dot" aria-hidden="true" />
              <span>{stateLabel}</span>
            </div>

            {/* Transcript / prompts */}
            {showPrompts ? (
              <SamplePrompts />
            ) : (
              <p
                dir="auto"
                data-role={overlayState === "speaking" ? "assistant" : "user"}
                className={cn(
                  "vo-transcript",
                  !s2c.interimText.trim() &&
                    overlayState === "listening" &&
                    "vo-transcript-placeholder",
                )}
              >
                {s2c.interimText.trim() ||
                  t("voice.listening_ellipsis", {
                    defaultValue: "Listening…",
                  })}
              </p>
            )}

            {/* Persona picker */}
            {personas.length > 1 && (
              <div
                className="vo-persona-row"
                role="radiogroup"
                aria-label={t("voice.persona_label", {
                  defaultValue: "Voice",
                })}
              >
                {personas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={false}
                    onClick={() => s2c.setPersona(p.id)}
                    className="vo-persona-chip"
                  >
                    {isAr ? p.nameAr : p.nameEn}
                  </button>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="vo-controls">
              <button
                type="button"
                onClick={() => s2c.setMuted(!s2c.muted)}
                aria-pressed={s2c.muted}
                aria-label={
                  s2c.muted ? t("voice.unmute") : t("voice.mute")
                }
                data-testid="overlay-mute-button"
                className="vo-control-btn"
              >
                {s2c.muted ? (
                  <MicOffIcon className="size-5" />
                ) : (
                  <MicIcon className="size-5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  s2c.stop();
                  onOpenChange(false);
                }}
                aria-label={t("voice.end_session")}
                data-testid="overlay-end-button"
                className="vo-control-btn vo-control-btn--end"
              >
                <PhoneOffIcon className="size-5" />
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
