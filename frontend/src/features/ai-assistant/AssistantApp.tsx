
import { AssistantRuntimeProvider, Suggestions, useAui, useAuiState } from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shadcn } from "./shadcn/AssistantLayout";
import { useRuntime, MessageSyncer } from "./ui/useChatRuntime";
import { useChatHistory, ChatHistoryProvider } from "../../hooks/useChatHistory";
import { useCourses, type AcademicCourse } from "../../hooks/useCourses";
import { useScrollPreservation } from "../../hooks/useScrollPreservation";
import { useTitle } from "@/context/TitleContext";
import { useState, useCallback, useEffect, useRef, useLayoutEffect, useTransition } from "react";
import { Toaster } from "sonner";
import { RAGProvider } from "../../context/RAGContext";
import { TopLoadingBar } from "@/components/ui/TopLoadingBar";
import { ThreadSwitchSkeleton } from "@/components/ui/LoadingStates";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { LOAD_ERROR_I18N } from "@/lib/load-errors";
import { LoadErrorPanel } from "@/components/ui/LoadErrorPanel";
import { LoadingAnnouncer } from "@/components/ui/LoadingAnnouncer";

import { SidebarView } from "./shadcn/components/Sidebar/SidebarView";
import { MobileSidebarView } from "./shadcn/components/Sidebar/MobileSidebarView";
import { Header } from "./shadcn/components/Header/Header";


const WELCOME_SUGGESTIONS = [
  {
    title: "How do I register courses?",
    label: "Help me plan my schedule",
    prompt: "How can I register for courses this semester and organize my class schedule?",
  },
  {
    title: "About JUST University",
    label: "Rules and regulations",
    prompt: "Tell me about the main rules and regulations at Jordan University of Science and Technology",
  },
  {
    title: "Study Organization",
    label: "How do I organize my notes?",
    prompt: "How can Sigma AI help me organize my study schedule and summary notes?",
  },
] as const;

/**
 * Saves draft text from the AUI composer when the chat key changes.
 * Must be rendered inside AssistantRuntimeProvider so it can access the AUI runtime.
 * Uses the AUI composer API instead of fragile DOM scraping.
 */
const DraftSaver = ({
  chatKey,
  onDraftSave,
  onThreadSwitch,
}: {
  chatKey: string;
  onDraftSave: (key: string, text: string) => void;
  onThreadSwitch: (prevKey: string, nextKey: string) => void;
}) => {
  const aui = useAui();
  const prevKeyRef = useRef(chatKey);

  useLayoutEffect(() => {
    const prevKey = prevKeyRef.current;
    if (prevKey !== chatKey) {
      onThreadSwitch(prevKey, chatKey);

      try {
        const composer = aui.composer() as any;
        const text = typeof composer?.getText === "function" ? composer.getText() : "";
        if (text) {
          onDraftSave(prevKey, text);
        }
      } catch (err) {
        console.warn("[DraftSaver] Failed to get draft via AUI composer API:", err);
      }
      prevKeyRef.current = chatKey;
    }
  }, [chatKey, aui, onDraftSave, onThreadSwitch]);

  return null;
};

/**
 * Restores draft text into the AUI composer after mount.
 * Must be rendered inside AssistantRuntimeProvider so it can access the AUI runtime.
 */
