/**
 * AgentVoiceButton — Sigma's voice surface, powered by ElevenLabs
 * Conversational AI (speech-to-speech agents) with the CLASSIC inline UX:
 *
 *   you speak → your words fill the REAL composer live → when the agent
 *   replies, the turn (your utterance + its spoken reply) is persisted to
 *   the thread and rendered as normal messages — while the audio you hear
 *   IS the agent's voice over WebRTC.
 *
 * The agent's own LLM is the brain (deliberate choice): the chat pipeline
 * is never invoked — /api/voice/agent/turn only records history.
 */

import { type FC, useCallback, useRef } from "react";
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
import { useChatHistory } from "@/hooks/useChatHistory";
import { unstable_useComposerInput } from "../shims/assistant-ui-compat-shim";
import { SoundwaveIcon } from "./MicButton";

type AgentMessage = { message?: string; source?: string; role?: string };

const AgentControls: FC = () => {
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
        toast.error(
          body.error === "agent_key_permissions"
            ? t("voice.agent_key_permissions")
            : t("voice.agent_error_connection"),
        );
        return;
      }
      const { signedUrl } = (await res.json()) as { signedUrl: string };
      await startSession({ signedUrl });
    } catch {
      toast.error(t("voice.agent_error_connection"));
    } finally {
      startingRef.current = false;
    }
  }, [active, connecting, startSession, t]);

  return (
    <button
      type="button"
      onClick={() => void (active ? endSession() : start())}
      disabled={connecting}
      aria-label={active ? t("voice.agent_stop") : t("voice.agent_start")}
      data-testid="agent-voice-button"
      data-agent-state={active ? "live" : connecting ? "connecting" : "idle"}
      className={cn(
        "voice-live-btn relative inline-flex size-9 items-center justify-center rounded-full bg-transparent p-0 cursor-pointer",
        "text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white",
        "hover:bg-neutral-200/80 dark:hover:bg-neutral-800 hover:scale-105 active:scale-95",
        "transition-all duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400",
        connecting && "cursor-wait opacity-60",
      )}
    >
      {isSpeaking ? <span className="va-live-ring" aria-hidden="true" /> : null}
      <SoundwaveIcon className="size-5" />
    </button>
  );
};

export const AgentVoiceButton: FC = () => {
  const { activeThreadId, appendMessage } = useChatHistory();
  const input = unstable_useComposerInput();
  const lastUserTextRef = useRef("");

  const handleTurnEnd = useCallback(
    async (agentText: string) => {
      const userText = lastUserTextRef.current.trim();
      lastUserTextRef.current = "";
      input?.setText("");
      const turnId = crypto.randomUUID();

      // Mirror into the thread state first (instant UI), then persist.
      const now = new Date().toISOString();
      if (userText) {
        appendMessage({
          id: `va-u-${turnId}`,
          role: "user",
          content: userText,
          is_pinned: false,
          created_at: now,
        });
      }
      if (agentText) {
        appendMessage({
          id: `va-a-${turnId}`,
          role: "assistant",
          content: agentText,
          is_pinned: false,
          created_at: now,
        });
      }

      if (!activeThreadId || (!userText && !agentText)) return;
      const body = JSON.stringify({ threadId: activeThreadId, userText, agentText, turnId });
      // One retry — the backend dedupes by turnId so a retry cannot double-insert.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await authFetch(BACKEND_URL + "/api/voice/agent/turn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (res.ok) return;
          console.warn("[agent-voice] turn persist failed", res.status, "attempt", attempt + 1);
        } catch {
          /* best-effort: thread state already shows the turn */
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    },
    [activeThreadId, appendMessage, input],
  );

  // Flag gate stays AFTER every hook so the tree stays hook-stable.
  if (!AGENT_VOICE_ENABLED) return null;

  return (
    <ConversationProvider
      onMessage={(msg: unknown) => {
        const m = msg as AgentMessage;
        const text = (m?.message ?? "").trim();
        if (!text) return;
        const isUser = m.source === "user" || m.role === "user";
        if (isUser) {
          // Live in the REAL composer — same feel as the old stack.
          lastUserTextRef.current = lastUserTextRef.current
            ? `${lastUserTextRef.current} ${text}`
            : text;
          input?.setText(text);
        } else {
          void handleTurnEnd(text);
        }
      }}
      onError={() => {
        /* failures surface as disconnect state on the button */
      }}
    >
      <AgentControls />
    </ConversationProvider>
  );
};
