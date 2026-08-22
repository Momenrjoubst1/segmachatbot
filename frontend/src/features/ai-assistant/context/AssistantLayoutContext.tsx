import { createContext, useContext, type ReactNode } from "react";
import type { ActiveView } from "../types";

interface AssistantLayoutContextValue {
  activeView: ActiveView;
  onToggleView: (view: ActiveView) => void;
  artifactPanelOpen: boolean;
  setArtifactPanelOpen: (open: boolean) => void;
  emailHistoryOpen: boolean;
  setEmailHistoryOpen: (open: boolean) => void;
}

const AssistantLayoutContext = createContext<AssistantLayoutContextValue | undefined>(undefined);

export function AssistantLayoutProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AssistantLayoutContextValue;
}) {
  return (
    <AssistantLayoutContext.Provider value={value}>
      {children}
    </AssistantLayoutContext.Provider>
  );
}

export function useAssistantLayout(): AssistantLayoutContextValue {
  const ctx = useContext(AssistantLayoutContext);
  if (!ctx) throw new Error("useAssistantLayout must be used within AssistantLayoutProvider");
  return ctx;
}
