import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface RAGContextType {
  ragEnabled: boolean;
  setRagEnabled: (enabled: boolean) => void;
  toggleRag: () => void;
}

const RAGContext = createContext<RAGContextType>({
  ragEnabled: true,
  setRagEnabled: () => {},
  toggleRag: () => {},
});

const STORAGE_KEY = "sigma_rag_enabled";

function getStoredValue(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== null ? stored === "true" : true;
  } catch {
    return true;
  }
}

export function RAGProvider({ children }: { children: ReactNode }) {
  const [ragEnabled, setRagEnabledState] = useState(getStoredValue);

  const setRagEnabled = useCallback((enabled: boolean) => {
    setRagEnabledState(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {}
  }, []);

  const toggleRag = useCallback(() => {
    setRagEnabledState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <RAGContext.Provider value={{ ragEnabled, setRagEnabled, toggleRag }}>
      {children}
    </RAGContext.Provider>
  );
}

export function useRAGContext() {
  return useContext(RAGContext);
}
