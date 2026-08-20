import { createContext, useContext, useState, useCallback, useEffect, type FC, type ReactNode } from "react";
import { registerSendStateBridge, unregisterSendStateBridge } from "./sendStateBridge";

export type SendState = "idle" | "submitting" | "streaming";

interface SendStateContextValue {
  sendState: SendState;
  setSubmitting: () => void;
  setStreaming: () => void;
  setIdle: () => void;
}

const SendStateContext = createContext<SendStateContextValue | null>(null);

export const SendStateProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [sendState, setSendState] = useState<SendState>("idle");

  const setSubmitting = useCallback(() => setSendState("submitting"), []);
  const setStreaming = useCallback(() => setSendState("streaming"), []);
  const setIdle = useCallback(() => setSendState("idle"), []);

  // Register the bridge so the runtime layer can dispatch state changes.
  // Clean up on unmount to avoid stale references.
  useEffect(() => {
    registerSendStateBridge({ setSubmitting, setStreaming, setIdle });
    return () => { unregisterSendStateBridge(); };
  }, [setSubmitting, setStreaming, setIdle]);

  return (
    <SendStateContext.Provider value={{ sendState, setSubmitting, setStreaming, setIdle }}>
      {children}
    </SendStateContext.Provider>
  );
};

export const useSendState = (): SendStateContextValue => {
  const ctx = useContext(SendStateContext);
  if (!ctx) throw new Error("useSendState must be used within SendStateProvider");
  return ctx;
};