const DraftRestorer = ({ draftText }: { draftText: string }) => {
  const aui = useAui();
  const isEmpty = useAuiState((s) => s.thread.isEmpty);

  useEffect(() => {
    if (draftText && isEmpty) {
      // Use a microtask to ensure the Lexical editor is fully mounted
      // before we try to set its text content.
      const handle = requestAnimationFrame(() => {
        try {
          aui.composer().setText(draftText);
        } catch (err) {
          console.warn("[DraftRestorer] Failed to set draft text:", err);
        }
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [draftText, isEmpty, aui]);

  return null;
};

interface AssistantChatInnerProps {
  activeCourse: AcademicCourse | null;
  isOnboarded: boolean;
  isCoursesLoading: boolean;
  coursesError: string | null;
  retryCourses: () => void;
  localOnboarded: boolean;
  handleCompleteOnboarding: (courses: { course_name: string; credit_hours: number }[]) => Promise<void>;
  handleSkipOnboarding: () => void;
  setActiveCourse: (course: AcademicCourse | null) => void;
  activeThreadId: string | null;
  draftText: string;
  chatKey: string;
  onDraftSave: (key: string, text: string) => void;
  onThreadSwitch: (prevKey: string, nextKey: string) => void;
  activeView: 'chat' | 'calendar';
  onToggleView: (view: 'chat' | 'calendar') => void;
  artifactPanelOpen: boolean;
  setArtifactPanelOpen: (open: boolean) => void;
  emailHistoryOpen: boolean;
  setEmailHistoryOpen: (open: boolean) => void;
}

const AssistantChatInner = ({
  activeCourse,
  isOnboarded,
  isCoursesLoading,
  coursesError,
  retryCourses,
  localOnboarded,
  handleCompleteOnboarding,
  handleSkipOnboarding,
  setActiveCourse,
  activeThreadId: _activeThreadId,
  draftText,
  chatKey,
  onDraftSave,
  onThreadSwitch,
  activeView,
  onToggleView,
  artifactPanelOpen,
  setArtifactPanelOpen,
  emailHistoryOpen,
  setEmailHistoryOpen,
}: AssistantChatInnerProps) => {
  const runtime = useRuntime(activeCourse);
  const aui = useAui({
    suggestions: Suggestions([...WELCOME_SUGGESTIONS]),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <MessageSyncer />
      <RAGProvider>
        <DraftSaver chatKey={chatKey} onDraftSave={onDraftSave} onThreadSwitch={onThreadSwitch} />
        <DraftRestorer draftText={draftText} />
        <Shadcn
          isOnboarded={isOnboarded}
          isCoursesLoadingVisible={isCoursesLoading && !localOnboarded}
          coursesError={coursesError}
          retryCourses={retryCourses}
          onActiveCourseChange={setActiveCourse}
          onCompleteOnboarding={handleCompleteOnboarding}
          onSkipOnboarding={handleSkipOnboarding}
          activeView={activeView}
          onToggleView={onToggleView}
          artifactPanelOpen={artifactPanelOpen}
          setArtifactPanelOpen={setArtifactPanelOpen}
          emailHistoryOpen={emailHistoryOpen}
          setEmailHistoryOpen={setEmailHistoryOpen}
        />
      </RAGProvider>
    </AssistantRuntimeProvider>
  );
};

const AssistantAppContent = () => {
  const { threads, activeThreadId, isLoadingMessages, messagesError, retryFetchMessages, saveDraft, getDraft, newChatCount } = useChatHistory();
  const { t } = useTranslation(["errors", "common"]);
  const { setBaseTitle } = useTitle();
  const [activeCourse, setActiveCourse] = useState<AcademicCourse | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, _setActiveView] = useState<'chat' | 'calendar'>('chat');
  const [artifactPanelOpen, _setArtifactPanelOpen] = useState(false);
  const [emailHistoryOpen, _setEmailHistoryOpen] = useState(false);
  const [, startTransition] = useTransition();

  const {
    courses: dbCourses,
    isOnboarded: dbOnboarded,
    isCoursesLoading,
    coursesError,
    replaceCourses,
    refetch: refetchCourses,
    retryCourses,
  } = useCourses();

  const [localCourses, setLocalCourses] = useState<AcademicCourse[]>([]);
  const [localOnboarded, setLocalOnboarded] = useState(false);

  const courses = localOnboarded ? localCourses : dbCourses;
  const isOnboarded = localOnboarded || dbOnboarded;

  // Transition-wrapped setters for heavy UI updates (lazy-loaded panels, view switches)
  const setActiveView = useCallback((view: 'chat' | 'calendar') => {
    startTransition(() => { _setActiveView(view); });
  }, []);
  const setArtifactPanelOpen = useCallback((open: boolean) => {
    startTransition(() => { _setArtifactPanelOpen(open); });
  }, []);
  const setEmailHistoryOpen = useCallback((open: boolean) => {
    startTransition(() => { _setEmailHistoryOpen(open); });
  }, []);

  useEffect(() => {
    if (activeThreadId && threads.length) {
      const activeThread = threads.find((t) => t.id === activeThreadId);
      if (activeThread) {
        const course = dbCourses.find((c) => c.id === activeThread.course_id) ?? null;
        setActiveCourse(course);
      }
    } else if (!activeThreadId) {
      // New Chat — reset course so chatKey doesn't carry stale course info
      setActiveCourse(null);
    }
  }, [activeThreadId, threads, dbCourses]);

  const chatKey = activeThreadId
    ? activeThreadId
    : activeCourse
    ? `new-${activeCourse.id}-${newChatCount}`
    : `new-general-${newChatCount}`;

  const { onThreadChange, restorePosition: _restorePosition } = useScrollPreservation(chatKey);

  const handleDraftSave = useCallback((key: string, text: string) => {
    saveDraft(key, text);
  }, [saveDraft]);

  useEffect(() => {
    setBaseTitle("Sigma AI");
    return () => setBaseTitle("Sigma AI");
  }, [setBaseTitle]);

  const handleCompleteOnboarding = useCallback(async (draftCourses: { course_name: string; credit_hours: number }[]) => {
    const mapped = draftCourses.map((c) => ({
      id: crypto.randomUUID(),
      course_name: c.course_name,
      credit_hours: c.credit_hours,
    }));
    setLocalCourses(mapped);
    setLocalOnboarded(true);
    try {
      await replaceCourses(draftCourses);
      await refetchCourses();
    } catch (err) {
      console.warn("[AssistantApp] Supabase sync failed, using local state", err);
    }
  }, [replaceCourses, refetchCourses]);

  const handleSkipOnboarding = useCallback(() => {
    setLocalOnboarded(true);
  }, []);

  const draftText = getDraft(chatKey);

  return (
    <div className="assistant-app-shell dark flex flex-1 h-full w-full overflow-hidden bg-background text-foreground">
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#2a2a2a',
            border: 'none',
            color: '#fff',
            padding: '8px 12px',
            fontSize: '13px',
            minWidth: 'auto',
            maxWidth: 'fit-content',
            borderRadius: '8px',
            fontFamily: 'Tajawal, Inter, sans-serif',
          },
          className: 'toast-compact',
        }}
        offset="16px"
        expand={false}
        richColors
      />
      <TooltipProvider>
        <div className="hidden md:block shrink-0">
          <SidebarView
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            courses={courses}
            activeCourse={activeCourse}
            onActiveCourseChange={setActiveCourse}
          />
        </div>
        <div className="md:hidden shrink-0">
          <MobileSidebarView
            courses={courses}
            activeCourse={activeCourse}
            onActiveCourseChange={setActiveCourse}
          />
        </div>
        <div className="flex-1 min-w-0 h-full flex flex-col">
          <LoadingAnnouncer
            busy={isLoadingMessages}
            label={t("common:loadingMessages", { ns: "common" })}
          />
          <Header
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            activeView={activeView}
            onToggleView={setActiveView}
            onToggleArtifacts={() => setArtifactPanelOpen(!artifactPanelOpen)}
            onToggleEmailHistory={() => setEmailHistoryOpen(!emailHistoryOpen)}
          />
          <div
            className="relative flex-1 min-h-0 overflow-hidden"
            aria-busy={isLoadingMessages}
            aria-live="polite"
          >
            {isLoadingMessages && !messagesError && <TopLoadingBar />}
            {isLoadingMessages && !messagesError && (
              <div className="absolute inset-0 z-20 flex flex-1 flex-col bg-background/80 backdrop-blur-[2px]">
                <ThreadSwitchSkeleton />
              </div>
            )}
            {messagesError && !isLoadingMessages && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
                <LoadErrorPanel errorCode={messagesError} onRetry={retryFetchMessages} />
              </div>
            )}
            <motion.div
              key={chatKey}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-1 h-full w-full overflow-hidden"
            >
              <AssistantChatInner
                activeCourse={activeCourse}
                isOnboarded={isOnboarded}
                isCoursesLoading={isCoursesLoading}
                coursesError={coursesError}
                retryCourses={retryCourses}
                localOnboarded={localOnboarded}
                handleCompleteOnboarding={handleCompleteOnboarding}
                handleSkipOnboarding={handleSkipOnboarding}
                setActiveCourse={setActiveCourse}
                activeThreadId={activeThreadId}
                draftText={draftText}
                chatKey={chatKey}
                onDraftSave={handleDraftSave}
                onThreadSwitch={onThreadChange}
                activeView={activeView}
                onToggleView={setActiveView}
                artifactPanelOpen={artifactPanelOpen}
                setArtifactPanelOpen={setArtifactPanelOpen}
                emailHistoryOpen={emailHistoryOpen}
                setEmailHistoryOpen={setEmailHistoryOpen}
              />
            </motion.div>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
};

export const AssistantApp = () => {
  return (
    <ChatHistoryProvider>
      <AssistantAppContent />
    </ChatHistoryProvider>
  );
};
