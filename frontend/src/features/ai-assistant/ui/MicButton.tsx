import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useGuestMode } from "@/context/GuestModeContext";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { useChatModel } from "../context/ChatModelContext";
import type { KnownModelId } from "../model-catalog";
import { useDictation } from "@/hooks/useDictation";
import { useSpeakToChat } from "@/hooks/useSpeakToChat";
import { useVoiceHotkey } from "@/hooks/useVoiceHotkey";
import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";
import { voiceSoundEffects } from "@/lib/audio/voice-sound-effects";
import { MicrophoneMenu } from "./MicrophoneMenu";

const VOICE_FAST_MODEL = "gemini-2.5-flash";

interface MicButtonProps {
  className?: string;
  hideLiveWhenText?: boolean;
}

export const MicButton: FC<MicButtonProps> = ({
  className,
  hideLiveWhenText = false,
}) => {
  const { t } = useTranslation("chat");
  const { isGuestMode, limitReached } = useGuestMode();
  const input = unstable_useComposerInput();

  const baseRef = useRef<string>("");

  const applyText = useCallback(
    (text: string) => {
      const before = input?.value ?? "";
      if (text === before) return;
      input?.setText(text);
      window.setTimeout(() => {
        const after = input?.value ?? "";
        if (after === before && text) {
          const el = document.querySelector<HTMLElement>(
            '[data-slot="aui_composer-shell"][contenteditable="true"], [data-slot="aui_composer-shell"] [contenteditable="true"]',
          );
          if (el) {
            el.focus();
            document.execCommand("insertText", false, text);
          }
        }
      }, 60);
    },
    [input],
  );

  const onDictationTranscript = useCallback(
    (full: string) => {
      const base = baseRef.current.trim();
      const combined =
        base && full ? base.replace(/\s+$/, "") + " " + full : full;
      applyText(combined);
    },
    [applyText],
  );

  const { status: dictStatus, error: dictError, start: startDict, stop: stopDict } =
    useDictation({ onTranscript: onDictationTranscript });

  const dictRecording = dictStatus === "recording";
  const seconds = useElapsedSeconds(dictRecording);

  useEffect(() => {
    voiceDebugBus.setMounted(true, "");
    voiceDebugBus.event("mic_mounted", "composer voice controls ready");
    return () => voiceDebugBus.setMounted(false, "unmounted");
  }, []);
  useEffect(() => {
    voiceDebugBus.event("dict_status", dictStatus);
    voiceDebugBus.setState(dictStatus);
  }, [dictStatus]);

  useEffect(() => {
    if (dictRecording) baseRef.current = input?.value ?? "";
  }, [dictRecording, input]);

  const submitComposerForm = useCallback(() => {
    const form =
      document.querySelector<HTMLFormElement>("form.aui-composer-root") ??
      document.querySelector<HTMLFormElement>('[data-slot="aui_composer-shell"] form');
    if (form) form.requestSubmit();
    else
      document
        .querySelector<HTMLButtonElement>(".aui-composer-send")
        ?.click();
  }, []);

  const handleS2cNotice = useCallback(
    (notice: "tts_unavailable" | "half_duplex") => {
      if (notice === "tts_unavailable") toast.info(t("voice.tts_unavailable"));
      else toast.info(t("voice.agent_notice_half_duplex"));
    },
    [t],
  );

  const s2c = useSpeakToChat({
    writeToComposer: useCallback((text: string) => input?.setText(text), [input]),
    submitComposer: submitComposerForm,
    onNotice: handleS2cNotice,
    onError: useCallback(
      (reason: "mic" | "ws" | "auth") => {
        voiceDebugBus.event("s2c_error", reason);
        if (reason === "mic") toast.error(t("voice.micDenied"));
        else toast.error(t("voice.agent_error_connection"));
      },
      [t],
    ),
  });

  const s2cActive = s2c.state !== "off";

  const toggleLiveVoice = useCallback(() => {
    if (s2cActive) {
      voiceSoundEffects.playDeactivate();
      s2c.stop();
      return;
    }
    voiceSoundEffects.playActivate();
    if (dictRecording) void stopDict().then(() => void s2c.start());
    else void s2c.start();
  }, [s2cActive, s2c, dictRecording, stopDict]);

  useVoiceHotkey({ onToggle: toggleLiveVoice });

  const { modelRef, effortRef, setModel, setEffort } = useChatModel();
  const savedModelRef = useRef<KnownModelId | null>(null);
  const savedEffortRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (s2cActive && savedModelRef.current === null) {
      savedModelRef.current = modelRef.current;
      savedEffortRef.current = effortRef.current;
      if (modelRef.current !== VOICE_FAST_MODEL) {
        setModel(VOICE_FAST_MODEL);
        setEffort("low");
        toast.info(t("voice.flash_model"));
      }
    } else if (!s2cActive && savedModelRef.current !== null) {
      const restore = savedModelRef.current;
      const restoreEffort = savedEffortRef.current;
      savedModelRef.current = null;
      savedEffortRef.current = undefined;
      if (modelRef.current === VOICE_FAST_MODEL) {
        setModel(restore);
        setEffort(restoreEffort);
      }
    }
  }, [s2cActive, modelRef, effortRef, setModel, setEffort, t]);

  const hideLive = hideLiveWhenText && !s2cActive;

  if (isGuestMode || limitReached || dictStatus === "disabled") return null;

  const s2cPanelState = s2c.state === "sending" ? "thinking" : s2c.state;
  const primaryState = s2cActive ? s2cPanelState : "off";
  const primaryBusy =
    primaryState === "connecting" || primaryState === "thinking";

  return (
    <>
      {primaryState === "speaking" && <SpeakingBar onStop={toggleLiveVoice} />}

      <MicrophoneMenu
        dictRecording={dictRecording}
        dictStatus={dictStatus}
        dictError={dictError}
        liveActive={s2cActive}
        seconds={seconds}
        onStartDict={async () => {
          baseRef.current = input?.value ?? "";
          await startDict();
        }}
        onStopDict={async () => {
          await stopDict();
        }}
      />

      {!hideLive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleLiveVoice}
              disabled={dictStatus === "starting" || dictStatus === "stopping"}
              aria-label={
                primaryState === "speaking"
                  ? t("voice.stop_speaking")
                  : s2cActive
                    ? t("voice.agent_stop")
                    : t("voice.agent_start")
              }
              aria-pressed={s2cActive}
              data-testid="live-voice-button"
              data-live-state={primaryState}
              className={cn(
                "relative inline-flex size-9 items-center justify-center rounded-full bg-transparent p-0 cursor-pointer",
                "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white",
                "hover:bg-neutral-200/80 dark:hover:bg-neutral-800 hover:scale-105 active:scale-95",
                "transition-all duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
                s2cActive &&
                  (primaryState === "speaking"
                    ? "bg-violet-500/20 text-violet-600 hover:text-violet-600 dark:text-violet-300"
                    : primaryState === "listening"
                      ? "bg-sky-500/15 text-sky-600 hover:text-sky-600 dark:text-sky-300"
                      : "bg-amber-500/15 text-amber-600 hover:text-amber-600 dark:text-amber-300"),
                (primaryBusy || dictStatus === "starting" || dictStatus === "stopping") &&
                  "cursor-wait opacity-60",
                className,
              )}
            >
              {primaryState === "speaking" ? (
                <SquareIcon className="size-4 fill-current" />
              ) : primaryBusy || dictStatus === "starting" ? (
                <Loader2Icon className="size-5 animate-spin stroke-[1.5px]" />
              ) : (
                <SoundwaveIcon className="size-5" />
              )}
              {primaryState === "listening" && !s2c.muted && (
                <span className="va-live-ring" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {primaryState === "speaking"
              ? t("voice.stop_speaking")
              : s2cActive
                ? t("voice.agent_stop")
                : t("voice.agent_start")}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
};


const SpeakingBar: FC<{ onStop: () => void }> = ({ onStop }) => {
  const { t } = useTranslation("chat");
  return (
    <div
      data-testid="speaking-bar"
      className="mr-1 inline-flex items-center gap-2 rounded-full border border-violet-200/60 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300"
    >
      <span className="vk-speaking-pulse" aria-hidden="true" />
      <span>{t("voice.speaking_bar")}</span>
      <button
        type="button"
        onClick={onStop}
        aria-label={t("voice.stop_speaking")}
        data-testid="stop-speaking-button"
        className="ml-1 inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
      >
        <SquareIcon className="size-3 fill-current" />
        {t("voice.stop")}
      </button>
    </div>
  );
};

export const SoundwaveIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={cn("size-5 transition-transform duration-200", className)}
    aria-hidden="true"
  >
    <rect x="3.8" y="9.0" width="1.35" height="6.0" rx="0.675" />
    <rect x="6.8" y="6.5" width="1.35" height="11.0" rx="0.675" />
    <rect x="9.8" y="4.0" width="1.35" height="16.0" rx="0.675" />
    <rect x="12.8" y="7.0" width="1.35" height="10.0" rx="0.675" />
    <rect x="15.8" y="4.0" width="1.35" height="16.0" rx="0.675" />
    <rect x="18.8" y="9.0" width="1.35" height="6.0" rx="0.675" />
  </svg>
);

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}
