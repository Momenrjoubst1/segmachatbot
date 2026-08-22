import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface AssistantSettingsContextValue {
  disable3D: boolean;
  toggle3D: () => void;
}

const AssistantSettingsContext = createContext<AssistantSettingsContextValue | undefined>(undefined);

const STORAGE_KEY = "assistant_disable_3d";

function getStoredValue(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function AssistantSettingsProvider({ children }: { children: ReactNode }) {
  const [disable3D, setDisable3D] = useState(getStoredValue);

  const toggle3D = useCallback(() => {
    setDisable3D((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <AssistantSettingsContext.Provider value={{ disable3D, toggle3D }}>
      {children}
    </AssistantSettingsContext.Provider>
  );
}

export function useAssistantSettings(): AssistantSettingsContextValue {
  const ctx = useContext(AssistantSettingsContext);
  if (!ctx) throw new Error("useAssistantSettings must be used within AssistantSettingsProvider");
  return ctx;
}
