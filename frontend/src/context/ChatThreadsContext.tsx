import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { authFetch } from "@/lib/auth";
import { useAuthContext } from "@/context/AuthContext";
import { useChatMessages } from "@/context/ChatMessagesContext";
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
  const { activeThreadMessages, setActiveThreadId: setGlobalActiveThreadId, loadMessagesForThread } = useChatMessages();

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
      // Increment ?new=N atomically with the URL change — single render, no race
      const nextCount = (parseInt(searchParams.get("new") ?? "0", 10) || 0) + 1;
      setSearchParams({ new: String(nextCount) });
    }
  }, [searchParams, setSearchParams]);

  const setActiveThreadId = useCallback((id: string | null) => {
    if (id && id !== urlThreadId) {
      setSearchParams({ thread: id }, { replace: true });
    }
  }, [setSearchParams, urlThreadId]);

  const fetchThreads = useCallback(async () => {
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
    threadsError,
    fetchThreads,
    retryFetchThreads: fetchThreads,
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
