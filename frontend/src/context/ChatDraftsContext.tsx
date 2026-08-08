import { createContext, useContext, useEffect, useRef, useCallback, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";

const DRAFT_STORAGE_PREFIX = "chat_draft_";
const DRAFT_STORAGE_MAX = 50;

interface ChatDraftsContextType {
  saveDraft: (threadId: string | null, text: string) => void;
  getDraft: (threadId: string | null) => string;
  clearDraft: (threadId: string | null) => void;
}

const ChatDraftsContext = createContext<ChatDraftsContextType | undefined>(undefined);

export const ChatDraftsProvider = ({ children }: { children: ReactNode }) => {
  const draftMap = useRef<Map<string, string>>(new Map());
  const [userId, setUserId] = useState<string | null>(null);

  // Track current user so drafts are scoped per account
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Build a user-scoped prefix: "chat_draft_{userId}_" or fallback "chat_draft_anon_"
  const storagePrefix = userId ? `${DRAFT_STORAGE_PREFIX}${userId}_` : `${DRAFT_STORAGE_PREFIX}anon_`;

  useEffect(() => {
    try {
      // Migrate legacy non-scoped drafts on first load
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(DRAFT_STORAGE_PREFIX)) {
          const value = sessionStorage.getItem(key);
          if (value) {
            const threadId = key.slice(DRAFT_STORAGE_PREFIX.length);
            localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${threadId}`, value);
          }
          sessionStorage.removeItem(key);
        }
      }

      // Load user-scoped drafts from localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(storagePrefix)) {
          const value = localStorage.getItem(key);
          if (value) {
            const threadId = key.slice(storagePrefix.length);
            draftMap.current.set(threadId, value);
          }
        }
      }
    } catch {
      // storage may be unavailable
    }
  }, [storagePrefix]);

  const evictOldDrafts = useCallback(() => {
    if (draftMap.current.size <= DRAFT_STORAGE_MAX) return;
    const entries = [...draftMap.current.entries()];
    const toRemove = entries.length - DRAFT_STORAGE_MAX;
    for (let i = 0; i < toRemove; i++) {
      const [key] = entries[i];
      draftMap.current.delete(key);
      try { localStorage.removeItem(`${storagePrefix}${key}`); } catch { /* ignore */ }
    }
  }, [storagePrefix]);

  const saveDraft = useCallback((threadId: string | null, text: string) => {
    const key = threadId ?? "__new__";
    if (text.trim()) {
      draftMap.current.set(key, text);
      try { localStorage.setItem(`${storagePrefix}${key}`, text); } catch { /* quota exceeded */ }
    } else {
      draftMap.current.delete(key);
      try { localStorage.removeItem(`${storagePrefix}${key}`); } catch { /* ignore */ }
    }
    evictOldDrafts();
  }, [storagePrefix, evictOldDrafts]);

  const getDraft = useCallback((threadId: string | null): string => {
    const key = threadId ?? "__new__";
    return draftMap.current.get(key) ?? "";
  }, []);

  const clearDraft = useCallback((threadId: string | null) => {
    const key = threadId ?? "__new__";
    draftMap.current.delete(key);
    try { localStorage.removeItem(`${storagePrefix}${key}`); } catch { /* ignore */ }
  }, [storagePrefix]);

  return (
    <ChatDraftsContext.Provider value={{ saveDraft, getDraft, clearDraft }}>
      {children}
    </ChatDraftsContext.Provider>
  );
};

export const useChatDrafts = () => {
  const ctx = useContext(ChatDraftsContext);
  if (!ctx) throw new Error("useChatDrafts must be used within ChatDraftsProvider");
  return ctx;
};
