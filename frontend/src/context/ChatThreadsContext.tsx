import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { authFetch } from "@/lib/auth";
import { useAuthContext } from "@/context/AuthContext";
import { useChatMessages } from "@/context/ChatMessagesContext";

export interface ChatThread {
  id: string;
  title: string;
  updated_at: string;
  course_id: string | null;
}

interface ChatThreadsContextType {
  threads: ChatThread[];
  isLoadingThreads: boolean;
  fetchThreads: () => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  loadThread: (id: string | null) => void;
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
  const { activeThreadMessages: _activeThreadMessages, setActiveThreadMessages, isLoadingMessages: _isLoadingMessages, setIsLoadingMessages, fetchMessages, messagesCache, setActiveThreadId: setGlobalActiveThreadId, incrementFetchRequestSeq: _incrementFetchRequestSeq, getFetchRequestSeq: _getFetchRequestSeq } = useChatMessages();

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
  // Ref to read latest messages without adding them to useEffect deps
  const activeMessagesRef = useRef<typeof _activeThreadMessages>([]);
  activeMessagesRef.current = _activeThreadMessages;

  // newChatCount is derived from the URL ?new=N param so it changes atomically
  // with the URL in a single setSearchParams call (no race condition).
  const newChatCount = parseInt(searchParams.get("new") ?? "0", 10) || 0;

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

  const goToThread = useCallback((id: string | null) => {
    if (id) {
      const cached = messagesCache.get(id);
      if (cached) {
        setActiveThreadMessages(cached);
        setIsLoadingMessages(false);
      } else {
        setActiveThreadMessages([]);
        setIsLoadingMessages(true);
      }
      setSearchParams({ thread: id });
    } else {
      setActiveThreadMessages([]);
      setIsLoadingMessages(false);
      // Increment ?new=N atomically with the URL change — single render, no race
      const nextCount = (parseInt(searchParams.get("new") ?? "0", 10) || 0) + 1;
      setSearchParams({ new: String(nextCount) });
    }
  }, [searchParams, setSearchParams, messagesCache, setActiveThreadMessages, setIsLoadingMessages]);

  const setActiveThreadId = useCallback((id: string | null) => {
    if (id && id !== urlThreadId) {
      setSearchParams({ thread: id }, { replace: true });
    }
  }, [setSearchParams, urlThreadId]);

  const fetchThreads = useCallback(async () => {
    setIsLoadingThreads(true);
    try {
      const res = await authFetch(`${backendUrl}/api/chat/threads`);
      if (res.ok) {
        const data: ChatThread[] = await res.json();
        setThreadsSafe(data);
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
      } else {
        console.error("Failed to fetch threads", err);
      }
    } finally {
      setIsLoadingThreads(false);
    }
  }, [backendUrl, setThreadsSafe]);

  useEffect(() => {
    const threadId = urlThreadId;
    setGlobalActiveThreadId(threadId);

    if (threadId) {
      const cached = messagesCache.get(threadId);
      if (cached) {
        // Cache hit — show immediately, background-refresh
        setActiveThreadMessages(cached);
        setIsLoadingMessages(false);
        fetchMessages(threadId, true);
      } else if (activeMessagesRef.current.length > 0) {
        // Post-stream transition: messages already rendered in the UI.
        // Pre-seed cache and do a background refresh — no loading flash.
        messagesCache.set(threadId, activeMessagesRef.current);
        setIsLoadingMessages(false);
        fetchMessages(threadId, true);
      } else {
        setIsLoadingMessages(true);
        setActiveThreadMessages([]);
        fetchMessages(threadId, false);
      }
    } else {
      setActiveThreadMessages([]);
      setIsLoadingMessages(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlThreadId, setGlobalActiveThreadId, setActiveThreadMessages, setIsLoadingMessages, fetchMessages, messagesCache]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        messagesCache.clear();
        setActiveThreadMessages([]);
        fetchThreads();
        const cur = urlThreadId;
        if (cur) fetchMessages(cur, true);
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchThreads, fetchMessages, messagesCache, setActiveThreadMessages, urlThreadId]);

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
          setThreadsSafe((prev) =>
            prev.map((t) =>
              t.id === updated.id ? { ...t, title: updated.title } : t,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, setThreadsSafe]);

  const loadThread = useCallback((id: string | null) => {
    goToThread(id);
  }, [goToThread]);



  const createNewThread = useCallback(async (_courseId?: string) => {
    // Intentionally a no-op
  }, []);

  const getThreadsByCourse = useCallback((courseId: string | null) =>
    threads.filter((t) => t.course_id === courseId), [threads]);

  const deleteThread = useCallback(async (threadId: string) => {
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

  const contextValue = useMemo(() => ({
    threads,
    isLoadingThreads,
    fetchThreads,
    deleteThread,
    loadThread,
    getThreadsByCourse,
    createNewThread,
    activeThreadId: urlThreadId,
    setActiveThreadId,
    newChatCount,
  }), [
    threads,
    isLoadingThreads,
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
