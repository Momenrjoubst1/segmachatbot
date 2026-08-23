import { type FC, useEffect, useRef } from "react";
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

import type { useAgentVoice } from "@/hooks/useAgentVoice";

interface VoiceSessionPanelProps {
  live: ReturnType<typeof useAgentVoice>;
  voices: Array<{ key: string; label: string }>;
  selectedVoice: string;
  onSelectVoice: (key: string) => void;
}

/**
 * VoiceSessionPanel — the live-session card above the composer.
 *
 * Parity layer with Claude/Grok voice UX: persistent readable transcript
 * (also serves deaf/hard-of-hearing users and noisy rooms), a mute that
 * keeps the session alive, the duration countdown, and an explicit hangup.
 * Transcript lines are unicode-bidi:plaintext so Arabic and English mix
 * freely regardless of the app's locked LTR chrome.
 */
export const VoiceSessionPanel: FC<VoiceSessionPanelProps> = ({
  live,
  voices,
  selectedVoice,
  onSelectVoice,
}) => {
  const { t } = useTranslation("chat");
  const logRef = useRef<HTMLDivElement | null>(null);

  // Stick to the newest line unless the user scrolled up to read history.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [live.transcripts]);

  const stateLabel =
    live.state === "connecting"
      ? t("voice.agent_connecting")
      : live.state === "listening"
        ? live.muted
          ? t("voice.agent_muted")
          : t("voice.agent_listening")
        : live.state === "thinking"
          ? t("voice.agent_thinking")
          : live.state === "speaking"
            ? t("voice.agent_speaking")
            : "";

  const remainingMs = live.sessionRemainingMs;
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
          onClick={() => live.setMuted(!live.muted)}
          aria-pressed={live.muted}
          aria-label={live.muted ? t("voice.unmute") : t("voice.mute")}
          data-testid="voice-mute-button"
          className="voice-panel__btn"
        >
          {live.muted ? (
            <MicOffIcon className="size-3.5" />
          ) : (
            <MicIcon className="size-3.5" />
          )}
          {live.muted ? t("voice.unmute") : t("voice.mute")}
        </button>

        <button
          type="button"
          onClick={live.stop}
          aria-label={t("voice.end_session")}
          data-testid="voice-end-button"
          className="voice-panel__btn voice-panel__btn--end"
        >
          <PhoneOffIcon className="size-3.5" />
        </button>
      </div>

      {/* Voice picker — only when the backend exposes more than one voice */}
      {voices.length > 1 && (
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

      <div className="voice-panel__log" ref={logRef} aria-live="polite" data-testid="voice-transcript">
        {live.transcripts.length === 0 ? (
          <div className="text-xs opacity-50">{t("voice.transcript_empty")}</div>
        ) : (
          live.transcripts.map((entry) => (
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
    </div>
  );
};
