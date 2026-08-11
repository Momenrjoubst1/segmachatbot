import React, { createContext, useContext, ReactNode, useCallback, useMemo } from "react";
import { ChatDraftsProvider, useChatDrafts } from "@/context/ChatDraftsContext";
import { ChatMessagesProvider, useChatMessages, ChatMessage } from "@/context/ChatMessagesContext";
import { ChatThreadsProvider, useChatThreads, ChatThread } from "@/context/ChatThreadsContext";

export type { ChatThread, ChatMessage };

interface ChatHistoryContextType {
  threads: ChatThread[];
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  loadThread: (id: string | null) => void;
  isLoadingThreads: boolean;
  threadsError: string | null;
  retryFetchThreads: () => Promise<void>;
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
  refreshThreads: () => void;
  createNewThread: (courseId?: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  getThreadsByCourse: (courseId: string | null) => ChatThread[];
  saveDraft: (threadId: string | null, text: string) => void;
  getDraft: (threadId: string | null) => string;
  clearDraft: (threadId: string | null) => void;
  newChatCount: number;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

const ChatHistoryInner = ({ children }: { children: ReactNode }) => {
  const { saveDraft, getDraft, clearDraft } = useChatDrafts();
  const { activeThreadMessages, setActiveThreadMessages, isLoadingMessages, messagesError, retryFetchMessages, loadMessagesForThread, removeFromCache, prefetchThread, setActiveThreadId: _setActiveThreadId, incrementFetchRequestSeq: _incrementFetchRequestSeq, getFetchRequestSeq: _getFetchRequestSeq } = useChatMessages();
  const { threads, activeThreadId, setActiveThreadId, loadThread, isLoadingThreads, threadsError, retryFetchThreads, fetchThreads, deleteThread: rawDeleteThread, getThreadsByCourse, createNewThread, newChatCount } = useChatThreads();

  const deleteThread = useCallback(async (threadId: string) => {
    removeFromCache(threadId);
    clearDraft(threadId);
    await rawDeleteThread(threadId);
  }, [rawDeleteThread, removeFromCache, clearDraft]);

  const contextValue = useMemo(() => ({
    threads,
    activeThreadId,
    setActiveThreadId,
    loadThread,
    isLoadingThreads,
    threadsError,
    retryFetchThreads,
    activeThreadMessages,
    setActiveThreadMessages,
    isLoadingMessages,
    messagesError,
    retryFetchMessages,
    loadMessagesForThread,
    removeFromCache,
    prefetchThread,
    refreshThreads: fetchThreads,
    createNewThread,
    deleteThread,
    getThreadsByCourse,
    saveDraft,
    getDraft,
    clearDraft,
    newChatCount,
  }), [threads, activeThreadId, setActiveThreadId, loadThread, isLoadingThreads, threadsError, retryFetchThreads, activeThreadMessages, setActiveThreadMessages, isLoadingMessages, messagesError, retryFetchMessages, loadMessagesForThread, removeFromCache, prefetchThread, fetchThreads, createNewThread, deleteThread, getThreadsByCourse, saveDraft, getDraft, clearDraft, newChatCount]);

  return (
    <ChatHistoryContext.Provider value={contextValue}>
      {children}
    </ChatHistoryContext.Provider>
  );
};

export const ChatHistoryProvider = ({ children }: { children: ReactNode }) => {
  return (
    <ChatDraftsProvider>
      <ChatMessagesProvider>
        <ChatThreadsProvider>
          <ChatHistoryInner>
            {children}
          </ChatHistoryInner>
        </ChatThreadsProvider>
      </ChatMessagesProvider>
    </ChatDraftsProvider>
  );
};

export const useChatHistory = () => {
  const ctx = useContext(ChatHistoryContext);
  if (!ctx) throw new Error("useChatHistory must be used within ChatHistoryProvider");
  return ctx;
};
