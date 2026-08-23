import { type FC, useEffect, useRef } from "react";
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

interface VoiceSessionCore {
  state: string;
  muted: boolean;
  setMuted: (next: boolean) => void;
  stop: () => void;
  /** Present only in Deepgram-Agent live mode; speak-to-chat omits it. */
  transcripts?: Array<{ id: number; role: "user" | "assistant"; text: string }>;
  sessionRemainingMs?: number | null;
}

interface VoiceSessionPanelProps {
  /** Either voice mode's controller — panel renders only shared controls. */
  session: VoiceSessionCore;
  voices?: Array<{ key: string; label: string }>;
  selectedVoice?: string;
  onSelectVoice?: (key: string) => void;
}

/**
 * VoiceSessionPanel — the live-session card above the composer.
 *
 * Shared across both voice modes: state dot, mute that keeps the session
 * alive, duration countdown (when the mode has one), and an explicit hangup.
 * In Agent mode it also renders the live transcript; in speak-to-chat the
 * thread right below IS the transcript, so the log is omitted there.
 * Transcript lines are unicode-bidi:plaintext so Arabic and English mix
 * freely regardless of the app's locked LTR chrome.
 */
export const VoiceSessionPanel: FC<VoiceSessionPanelProps> = ({
  session,
  voices = [],
  selectedVoice,
  onSelectVoice,
}) => {
  const { t } = useTranslation("chat");
  const logRef = useRef<HTMLDivElement | null>(null);
  const transcripts = session.transcripts;

  // Stick to the newest line unless the user scrolled up to read history.
  useEffect(() => {
    const el = logRef.current;
    if (!el || !transcripts) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [transcripts]);

  const stateLabel =
    session.state === "connecting"
      ? t("voice.agent_connecting")
      : session.state === "listening"
        ? session.muted
          ? t("voice.agent_muted")
          : t("voice.agent_listening")
        : session.state === "thinking"
          ? t("voice.agent_thinking")
          : session.state === "speaking"
            ? t("voice.agent_speaking")
            : "";

  const remainingMs = session.sessionRemainingMs ?? null;
  const lowTime = remainingMs !== null && remainingMs <= 30_000;
  const timeText =
    remainingMs === null
      ? null
      : `${Math.floor(remainingMs / 60_000)}:${String(Math.floor((remainingMs % 60_000) / 1000)).padStart(2, "0")}`;

  return (
    <div className="voice-panel" data-testid="voice-session-panel" role="region" aria-label={t("voice.transcript")}>
      <div className="voice-panel__row">
        <span className="voice-panel__state">
          <span className="voice-panel__dot" aria-hidden="true" />
          <span className="truncate">{stateLabel}</span>
        </span>

        {timeText !== null && (
          <span className="voice-panel__time" data-low={lowTime ? "true" : "false"} aria-label={t("voice.time_left")}>
            {timeText}
          </span>
        )}

        <button
          type="button"
          onClick={() => session.setMuted(!session.muted)}
          aria-pressed={session.muted}
          aria-label={session.muted ? t("voice.unmute") : t("voice.mute")}
          data-testid="voice-mute-button"
          className="voice-panel__btn"
        >
          {session.muted ? (
            <MicOffIcon className="size-3.5" />
          ) : (
            <MicIcon className="size-3.5" />
          )}
          {session.muted ? t("voice.unmute") : t("voice.mute")}
        </button>

        <button
          type="button"
          onClick={session.stop}
          aria-label={t("voice.end_session")}
          data-testid="voice-end-button"
          className="voice-panel__btn voice-panel__btn--end"
        >
          <PhoneOffIcon className="size-3.5" />
        </button>
      </div>

      {/* Voice picker — only when the active mode exposes multiple voices */}
      {voices.length > 1 && onSelectVoice && selectedVoice && (
        <div className="voice-panel__row" role="radiogroup" aria-label={t("voice.agent_voice_label")}>
          {voices.map((v) => {
            const active = selectedVoice === v.key;
            return (
              <button
                key={v.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelectVoice(v.key)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-200",
                  active
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      {transcripts && (
        <div className="voice-panel__log" ref={logRef} aria-live="polite" data-testid="voice-transcript">
          {transcripts.length === 0 ? (
            <div className="text-xs opacity-50">{t("voice.transcript_empty")}</div>
          ) : (
            transcripts.map((entry) => (
              <p
                key={entry.id}
                dir="auto"
                className={cn(
                  "voice-panel__line",
                  entry.role === "assistant" ? "voice-panel__line--assistant" : "voice-panel__line--user",
                )}
              >
                <span className="voice-panel__who">
                  {entry.role === "assistant" ? t("voice.agent_caption_sigma") : t("voice.agent_caption_you")}
                </span>
                {entry.text}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
};
