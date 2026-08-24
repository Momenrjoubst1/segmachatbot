import { type FC, useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useGuestMode } from "@/context/GuestModeContext";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { useChatModel } from "../context/ChatModelContext";
import type { KnownModelId } from "../model-catalog";
import { useDictation } from "@/hooks/useDictation";
import {
  useAgentVoice,
  fetchAgentVoiceStatus,
  type AgentErrorKind,
} from "@/hooks/useAgentVoice";
import { useSpeakToChat } from "@/hooks/useSpeakToChat";
import { voiceDebugBus } from "@/lib/stt/voice-debug-bus";
import { voiceSoundEffects } from "@/lib/audio/voice-sound-effects";
import { VoiceSessionPanel } from "./VoiceSessionPanel";
import { MicrophoneMenu } from "./MicrophoneMenu";

/**
 * Dormant-mode flag: the realtime Deepgram-Agent call experience stays
 * available for opt-in deployments, but the voice button's default behavior
 * is speak-to-chat — voice as an input method for the regular pipeline.
 */
const AGENT_MODE = import.meta.env.VITE_VOICE_LIVE_AGENT === "true";

/**
 * Voice replies run on a FAST model: spoken turns need sub-second first
 * tokens, not the heavyweight text-chat picker choice. Swapped in for the
 * duration of a voice session, restored when it ends. Low reasoning effort
 * maps to a minimal Gemini thinking budget server-side.
 */
const VOICE_FAST_MODEL = "gemini-2.5-flash";

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

  // Voice fast-path: while a voice session owns the floor, sends ride the
  // fast Flash model; the user's picker choice returns when it ends.
  const { modelRef, effortRef, setModel, setEffort } = useChatModel();
  const savedModelRef = useRef<KnownModelId | null>(null);
  const savedEffortRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (s2cActive && savedModelRef.current === null) {
      savedModelRef.current = modelRef.current;
      savedEffortRef.current = effortRef.current;
      if (modelRef.current !== VOICE_FAST_MODEL) {
        setModel(VOICE_FAST_MODEL);
        setEffort("low"); // minimal thinking budget → fastest first token
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

  const handleLiveClick = () => {
    // Primary voice toggle = speak-to-chat (the regular pipeline, spoken).
    if (s2cActive) {
      voiceSoundEffects.playDeactivate();
      s2c.stop();
      return;
    }
    voiceSoundEffects.playActivate();
    if (dictRecording) void stopDict().then(() => void s2c.start());
    else void s2c.start();
  };

  const handleAgentClick = () => {
    if (agentActive) {
      voiceSoundEffects.playDeactivate();
      live.stop();
      return;
    }
    voiceSoundEffects.playActivate();
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

      {/* Dictation mic with Claude-style device selector dropdown & VU meter */}
      <MicrophoneMenu
        dictRecording={dictRecording}
        dictStatus={dictStatus}
        dictError={dictError}
        liveActive={liveActive}
        seconds={seconds}
        onStartDict={async () => {
          baseRef.current = input?.value ?? "";
          await startDict();
        }}
        onStopDict={async () => {
          await stopDict();
        }}
      />

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
                "relative inline-flex size-9 items-center justify-center rounded-full bg-transparent p-0 cursor-pointer",
                "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white",
                "hover:bg-neutral-200/80 dark:hover:bg-neutral-800 hover:scale-105 active:scale-95",
                "transition-all duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
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
                <SoundwaveIcon className="size-5" />
              )}
              {/* Pulsing ring while the user has the floor */}
              {primaryState === "listening" && !s2c.muted && (
                <span className="va-live-ring" aria-hidden="true" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
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
                "relative inline-flex size-9 items-center justify-center rounded-full bg-transparent p-0 cursor-pointer",
                "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white",
                "hover:bg-neutral-200/80 dark:hover:bg-neutral-800 hover:scale-105 active:scale-95",
                "transition-all duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
                !agentEnabled && "hidden",
                live.state === "error" &&
                  "bg-rose-500/20 text-rose-600 hover:text-rose-600 dark:text-rose-300",
                agentActive && "bg-violet-500/20 text-violet-600 dark:text-violet-300",
                (live.state === "connecting" || dictStatus === "starting") && "cursor-wait opacity-60",
              )}
            >
              <SoundwaveIcon className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("voice.agent_start")}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
};

/**
 * Claude AI Soundwave SVG with 6 slim vertical bars matching image reference:
 * [short, medium, tall, medium, tall, short]
 */
export const SoundwaveIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={cn("size-5 transition-transform duration-200", className)}
    aria-hidden="true"
  >
    <rect className="voice-bar voice-bar-1" x="3.8" y="9.0" width="1.35" height="6.0" rx="0.675" />
    <rect className="voice-bar voice-bar-2" x="6.8" y="6.5" width="1.35" height="11.0" rx="0.675" />
    <rect className="voice-bar voice-bar-3" x="9.8" y="4.0" width="1.35" height="16.0" rx="0.675" />
    <rect className="voice-bar voice-bar-4" x="12.8" y="7.0" width="1.35" height="10.0" rx="0.675" />
    <rect className="voice-bar voice-bar-5" x="15.8" y="4.0" width="1.35" height="16.0" rx="0.675" />
    <rect className="voice-bar voice-bar-6" x="18.8" y="9.0" width="1.35" height="6.0" rx="0.675" />
  </svg>
);

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
