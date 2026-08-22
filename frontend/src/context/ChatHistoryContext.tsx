import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { authFetch } from "@/lib/auth";
import { useAuthContext } from "@/context/AuthContext";
import type { LoadErrorCode } from "@/lib/load-errors";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "data";
  content: string;
  is_pinned: boolean;
  created_at: string;
  /** Set by markStreamInterrupted when the assistant stream is cancelled. */
  interrupted?: boolean;
  /** Present when the assistant requests tool approval. */
  require_approval?: { toolCallId: string } | null;
  /** User's approval decision on a tool call. */
  approval_status?: "approved" | "denied" | "pending";
}

export interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
  course_id: string | null;
}

const DRAFT_STORAGE_PREFIX = "chat_draft_";
const DRAFT_STORAGE_MAX = 50;
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

interface ChatHistoryContextType {
  threads: ChatThread[];
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  loadThread: (id: string | null) => Promise<void>;
  isLoadingThreads: boolean;
  threadsError: LoadErrorCode | null;
  retryFetchThreads: () => Promise<void>;
  activeThreadMessages: ChatMessage[];
  isLoadingMessages: boolean;
  messagesError: LoadErrorCode | null;
  retryFetchMessages: () => Promise<void>;
  loadMessagesForThread: (threadId: string | null, options?: {
    seedMessages?: ChatMessage[];
    background?: boolean;
    clear?: boolean;
  }) => Promise<void>;
  removeFromCache: (threadId: string) => void;
  prefetchThread: (threadId: string) => Promise<void>;
  refreshThreads: () => void;
  createNewThread: (courseId?: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  getThreadsByCourse: (courseId: string | null) => ChatThread[];
  saveDraft: (threadId: string | null, text: string) => void;
  getDraft: (threadId: string | null) => string;
  clearDraft: (threadId: string | null) => void;
  newChatCount: number;
  appendMessage: (msg: ChatMessage) => void;
  upsertMessage: (messageId: string, updater: (msg: ChatMessage) => ChatMessage) => void;
  markStreamInterrupted: () => void;
  markLastAssistantInterrupted: () => void;
  updateApprovalStatus: (toolCallId: string, status: "approved" | "denied") => void;
  removeInterruptedMessages: () => void;
  goToPreviousThread: () => void;
  goToNextThread: () => void;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

export const ChatHistoryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---------------------------------------------------------------------------
  // URL sync
  // ---------------------------------------------------------------------------

  const urlThreadId = searchParams.get("thread");

  // newChatCount is derived from the URL ?new=N param so it changes atomically
  // with the URL in a single setSearchParams call (no race condition).
  const newChatCount = parseInt(searchParams.get("new") ?? "0", 10) || 0;

  // ---------------------------------------------------------------------------
  // Draft state (localStorage, per-user scoped)
  // ---------------------------------------------------------------------------

  const draftMap = useRef<Map<string, string>>(new Map());
  const [draftUserId, setDraftUserId] = useState<string | null>(null);

  // Track current user so drafts are scoped per account
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setDraftUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setDraftUserId(session?.user?.id ?? null);
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Build a user-scoped prefix: "chat_draft_{userId}_" or fallback "chat_draft_anon_"
  const storagePrefix = draftUserId ? `${DRAFT_STORAGE_PREFIX}${draftUserId}_` : `${DRAFT_STORAGE_PREFIX}anon_`;

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

  // ---------------------------------------------------------------------------
  // Messages state (LRU cache, streaming helpers, background refresh)
  // ---------------------------------------------------------------------------

  const [activeThreadMessages, setActiveThreadMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<LoadErrorCode | null>(null);
  const messagesCache = useLRUCache<string, ChatMessage[]>(MESSAGES_CACHE_MAX);
  const activeThreadIdRef = useRef<string | null>(null);
  const fetchRequestSeq = useRef(0);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

  const fetchMessages = useCallback(async (threadId: string, isBackground = false) => {
    if (!user?.id) return;
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
          setMessagesError("messages_load_failed");
        }
      }
    } catch (err) {
      console.error("[ChatHistory] fetchMessages error:", err);
      if (requestId === fetchRequestSeq.current) {
        setMessagesError("network_unreachable");
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

  const loadMessagesForThread = useCallback(async (threadId: string | null, options?: {
    seedMessages?: ChatMessage[];
    background?: boolean;
    clear?: boolean;
  }): Promise<void> => {
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
      return;
    }
    setActiveThreadMessages([]);
    setIsLoadingMessages(true);
    // Await the fetch so callers (e.g. loadThread) can wait for messages
    // to land in the context BEFORE the URL change remounts the chat UI.
    await fetchMessages(threadId, false);
  }, [messagesCache, fetchMessages]);

  const removeFromCache = useCallback((threadId: string) => {
    messagesCache.remove(threadId);
  }, [messagesCache]);

  // Background refresh on window focus: picks up server-inserted messages
  // (e.g. the "material is ready" notification posted by the worker).
  useEffect(() => {
    const refresh = () => {
      const threadId = activeThreadIdRef.current;
      if (threadId && document.visibilityState === "visible") {
        fetchMessages(threadId, true);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchMessages]);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setActiveThreadMessages((prev) => [...prev, msg]);
  }, []);

  const upsertMessage = useCallback((messageId: string, updater: (msg: ChatMessage) => ChatMessage) => {
    setActiveThreadMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = updater(updated[idx]);
        return updated;
      }
      // Not found — create a base message and apply updater
      const base: ChatMessage = {
        id: messageId,
        role: "assistant",
        content: "",
        is_pinned: false,
        created_at: new Date().toISOString(),
      };
      return [...prev, updater(base)];
    });
  }, []);

  const markStreamInterrupted = useCallback(() => {
    setActiveThreadMessages((prev) =>
      prev.map((msg) =>
        msg.role === "assistant" && !msg.interrupted
          ? { ...msg, interrupted: true }
          : msg
      )
    );
  }, []);

  const markLastAssistantInterrupted = useCallback(() => {
    setActiveThreadMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const msg = prev[i];
        if (msg.role === "assistant" && !msg.interrupted) {
          const updated = [...prev];
          updated[i] = { ...msg, interrupted: true } as typeof msg;
          return updated;
        }
      }
      return prev;
    });
  }, []);

  const updateApprovalStatus = useCallback((toolCallId: string, status: "approved" | "denied") => {
    setActiveThreadMessages((prev) =>
      prev.map((msg) =>
        msg.require_approval?.toolCallId === toolCallId
          ? { ...msg, approval_status: status }
          : msg
      )
    );
  }, []);

  const removeInterruptedMessages = useCallback(() => {
    setActiveThreadMessages((prev) => prev.filter((msg) => !msg.interrupted));
  }, []);

  const prefetchThread = useCallback(async (threadId: string) => {
    if (!user?.id) return;
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

  // ---------------------------------------------------------------------------
  // Threads state (list, CRUD, URL navigation, Supabase realtime)
  // ---------------------------------------------------------------------------

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const threadsRef = useRef<ChatThread[]>([]);
  const setThreadsSafe = useCallback((updater: ChatThread[] | ((prev: ChatThread[]) => ChatThread[])) => {
    setThreads((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      threadsRef.current = next;
      return next;
    });
  }, []);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [threadsError, setThreadsError] = useState<LoadErrorCode | null>(null);
  // Ref to read latest messages without adding them to useEffect deps
  const activeMessagesRef = useRef(activeThreadMessages);
  activeMessagesRef.current = activeThreadMessages;

  const goToThread = useCallback((id: string | null) => {
    if (id) {
      setSearchParams({ thread: id });
    } else {
      // Increment ?new=N atomically with the URL change — single render, no race.
      // Functional updater reads the CURRENT params, so rapid successive clicks
      // can't both compute the same count from a stale closure.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("thread");
        next.set("new", String((parseInt(next.get("new") ?? "0", 10) || 0) + 1));
        return next;
      });
    }
  }, [setSearchParams]);

  // Root-cause fix for the navigation flash: ensure messages are in the
  // context BEFORE the URL changes. The chat UI remounts on URL change
  // (motion.div keyed by chatKey), and the new AI SDK Chat is created
  // with the messages from the context. If we don't await the fetch, the
  // remount happens with an empty context → blank screen until the fetch
  // resolves and MessageSyncer pushes messages.
  const loadThread = useCallback(async (id: string | null) => {
    if (!user?.id) {
      // Guest: skip DB fetch, just clear messages and navigate
      loadMessagesForThread(null);
      goToThread(id);
      return;
    }
    if (id) {
      try {
        await loadMessagesForThread(id, { background: false });
      } catch (err) {
        // Don't block navigation on fetch errors — fall through to URL change
        console.warn("[loadThread] preload failed, navigating anyway:", err);
      }
    } else {
      // New chat: clear messages synchronously BEFORE the URL change so the
      // remounting chat starts empty (no leftover conversation from the
      // previous thread bleeding into the new chat view).
      loadMessagesForThread(null);
    }
    goToThread(id);
  }, [goToThread, loadMessagesForThread]);

  // Public setActiveThreadId — syncs URL via setSearchParams
  const setActiveThreadId = useCallback((id: string | null) => {
    if (id && id !== urlThreadId) {
      setSearchParams({ thread: id }, { replace: true });
    }
  }, [setSearchParams, urlThreadId]);

  const goToPreviousThread = useCallback(() => {
    if (!user?.id) return;
    const currentIndex = threads.findIndex(t => t.id === urlThreadId);
    if (currentIndex >= 0 && currentIndex + 1 < threads.length) {
      const previousThread = threads[currentIndex + 1];
      goToThread(previousThread.id);
    }
  }, [goToThread, threads, urlThreadId, user?.id]);

  const goToNextThread = useCallback(() => {
    if (!user?.id) return;
    const currentIndex = threads.findIndex(t => t.id === urlThreadId);
    if (currentIndex > 0) {
      const nextThread = threads[currentIndex - 1];
      goToThread(nextThread.id);
    }
  }, [goToThread, threads, urlThreadId, user?.id]);

  const fetchThreads = useCallback(async () => {
    if (!user?.id) {
      setThreadsSafe([]);
      setIsLoadingThreads(false);
      return;
    }
    setThreadsError(null);
    setIsLoadingThreads(true);
    try {
      const res = await authFetch(`${backendUrl}/api/chat/threads`);
      if (res.ok) {
        const data: ChatThread[] = await res.json();
        setThreadsSafe(data);
        setThreadsError(null);
      } else if (res.status === 401) {
        setThreadsSafe([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        err instanceof TypeError &&
        /failed to fetch|networkerror|load failed/i.test(msg);
      if (isNetworkError) {
        console.error(
          `[ChatHistory] Cannot reach backend at ${backendUrl}.\n` +
            `→ Make sure the backend dev server is running: \`npm run dev:backend\`\n` +
            `→ Or run both together from the project root: \`npm run dev\`\n` +
            `Original error: ${err.message}`,
        );
        setThreadsError("network_unreachable");
      } else {
        console.error("Failed to fetch threads", err);
        setThreadsError("threads_load_failed");
      }
    } finally {
      setIsLoadingThreads(false);
    }
  }, [backendUrl, setThreadsSafe]);

  // URL sync effect — loads messages when URL thread changes
  useEffect(() => {
    const threadId = urlThreadId;
    // Simplified from sub-context: direct ref write instead of function call
    activeThreadIdRef.current = threadId;

    if (threadId) {
      const hasMessagesRendered = activeMessagesRef.current.length > 0;
      loadMessagesForThread(threadId, hasMessagesRendered
        ? { seedMessages: activeMessagesRef.current }
        : undefined
      );
    } else {
      loadMessagesForThread(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlThreadId, loadMessagesForThread]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  // Guest + stale ?thread=ID (e.g. after sign-out) would render an empty chat
  // forever — the fetches are auth-gated. Strip the param so the guest lands
  // on a clean new chat instead.
  useEffect(() => {
    if (!user?.id && urlThreadId) {
      setSearchParams({}, { replace: true });
    }
  }, [user?.id, urlThreadId, setSearchParams]);

  // Auth state change: clear and refetch on sign-in/sign-out
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        loadMessagesForThread(null, { clear: true });
        fetchThreads();
        const cur = urlThreadId;
        if (cur) {
          loadMessagesForThread(cur, { background: true });
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchThreads, loadMessagesForThread, urlThreadId]);

  // Supabase realtime: live reordering when threads are updated
  useEffect(() => {
    if (!user?.id) return;
    const channelName = `chat_sessions_updates:${user.id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_sessions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as ChatThread;
          setThreadsSafe((prev) => {
            const rest = prev.filter((t) => t.id !== updated.id);
            // Bump the updated thread to the top (ChatGPT/Gemini-style
            // live reordering). Falls back gracefully if the thread isn't
            // in the list yet (e.g. created on another device) — skip it
            // rather than showing an unvetted partial row.
            const existing = prev.find((t) => t.id === updated.id);
            if (!existing) return prev;
            return [{ ...existing, title: updated.title, updated_at: updated.updated_at }, ...rest];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, setThreadsSafe]);

  const createNewThread = useCallback(async (_courseId?: string) => {
    // Intentionally a no-op
  }, []);

  const getThreadsByCourse = useCallback((courseId: string | null) =>
    threads.filter((t) => t.course_id === courseId), [threads]);

  const deleteThread = useCallback(async (threadId: string) => {
    removeFromCache(threadId);
    clearDraft(threadId);
    if (!user?.id) return;
    try {
      const res = await authFetch(`${backendUrl}/api/chat/threads/${threadId}`, { method: "DELETE" });
      if (!res.ok) {
        console.error("[ChatHistory] Delete failed:", res.status);
        return;
      }

      const remaining = threadsRef.current.filter((t) => t.id !== threadId);
      const nextThreadId = remaining[0]?.id ?? null;

      setThreadsSafe(remaining);

      if (urlThreadId === threadId) {
        goToThread(nextThreadId);
      }
    } catch (err) {
      console.error("[ChatHistory] deleteThread error:", err);
    }
  }, [backendUrl, goToThread, setThreadsSafe, urlThreadId, removeFromCache, clearDraft]);

  const updateThreadTitle = useCallback(async (threadId: string, title: string) => {
    if (!user?.id) return;
    try {
      const res = await authFetch(`${backendUrl}/api/chat/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        setThreadsSafe((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, title } : t)),
        );
      }
    } catch (err) {
      console.error("[ChatHistory] updateThreadTitle error:", err);
      throw err;
    }
  }, [backendUrl, setThreadsSafe]);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const contextValue = useMemo(() => ({
    threads,
    activeThreadId: urlThreadId,
    setActiveThreadId,
    loadThread,
    isLoadingThreads,
    threadsError,
    retryFetchThreads: fetchThreads,
    activeThreadMessages,
    isLoadingMessages,
    messagesError,
    retryFetchMessages,
    loadMessagesForThread,
    removeFromCache,
    prefetchThread,
    refreshThreads: fetchThreads,
    createNewThread,
    deleteThread,
    updateThreadTitle,
    getThreadsByCourse,
    saveDraft,
    getDraft,
    clearDraft,
    newChatCount,
    appendMessage,
    upsertMessage,
    markStreamInterrupted,
    markLastAssistantInterrupted,
    updateApprovalStatus,
    removeInterruptedMessages,
    goToPreviousThread,
    goToNextThread,
  }), [
    threads, urlThreadId, setActiveThreadId, loadThread, isLoadingThreads, threadsError,
    fetchThreads, activeThreadMessages, isLoadingMessages, messagesError, retryFetchMessages,
    loadMessagesForThread, removeFromCache, prefetchThread, createNewThread, deleteThread,
    updateThreadTitle, getThreadsByCourse, saveDraft, getDraft, clearDraft, newChatCount,
    appendMessage, upsertMessage, markStreamInterrupted, markLastAssistantInterrupted,
    updateApprovalStatus, removeInterruptedMessages, goToPreviousThread, goToNextThread,
  ]);

  return (
    <ChatHistoryContext.Provider value={contextValue}>
      {children}
    </ChatHistoryContext.Provider>
  );
};

export const useChatHistory = () => {
  const ctx = useContext(ChatHistoryContext);
  if (!ctx) throw new Error("useChatHistory must be used within ChatHistoryProvider");
  return ctx;
};
