/**
 * VoiceSessionContext — Shared context for speak-to-chat state.
 *
 * Allows MicButton (which owns the useSpeakToChat hook) to provide
 * state to VoiceSessionUI (which renders the orb + panel) without
 * lifting the hook to a common ancestor.
 */
import { createContext, useContext, type FC, type ReactNode } from "react";
import type { SpeakToChatState } from "@/hooks/useSpeakToChat";

interface VoiceSessionContextValue {
  /** Whether a speak-to-chat session is active */
  active: boolean;
  /** Current state of the session */
  state: SpeakToChatState;
  /** Whether microphone is muted */
  muted: boolean;
  /** Function to toggle mute */
  setMuted: (muted: boolean) => void;
  /** Function to stop the session */
  stop: () => void;
  /** Live interim transcript text */
  interimText: string;
  /** Persisted transcript entries */
  transcripts: Array<{ id: number; role: "user" | "assistant"; text: string }>;
  /** Remaining session time in ms */
  sessionRemainingMs: number | null;
  /** Selected persona ID */
  personaId: string;
  /** Function to change persona */
  setPersona: (personaId: string) => void;
  /** Monotonic counter — increments on every user barge-in (visual flash hook) */
  bargeInSeq?: number;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

/**
 * Provider component — wraps the voice session UI tree.
 * MicButton renders this provider with values from useSpeakToChat.
 */
export const VoiceSessionProvider: FC<{ children: ReactNode; value: VoiceSessionContextValue }> = ({
  children,
  value,
}) => {
  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
    </VoiceSessionContext.Provider>
  );
};

/**
 * Hook to consume the voice session context.
 * Returns null if not within a VoiceSessionProvider.
 */
export function useVoiceSession(): VoiceSessionContextValue | null {
  return useContext(VoiceSessionContext);
}

/**
 * Hook that requires the voice session context (throws if not provided).
 */
export function useRequiredVoiceSession(): VoiceSessionContextValue {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) {
    throw new Error("useRequiredVoiceSession must be used within a VoiceSessionProvider");
  }
  return ctx;
}