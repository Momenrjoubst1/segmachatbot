import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
  MicIcon,
  Loader2Icon,
  SquareIcon,
  AudioLinesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useGuestMode } from "@/context/GuestModeContext";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { useDictation } from "@/hooks/useDictation";
import {
  useAgentVoice,
  fetchAgentVoiceStatus,
  type AgentErrorKind,
} from "@/hooks/useAgentVoice";
import { useSpeakToChat } from "@/hooks/useSpeakToChat";
import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";
import { VoiceSessionPanel } from "./VoiceSessionPanel";

/**
 * Dormant-mode flag: the realtime Deepgram-Agent call experience stays
 * available for opt-in deployments, but the voice button's default behavior
 * is speak-to-chat — voice as an input method for the regular pipeline.
 */
const AGENT_MODE = import.meta.env.VITE_VOICE_LIVE_AGENT === "true";

interface MicButtonProps {
  className?: string;
  /**
   * Claude-style behaviour: when the composer has text, the LIVE voice-mode
   * button makes room for the send button. The toggle stays visible if a
   * live session is already running so the user can still stop it.
   */
  hideLiveWhenText?: boolean;
}

/**
 * Voice controls for the composer:
 *  - 🎤 dictation: speech -> text in the box, manual send.
 *  - ~ LIVE: Deepgram Voice Agent conversation — one WebSocket handles STT,
 *    our chatbot brain, and spoken replies with native barge-in.
 */
