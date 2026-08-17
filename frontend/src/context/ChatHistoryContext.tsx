import { createContext, useContext, ReactNode, useCallback, useMemo } from "react";
import { ChatDraftsProvider, useChatDrafts } from "@/context/ChatDraftsContext";
import { ChatMessagesProvider, useChatMessages, ChatMessage } from "@/context/ChatMessagesContext";
import { ChatThreadsProvider, useChatThreads, ChatThread } from "@/context/ChatThreadsContext";
import type { LoadErrorCode } from "@/lib/load-errors";

export type { ChatThread, ChatMessage };

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
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

const ChatHistoryInner = ({ children }: { children: ReactNode }) => {
  const { saveDraft, getDraft, clearDraft } = useChatDrafts();
  const { activeThreadMessages, isLoadingMessages, messagesError, retryFetchMessages, loadMessagesForThread, removeFromCache, prefetchThread, setActiveThreadId: _setActiveThreadId, incrementFetchRequestSeq: _incrementFetchRequestSeq, getFetchRequestSeq: _getFetchRequestSeq, appendMessage, upsertMessage, markStreamInterrupted, markLastAssistantInterrupted, updateApprovalStatus, removeInterruptedMessages } = useChatMessages();
  const { threads, activeThreadId, setActiveThreadId, loadThread, isLoadingThreads, threadsError, retryFetchThreads, fetchThreads, deleteThread: rawDeleteThread, updateThreadTitle, getThreadsByCourse, createNewThread, newChatCount } = useChatThreads();

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
  }), [threads, activeThreadId, setActiveThreadId, loadThread, isLoadingThreads, threadsError, retryFetchThreads, activeThreadMessages, isLoadingMessages, messagesError, retryFetchMessages, loadMessagesForThread, removeFromCache, prefetchThread, fetchThreads, createNewThread, deleteThread, getThreadsByCourse, saveDraft, getDraft, clearDraft, newChatCount, appendMessage, upsertMessage, markStreamInterrupted, markLastAssistantInterrupted, updateApprovalStatus, removeInterruptedMessages]);

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
