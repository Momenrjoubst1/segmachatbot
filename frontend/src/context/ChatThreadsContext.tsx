import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { authFetch } from "@/lib/auth";
import { useAuthContext } from "@/context/AuthContext";
import { useChatMessages } from "@/context/ChatMessagesContext";
import { useChatDrafts } from "@/context/ChatDraftsContext";
import type { LoadErrorCode } from "@/lib/load-errors";

export interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
  course_id: string | null;
}

interface ChatThreadsContextType {
  threads: ChatThread[];
  isLoadingThreads: boolean;
  threadsError: LoadErrorCode | null;
  fetchThreads: () => Promise<void>;
  retryFetchThreads: () => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  loadThread: (id: string | null) => Promise<void>;
  getThreadsByCourse: (courseId: string | null) => ChatThread[];
  createNewThread: (courseId?: string) => Promise<void>;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  newChatCount: number;
}

const ChatThreadsContext = createContext<ChatThreadsContextType | undefined>(undefined);

export const ChatThreadsProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthContext();
  const { activeThreadMessages, setActiveThreadId: setGlobalActiveThreadId, loadMessagesForThread, removeFromCache } = useChatMessages();
  const { clearDraft } = useChatDrafts();

  const urlThreadId = searchParams.get("thread");

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

  // newChatCount is derived from the URL ?new=N param so it changes atomically
  // with the URL in a single setSearchParams call (no race condition).
  const newChatCount = parseInt(searchParams.get("new") ?? "0", 10) || 0;

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

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

  const setActiveThreadId = useCallback((id: string | null) => {
    if (id && id !== urlThreadId) {
      setSearchParams({ thread: id }, { replace: true });
    }
  }, [setSearchParams, urlThreadId]);

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
    } catch (err: any) {
      const isNetworkError =
        err instanceof TypeError &&
        /failed to fetch|networkerror|load failed/i.test(err.message);
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

  useEffect(() => {
    const threadId = urlThreadId;
    setGlobalActiveThreadId(threadId);

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
  }, [urlThreadId, setGlobalActiveThreadId, loadMessagesForThread]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  // Guest + stale ?thread=ID (e.g. after sign-out) would render an empty chat
  // forever — the fetches are auth-gated. Strip the param so the guest lands
  // on a clean new chat instead.
  useEffect(() => {
    if (!user?.id && urlThreadId) {
      setSearchParams({}, { replace: true });
    }
  }, [user?.id, urlThreadId, setSearchParams]);

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
  }, [backendUrl, goToThread, setThreadsSafe, urlThreadId]);

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

  const contextValue = useMemo(() => ({
    threads,
    isLoadingThreads,
    threadsError,
    fetchThreads,
    retryFetchThreads: fetchThreads,
    deleteThread,
    updateThreadTitle,
    loadThread,
    getThreadsByCourse,
    createNewThread,
    activeThreadId: urlThreadId,
    setActiveThreadId,
    newChatCount,
  }), [
    threads,
    isLoadingThreads,
    threadsError,
    fetchThreads,
    deleteThread,
    loadThread,
    getThreadsByCourse,
    createNewThread,
    urlThreadId,
    setActiveThreadId,
    newChatCount,
  ]);

  return (
    <ChatThreadsContext.Provider value={contextValue}>
      {children}
    </ChatThreadsContext.Provider>
  );
};

export const useChatThreads = () => {
  const ctx = useContext(ChatThreadsContext);
  if (!ctx) throw new Error("useChatThreads must be used within ChatThreadsProvider");
  return ctx;
};
