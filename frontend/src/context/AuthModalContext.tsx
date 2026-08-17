import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export type AuthTab = "signin" | "signup" | "forgot";

interface AuthModalContextType {
  isOpen: boolean;
  activeTab: AuthTab;
  openAuthModal: (tab?: AuthTab) => void;
  closeAuthModal: () => void;
  setActiveTab: (tab: AuthTab) => void;
}

const AuthModalContext = createContext<AuthModalContextType | undefined>(undefined);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AuthTab>("signin");

  const openAuthModal = useCallback((tab: AuthTab = "signin") => {
    setActiveTab(tab);
    setIsOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Listen for global custom event if dispatched from non-React code
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ tab?: AuthTab }>;
      openAuthModal(customEvent.detail?.tab ?? "signin");
    };

    window.addEventListener("auth:open-modal", handleOpen);
    return () => window.removeEventListener("auth:open-modal", handleOpen);
  }, [openAuthModal]);

  return (
    <AuthModalContext.Provider
      value={{
        isOpen,
        activeTab,
        openAuthModal,
        closeAuthModal,
        setActiveTab,
      }}
    >
      {children}
    </AuthModalContext.Provider>
  );
}

export function useAuthModal() {
  const context = useContext(AuthModalContext);
  if (!context) {
    throw new Error("useAuthModal must be used within an AuthModalProvider");
  }
  return context;
}
