import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
  MicIcon,
  Loader2Icon,
  SquareIcon,
  AudioLinesIcon,
  ChevronDownIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useGuestMode } from "@/context/GuestModeContext";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { useDictation } from "@/hooks/useDictation";
import { useLiveVoice, type LiveVoiceState } from "@/hooks/useLiveVoice";
import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";
import {
  fetchVoicePersonas,
  type VoicePersonaInfo,
} from "@/lib/tts/tts-client";

interface MicButtonProps {
  className?: string;
}

const PERSONA_STORAGE_KEY = "sigma_voice_persona";

/**
 * Voice controls for the composer:
 *  - 🎤 dictation: speech -> text in the box, manual send.
 *  - ~ live: full conversation — auto-send on silence, spoken replies,
 *    selectable voice persona (Grok-style), barge-in supported.
 */
export const MicButton: FC<MicButtonProps> = ({ className }) => {
  const { t, i18n } = useTranslation("chat");
  const { isGuestMode, limitReached } = useGuestMode();
  const input = unstable_useComposerInput();

  const [personas, setPersonas] = useState<VoicePersonaInfo[]>([]);
  const [personaId, setPersonaId] = useState<string>(
    () => localStorage.getItem(PERSONA_STORAGE_KEY) || "sana",
  );
  const [ttsDownNoted, setTtsDownNoted] = useState(false);
  const [liveState, setLiveState] = useState<LiveVoiceState>("off");

  const baseRef = useRef<string>("");

  // ---- Dictation mode -------------------------------------------------------
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

  // Debug bus publishing (?voiceDebug=1 overlay)
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
    voiceDebugBus.event("live_state", liveState);
    voiceDebugBus.setState(liveState === "off" ? "idle" : `live:${liveState}`);
  }, [liveState]);

  useEffect(() => {
    if (dictRecording) baseRef.current = input?.value ?? "";
  }, [dictRecording, input]);

  // ---- Live mode --------------------------------------------------------------
  const submitComposer = useCallback(() => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLFormElement>('form[data-slot="aui_composer-shell"]')
        ?.requestSubmit();
    }, 80); // let the final setText settle first
  }, []);

  const live = useLiveVoice({
    personaId,
    writeToComposer: applyText,
    submitComposer,
    onTtsUnavailable: () => {
      if (!ttsDownNoted) {
        setTtsDownNoted(true);
      }
    },
  });

  // Keep a mirrored state so this component can render it
  useEffect(() => setLiveState(live.state), [live.state]);

  const submitComposerStableRef = useRef(submitComposer);
  submitComposerStableRef.current = submitComposer;

  useEffect(() => {
    fetchVoicePersonas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, []);

  const selectPersona = (id: string) => {
    setPersonaId(id);
    localStorage.setItem(PERSONA_STORAGE_KEY, id);
  };

  if (isGuestMode || limitReached || dictStatus === "disabled") return null;

  const liveActive = liveState !== "off";

  const handleMicClick = async () => {
    if (liveActive) return; // mic button is inert while live owns the floor
    if (dictRecording || dictStatus === "stopping") {
      await stopDict();
      return;
    }
    if (dictStatus !== "ready") return;
    baseRef.current = input?.value ?? "";
    await startDict();
  };

  const handleLiveClick = async () => {
    if (liveActive) {
      live.stop();
      return;
    }
    if (dictRecording) await stopDict();
    await live.start();
  };

  const stateLabelKey: Record<LiveVoiceState, string> = {
    off: "",
    listening: t("voice.live_listening"),
    sending: t("voice.live_sending"),
    thinking: t("voice.live_thinking"),
    speaking: t("voice.live_speaking"),
  };

  const activePersona =
    personas.find((p) => p.id === personaId) ??
    ({ id: "sana", nameAr: "سيجما", nameEn: "Sigma" } as VoicePersonaInfo);

  return (
    <>
      {/* Persona picker — visible only during live session */}
      {liveActive && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="persona-picker"
              className={cn(
                "state-layer inline-flex h-10 items-center gap-1 rounded-full px-3 text-xs font-medium",
                "bg-violet-500/15 text-violet-600 hover:text-violet-700 dark:text-violet-300",
              )}
              aria-label={t("voice.choose_persona")}
            >
              <span>{i18n.language.startsWith("ar") ? activePersona.nameAr : activePersona.nameEn}</span>
              <ChevronDownIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-72 p-2">
            <p className="px-2 pb-1.5 pt-0.5 text-xs font-semibold text-muted-foreground">
              {t("voice.choose_persona")}
            </p>
            <div className="flex flex-col gap-0.5">
              {(personas.length ? personas : [activePersona]).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPersona(p.id)}
                  className={cn(
                    "state-layer flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors",
                    p.id === personaId
                      ? "bg-violet-500/12"
                      : "hover:bg-muted/60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      p.gender === "female" ? "bg-pink-400" : "bg-sky-400",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-tight">
                      {i18n.language.startsWith("ar") ? p.nameAr : p.nameEn}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={i18n.language.startsWith("ar") ? p.descAr : p.descEn}>
                      {i18n.language.startsWith("ar") ? p.descAr : p.descEn}
                    </span>
                  </span>
                  {p.id === personaId && (
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-violet-500" />
                  )}
                </button>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* LIVE toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleLiveClick}
            disabled={dictStatus === "starting" || dictStatus === "stopping"}
            aria-label={liveActive ? t("voice.live_stop") : t("voice.live_start")}
            aria-pressed={liveActive}
            data-testid="live-voice-button"
            data-live-state={liveState}
            className={cn(
              "state-layer relative inline-flex size-10 items-center justify-center rounded-full p-1 transition-colors",
              "text-muted-foreground hover:text-foreground",
              liveActive &&
                (liveState === "speaking"
                  ? "animate-pulse bg-violet-500/20 text-violet-600 hover:text-violet-600 dark:text-violet-300"
                  : liveState === "listening"
                    ? "bg-sky-500/15 text-sky-600 hover:text-sky-600 dark:text-sky-300"
                    : "animate-pulse bg-amber-500/15 text-amber-600 hover:text-amber-600 dark:text-amber-300"),
              (dictStatus === "starting" || dictStatus === "stopping") &&
                "cursor-wait opacity-60",
              className,
            )}
          >
            {liveState === "thinking" || liveState === "sending" ? (
              <Loader2Icon className="size-5 animate-spin stroke-[1.5px]" />
            ) : (
              <AudioLinesIcon className="size-5 stroke-[1.5px]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {liveActive ? stateLabelKey[liveState] || t("voice.live_stop") : t("voice.live_start")}
        </TooltipContent>
      </Tooltip>

      {/* Dictation mic */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleMicClick}
            disabled={liveActive || dictStatus === "starting" || dictStatus === "stopping"}
            aria-label={dictRecording ? t("voice.stop") : t("voice.start")}
            aria-pressed={dictRecording}
            data-testid="mic-button"
            className={cn(
              "state-layer inline-flex size-10 items-center justify-center rounded-full p-1 transition-colors",
              "text-muted-foreground hover:text-foreground",
              dictRecording &&
                "relative animate-pulse bg-rose-500/15 text-rose-600 hover:text-rose-600",
              !liveActive &&
                (dictStatus === "starting" || dictStatus === "stopping") &&
                "cursor-wait opacity-60",
              liveActive && "opacity-40",
              className,
            )}
          >
            {dictStatus === "starting" || dictStatus === "stopping" ? (
              <Loader2Icon className="size-5 animate-spin stroke-[1.5px]" />
            ) : dictRecording ? (
              <SquareIcon className="size-4 fill-current" />
            ) : (
              <MicIcon className="size-5 stroke-[1.5px]" />
            )}
            {dictRecording && seconds > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {dictError === "mic_denied"
            ? t("voice.micDenied")
            : dictRecording
              ? t("voice.stop")
              : t("voice.start")}
        </TooltipContent>
      </Tooltip>
    </>
  );
};

// Small helper component kept out of JSX above to avoid hook-order issues
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