import React, { createContext, useContext, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { authFetch } from "@/lib/auth";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "data";
  content: string;
  is_pinned: boolean;
  created_at: string;
}

const MESSAGES_CACHE_MAX = 50;

function useLRUCache<K, V>(maxSize: number) {
  const cacheRef = useRef<Map<K, V>>(new Map());

  const get = useCallback((key: K): V | undefined => {
    const map = cacheRef.current;
    if (!map.has(key)) return undefined;
    const value = map.get(key) as V;
    map.delete(key);
    map.set(key, value);
    return value;
  }, []);

  const set = useCallback((key: K, value: V) => {
    const map = cacheRef.current;
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > maxSize) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }, [maxSize]);

  const remove = useCallback((key: K) => {
    cacheRef.current.delete(key);
  }, []);

  const clear = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  return useMemo(() => ({ get, set, remove, clear }), [get, set, remove, clear]);
}

interface ChatMessagesContextType {
  activeThreadMessages: ChatMessage[];
  /** Streaming-only: used by WebSocket/runtime hooks to append messages during stream */
  setActiveThreadMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoadingMessages: boolean;
  messagesError: string | null;
  retryFetchMessages: () => Promise<void>;
  loadMessagesForThread: (threadId: string | null, options?: {
    seedMessages?: ChatMessage[];
    background?: boolean;
    clear?: boolean;
  }) => void;
  removeFromCache: (threadId: string) => void;
  prefetchThread: (threadId: string) => Promise<void>;
  setActiveThreadId: (id: string | null) => void;
  incrementFetchRequestSeq: () => number;
  getFetchRequestSeq: () => number;
}

const ChatMessagesContext = createContext<ChatMessagesContextType | undefined>(undefined);

export const ChatMessagesProvider = ({ children }: { children: ReactNode }) => {
  const [activeThreadMessages, setActiveThreadMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const messagesCache = useLRUCache<string, ChatMessage[]>(MESSAGES_CACHE_MAX);
  const activeThreadIdRef = useRef<string | null>(null);
  const fetchRequestSeq = useRef(0);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

  const fetchMessages = useCallback(async (threadId: string, isBackground = false) => {
    const requestId = ++fetchRequestSeq.current;
    if (!isBackground) setIsLoadingMessages(true);
    setMessagesError(null);
    try {
      const res = await authFetch(`${backendUrl}/api/chat/threads/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        if (activeThreadIdRef.current !== threadId || requestId !== fetchRequestSeq.current) {
          return;
        }
        setActiveThreadMessages(data);
        messagesCache.set(threadId, data);
        setMessagesError(null);
      } else if (res.status === 401) {
        if (activeThreadIdRef.current === threadId) setActiveThreadMessages([]);
      } else {
        if (requestId === fetchRequestSeq.current) {
          setMessagesError("Failed to load messages. Please try again.");
        }
      }
    } catch (err) {
      console.error("[ChatHistory] fetchMessages error:", err);
      if (requestId === fetchRequestSeq.current) {
        setMessagesError("Cannot reach the server. Please check your connection.");
      }
    } finally {
      if (requestId === fetchRequestSeq.current) {
        setIsLoadingMessages(false);
      }
    }
  }, [backendUrl, messagesCache]);

  const retryFetchMessages = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    if (threadId) {
      await fetchMessages(threadId);
    }
  }, [fetchMessages]);

  const loadMessagesForThread = useCallback((threadId: string | null, options?: {
    seedMessages?: ChatMessage[];
    background?: boolean;
    clear?: boolean;
  }) => {
    const { seedMessages, background = false, clear = false } = options ?? {};

    // Clear path (new chat / sign-out / no thread)
    if (!threadId || clear) {
      setActiveThreadMessages([]);
      setIsLoadingMessages(false);
      if (clear) messagesCache.clear();
      return;
    }

    // Cache hit — show immediately, background refresh
    const cached = messagesCache.get(threadId);
    if (cached) {
      setActiveThreadMessages(cached);
      setIsLoadingMessages(false);
      fetchMessages(threadId, true);
      return;
    }

    // Post-stream transition — pre-seed from caller, background refresh
    if (seedMessages && seedMessages.length > 0) {
      messagesCache.set(threadId, seedMessages);
      setActiveThreadMessages(seedMessages);
      setIsLoadingMessages(false);
      fetchMessages(threadId, true);
      return;
    }

    // Cache miss — full fetch with loading state
    if (background) {
      fetchMessages(threadId, true);
    } else {
      setActiveThreadMessages([]);
      setIsLoadingMessages(true);
      fetchMessages(threadId, false);
    }
  }, [messagesCache, fetchMessages]);

  const removeFromCache = useCallback((threadId: string) => {
    messagesCache.remove(threadId);
  }, [messagesCache]);

  const prefetchThread = useCallback(async (threadId: string) => {
    if (!threadId || threadId === "new-chat-virtual" || messagesCache.get(threadId)) return;
    try {
      const res = await authFetch(`${backendUrl}/api/chat/threads/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        messagesCache.set(threadId, data);
      }
    } catch (err) {
      console.error("[ChatHistory] prefetchThread error:", err);
    }
  }, [backendUrl, messagesCache]);

  const setActiveThreadId = useCallback((id: string | null) => {
    activeThreadIdRef.current = id;
  }, []);

  const incrementFetchRequestSeq = useCallback(() => {
    return ++fetchRequestSeq.current;
  }, []);

  const getFetchRequestSeq = useCallback(() => {
    return fetchRequestSeq.current;
  }, []);

  const contextValue = useMemo(() => ({
    activeThreadMessages,
    setActiveThreadMessages,
    isLoadingMessages,
    messagesError,
    retryFetchMessages,
    loadMessagesForThread,
    removeFromCache,
    prefetchThread,
    setActiveThreadId,
    incrementFetchRequestSeq,
    getFetchRequestSeq,
  }), [
    activeThreadMessages,
    isLoadingMessages,
    messagesError,
    retryFetchMessages,
    loadMessagesForThread,
    removeFromCache,
    prefetchThread,
    setActiveThreadId,
    incrementFetchRequestSeq,
    getFetchRequestSeq,
  ]);

  return (
    <ChatMessagesContext.Provider value={contextValue}>
      {children}
    </ChatMessagesContext.Provider>
  );
};

export const useChatMessages = () => {
  const ctx = useContext(ChatMessagesContext);
  if (!ctx) throw new Error("useChatMessages must be used within ChatMessagesProvider");
  return ctx;
};
