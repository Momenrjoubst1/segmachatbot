/**
 * VoiceSessionOverlay — Renders the VoiceOrb above the composer
 * when a speak-to-chat session is active.
 *
 * Uses the VoiceSessionContext to get the current state.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useVoiceSession } from "./VoiceSessionContext";
import { VoiceOrb } from "./VoiceOrb";
import { VoiceSessionPanel } from "./VoiceSessionPanel";

interface VoiceSessionOverlayProps {
  /** Optional className */
  className?: string;
  /** Available voices for the picker */
  voices?: Array<{ key: string; label: string }>;
  /** Selected voice key */
  selectedVoice?: string;
  /** Voice selection callback */
  onSelectVoice?: (key: string) => void;
}

export const VoiceSessionOverlay: FC<VoiceSessionOverlayProps> = ({
  className,
  voices = [],
  selectedVoice,
  onSelectVoice,
}) => {
  const { t } = useTranslation("chat");
  const session = useVoiceSession();

  if (!session || !session.active) return null;

  const panelState = session.state === "sending" ? "thinking" : session.state;

  return (
    <div
      className={`voice-session-overlay relative ${className ?? ""}`}
      data-testid="voice-session-overlay"
    >
      {/* VoiceOrb — central visual identity */}
      <div className="flex justify-center pb-3">
        <VoiceOrb
          state={session.state === "sending" ? "thinking" : session.state}
          muted={session.muted}
          onToggleMute={(next) => session.setMuted(typeof next === "boolean" ? next : !session.muted)}
          onEndSession={session.stop}
          sessionRemainingMs={session.sessionRemainingMs}
          bargeInSeq={session.bargeInSeq}
          size="md"
          ariaLabel={t("voice.orb_aria", { defaultValue: "Voice session active" })}
        />
      </div>

      {/* VoiceSessionPanel — transcript, controls, timer, voice picker */}
      <div className="voice-session-panel-wrapper">
        <VoiceSessionPanel
          session={{
            state: panelState,
            muted: session.muted,
            setMuted: session.setMuted,
            stop: session.stop,
            interim: session.interimText,
            transcripts: session.transcripts,
            sessionRemainingMs: session.sessionRemainingMs,
          }}
          voices={voices}
          selectedVoice={selectedVoice}
          onSelectVoice={onSelectVoice}
        />
      </div>
    </div>
  );
};