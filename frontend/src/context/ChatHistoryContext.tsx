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
  activeThreadMessages: ChatMessage[];
  setActiveThreadMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoadingMessages: boolean;
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
  const { activeThreadMessages, setActiveThreadMessages, isLoadingMessages, prefetchThread, messagesCache, setActiveThreadId: _setActiveThreadId, incrementFetchRequestSeq: _incrementFetchRequestSeq, getFetchRequestSeq: _getFetchRequestSeq } = useChatMessages();
  const { threads, activeThreadId, setActiveThreadId, loadThread, isLoadingThreads, fetchThreads, deleteThread: rawDeleteThread, getThreadsByCourse, createNewThread, newChatCount } = useChatThreads();

  const deleteThread = useCallback(async (threadId: string) => {
    messagesCache.remove(threadId);
    clearDraft(threadId);
    await rawDeleteThread(threadId);
  }, [rawDeleteThread, messagesCache, clearDraft]);

  const contextValue = useMemo(() => ({
    threads,
    activeThreadId,
    setActiveThreadId,
    loadThread,
    isLoadingThreads,
    activeThreadMessages,
    setActiveThreadMessages,
    isLoadingMessages,
    prefetchThread,
    refreshThreads: fetchThreads,
    createNewThread,
    deleteThread,
    getThreadsByCourse,
    saveDraft,
    getDraft,
    clearDraft,
    newChatCount,
  }), [threads, activeThreadId, setActiveThreadId, loadThread, isLoadingThreads, activeThreadMessages, setActiveThreadMessages, isLoadingMessages, prefetchThread, fetchThreads, createNewThread, deleteThread, getThreadsByCourse, saveDraft, getDraft, clearDraft, newChatCount]);

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