export const MicButton: FC<MicButtonProps> = ({
  className,
  hideLiveWhenText = false,
}) => {
  const { t } = useTranslation("chat");
  const { isGuestMode, limitReached } = useGuestMode();
  const input = unstable_useComposerInput();

  const [agentEnabled, setAgentEnabled] = useState(true);
  const [agentVoices, setAgentVoices] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>(
    () => localStorage.getItem("sigma_agent_voice") || "primary",
  );
  const [liveState, setLiveState] = useState<ReturnType<typeof useAgentVoice>["state"]>("off");

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
    voiceDebugBus.setState(liveState === "off" ? "idle" : `agent:${liveState}`);
  }, [liveState]);

  useEffect(() => {
    if (dictRecording) baseRef.current = input?.value ?? "";
  }, [dictRecording, input]);

  // ---- Live mode (Deepgram Voice Agent) --------------------------------------
  /** One toast per distinct failure kind — the hook fires onError once per
   *  fatal event, so a simple mapping here can't spam. */
  const handleAgentError = useCallback(
    (kind: AgentErrorKind) => {
      voiceDebugBus.event("agent_error", kind);
      switch (kind) {
        case "think":
          toast.error(t("voice.agent_error_think"));
          break;
        case "auth":
          toast.error(t("voice.agent_error_auth"));
          break;
        case "busy":
          toast.error(t("voice.agent_error_busy"));
          break;
        case "stalled":
          toast.error(t("voice.agent_error_stalled"));
          break;
        case "session_end":
          toast.info(t("voice.session_ended_time"));
          break;
        default:
          toast.error(t("voice.agent_error_connection"));
          break;
      }
    },
    [t],
  );

  const handleAgentNotice = useCallback(
    (notice: "half_duplex") => {
      if (notice === "half_duplex") toast.info(t("voice.agent_notice_half_duplex"));
    },
    [t],
  );

  const live = useAgentVoice({
    onError: handleAgentError,
    onNotice: handleAgentNotice,
  });

  // ---- Speak-to-chat (default voice mode) ------------------------------------
  // Voice as an INPUT METHOD for the regular chat: auto-send on turn end,
  // reply read aloud. The message takes the exact path a typed one would.
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

  const agentActive =
    AGENT_MODE && live.state !== "off" && live.state !== "error";
  const s2cActive = s2c.state !== "off";
  const liveActive = agentActive || s2cActive;

  // Claude-style swap: voice-mode yields its slot to the send button once
  // the user types — unless a live session is already running.
  const hideLive = hideLiveWhenText && !liveActive;

  useEffect(() => setLiveState(live.state), [live.state]);

  useEffect(() => {
    fetchAgentVoiceStatus().then(({ enabled, voices }) => {
      setAgentEnabled(enabled);
      setAgentVoices(voices ?? []);
    });
  }, []);

  if (isGuestMode || limitReached || dictStatus === "disabled") return null;

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

  const handleLiveClick = () => {
    // Primary voice toggle = speak-to-chat (the regular pipeline, spoken).
    if (s2cActive) {
      s2c.stop();
      return;
    }
    if (dictRecording) void stopDict().then(() => void s2c.start());
    else void s2c.start();
  };

  const handleAgentClick = () => {
    if (agentActive) {
      live.stop();
      return;
    }
    if (dictRecording) void stopDict().then(() => void live.start());
    else void live.start();
  };

  const s2cPanelState =
    s2c.state === "sending" ? "thinking" : s2c.state;

  const stateLabelKey: Record<string, string> = {
    connecting: t("voice.agent_connecting"),
    listening: t("voice.agent_listening"),
    thinking: t("voice.agent_thinking"),
    speaking: t("voice.agent_speaking"),
    error: "",
    off: "",
  };

  // Primary toggle reflects whichever voice mode owns the floor (speak-to-
  // chat by default; the realtime Agent mode only exists behind the flag).
  const primaryState = s2cActive ? s2cPanelState : agentActive ? live.state : "off";
  const primaryBusy =
    primaryState === "connecting" || primaryState === "thinking";

  return (
    <>
      {/* Live session card: state + mute + hangup (+ transcript in agent mode) */}
      {s2cActive && (
        <VoiceSessionPanel
          session={{
            state: s2cPanelState,
            muted: s2c.muted,
            setMuted: s2c.setMuted,
            stop: s2c.stop,
            interim: s2c.interimText,
          }}
        />
      )}
      {agentActive && (
        <VoiceSessionPanel
          session={{
            state: live.state,
            muted: live.muted,
            setMuted: live.setMuted,
            stop: live.stop,
            transcripts: live.transcripts,
            sessionRemainingMs: live.sessionRemainingMs,
          }}
          voices={agentVoices}
          selectedVoice={selectedVoice}
          onSelectVoice={(key) => {
            setSelectedVoice(key);
            live.setVoice(key);
          }}
        />
      )}

      {/* Dictation mic — first, like Claude; voice-mode toggle follows */}
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

      {/* Voice-mode toggle (speak-to-chat) — hidden while the composer has
          text so the send button can take its slot, Claude-style */}
      {!hideLive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleLiveClick}
              disabled={dictStatus === "starting" || dictStatus === "stopping"}
              aria-label={s2cActive ? t("voice.agent_stop") : t("voice.agent_start")}
              aria-pressed={s2cActive}
              data-testid="live-voice-button"
              data-live-state={primaryState}
              className={cn(
                "state-layer relative inline-flex size-10 items-center justify-center rounded-full p-1 transition-colors duration-300",
                "text-muted-foreground hover:text-foreground",
                primaryState === "error" &&
                  "bg-rose-500/20 text-rose-600 hover:text-rose-600 dark:text-rose-300",
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
              {primaryBusy || dictStatus === "starting" ? (
                <Loader2Icon className="size-5 animate-spin stroke-[1.5px]" />
              ) : (
                <AudioLinesIcon className="size-5 stroke-[1.5px]" />
              )}
              {/* Pulsing ring while the user has the floor */}
              {primaryState === "listening" && !s2c.muted && (
                <span className="va-live-ring" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {s2cActive
              ? stateLabelKey[primaryState] || t("voice.agent_stop")
              : t("voice.agent_start")}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Realtime Agent call mode — dormant behind VITE_VOICE_LIVE_AGENT=1 */}
      {AGENT_MODE && !hideLive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleAgentClick}
              disabled={!agentEnabled || dictStatus === "starting" || dictStatus === "stopping"}
              aria-label={agentActive ? t("voice.agent_stop") : t("voice.agent_start")}
              aria-pressed={agentActive}
              data-testid="agent-live-button"
              data-live-state={live.state}
              className={cn(
                "state-layer relative inline-flex size-10 items-center justify-center rounded-full p-1 transition-colors duration-300",
                "text-muted-foreground hover:text-foreground",
                !agentEnabled && "hidden",
                live.state === "error" &&
                  "bg-rose-500/20 text-rose-600 hover:text-rose-600 dark:text-rose-300",
                agentActive && "bg-violet-500/20 text-violet-600 dark:text-violet-300",
                (live.state === "connecting" || dictStatus === "starting") && "cursor-wait opacity-60",
              )}
            >
              <AudioLinesIcon className="size-5 stroke-[1.5px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t("voice.agent_start")}</TooltipContent>
        </Tooltip>
      )}
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
