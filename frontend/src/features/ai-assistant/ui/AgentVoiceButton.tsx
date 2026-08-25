/**
 * AgentVoiceButton — Sigma's NEW voice surface, powered by ElevenLabs
 * Conversational AI (speech-to-speech agents).
 *
 * Flow: click → POST /api/voice/agent/session (backend exchanges its
 * xi-api-key for a 15-min signed URL) → startSession({ signedUrl }).
 * Mic + agent audio + turn-taking + interruption are ALL handled by the
 * ElevenLabs SDK over WebRTC — nothing of the old hand-built stack runs.
 *
 * V1 scope: session controls, live status, and a rolling transcript.
 * Thread integration / clientTools / persona overrides come later.
 */

import { type FC, useCallback, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationStatus,
  useConversationMode,
} from "@elevenlabs/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { authFetch } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/config";
import { AGENT_VOICE_ENABLED } from "@/config/voice-flags";
import { SoundwaveIcon } from "./MicButton";

type AgentMessage = {
  source?: string;
  message?: string;
  transcript?: string;
  text?: string;
};

/** Extract displayable text from the SDK's loosely-typed message events. */
function messageText(msg: unknown): string {
  const m = msg as AgentMessage;
  return m?.message ?? m?.transcript ?? m?.text ?? "";
}

const AgentControls: FC<{
  onStarted: () => void;
}> = ({ onStarted }) => {
  const { t } = useTranslation("chat");
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const startingRef = useRef(false);

  const active = status === "connected";
  const connecting = status === "connecting";

  const start = useCallback(async () => {
    if (startingRef.current || connecting || active) return;
    startingRef.current = true;
    try {
      const res = await authFetch(BACKEND_URL + "/api/voice/agent/session", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "agent_key_permissions") {
          toast.error(t("voice.agent_key_permissions"));
        } else {
          toast.error(t("voice.agent_error_connection"));
        }
        return;
      }
      const { signedUrl } = (await res.json()) as { signedUrl: string };
      await startSession({ signedUrl });
      onStarted();
    } catch {
      toast.error(t("voice.agent_error_connection"));
    } finally {
      startingRef.current = false;
    }
  }, [active, connecting, onStarted, startSession, t]);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => void (active ? endSession() : start())}
        disabled={connecting}
        aria-label={
          active ? t("voice.agent_stop") : t("voice.agent_start")
        }
        data-testid="agent-voice-button"
        data-agent-state={active ? "live" : connecting ? "connecting" : "idle"}
        className={cn(
          "relative inline-flex size-9 items-center justify-center rounded-full bg-transparent p-0 cursor-pointer",
          "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white",
          "hover:bg-neutral-200/80 dark:hover:bg-neutral-800 hover:scale-105 active:scale-95",
          "transition-all duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
          active &&
            "bg-emerald-500/20 text-emerald-600 hover:text-emerald-600 dark:text-emerald-300",
          connecting && "cursor-wait opacity-60",
        )}
      >
        {isSpeaking ? (
          <span className="va-live-ring" aria-hidden="true" />
        ) : null}
        <SoundwaveIcon className="size-5" />
      </button>
      {connecting ? (
        <span
          className="absolute -bottom-1 left-1/2 size-1.5 -translate-x-1/2 animate-pulse rounded-full bg-amber-500"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
};

export const AgentVoiceButton: FC = () => {
  const [transcript, setTranscript] = useState<string[]>([]);

  if (!AGENT_VOICE_ENABLED) return null;

  return (
    <div className="relative inline-flex flex-col items-end">
    <ConversationProvider
      onMessage={(msg: unknown) => {
        const text = messageText(msg).trim();
        if (!text) return;
        const source = (msg as AgentMessage).source ?? "agent";
        setTranscript((prev) =>
          [...prev, `${source === "user" ? "أنت" : "سيجما"}: ${text}`].slice(-6),
        );
      }}
      onError={() => {
        // Session-level failures surface as a disconnect; keep the log
        // light — the status pill already shows the broken state.
      }}
    >
        <AgentControls onStarted={() => setTranscript([])} />
      </ConversationProvider>
      {transcript.length > 0 ? (
        <div
          data-testid="agent-transcript"
          className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-neutral-200/70 bg-white/95 p-3 text-xs leading-relaxed shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
        >
          {transcript.map((line, i) => (
            <p key={i} className="truncate text-neutral-700 dark:text-neutral-300">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
};
