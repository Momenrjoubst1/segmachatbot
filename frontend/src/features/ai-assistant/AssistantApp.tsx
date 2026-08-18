
import { AssistantRuntimeProvider, Suggestions, useAui, useAuiState } from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shadcn } from "./shadcn/AssistantLayout";
import { useRuntime, MessageSyncer } from "./ui/useChatRuntime";
import { useChatHistory, ChatHistoryProvider } from "../../hooks/useChatHistory";
import { useCourses, type AcademicCourse } from "../../hooks/useCourses";
import { useScrollPreservation } from "../../hooks/useScrollPreservation";
import { useTitle } from "@/context/TitleContext";
import { useCallback, useEffect, useRef, useLayoutEffect, useTransition } from "react";
import { Toaster } from "sonner";
import { RAGProvider } from "../../context/RAGContext";
import { TopLoadingBar } from "@/components/ui/TopLoadingBar";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { LoadErrorPanel } from "@/components/ui/LoadErrorPanel";
import { LoadingAnnouncer } from "@/components/ui/LoadingAnnouncer";
import type { LoadErrorCode } from "@/lib/load-errors";

import { SidebarView } from "./shadcn/components/Sidebar/SidebarView";
import { MobileSidebarView } from "./shadcn/components/Sidebar/MobileSidebarView";
import { SearchDialog } from "./shadcn/components/Sidebar/SearchDialog";
import { Header } from "./shadcn/components/Header/Header";
import { useAssistantState } from "./hooks/useAssistantState";
import { GuestModeProvider, useGuestMode } from "@/context/GuestModeContext";
import { SendStateProvider } from "@/context/SendStateContext";


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

  // Keep the latest key/save fn available to the unload handler without
  // re-registering listeners on every render.
  const chatKeyRef = useRef(chatKey);
  chatKeyRef.current = chatKey;
  const onDraftSaveRef = useRef(onDraftSave);
  onDraftSaveRef.current = onDraftSave;

  // DraftSaver only fires on key *change*, so without this the composer text
  // of a brand-new chat is lost on refresh/close (there is no key change to
  // trigger a save). pagehide covers refresh, tab close, and mobile app switch;
  // it fires reliably even when beforeunload is ignored (iOS Safari).
  useEffect(() => {
    const saveDraftNow = () => {
      try {
        const composer = aui.composer() as any;
        const text = typeof composer?.getText === "function" ? composer.getText() : "";
        if (text) {
          onDraftSaveRef.current(chatKeyRef.current, text);
        }
      } catch {
        // Composer not mounted — nothing to save
      }
    };
    window.addEventListener("pagehide", saveDraftNow);
    document.addEventListener("visibilitychange", saveDraftNow);
    return () => {
      window.removeEventListener("pagehide", saveDraftNow);
      document.removeEventListener("visibilitychange", saveDraftNow);
    };
  }, [aui]);

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
  coursesError: LoadErrorCode | null;
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
  isGuestMode: boolean;
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
  isGuestMode,
}: AssistantChatInnerProps) => {
  const runtime = useRuntime(activeCourse, chatKey);
  const aui = useAui({
    suggestions: Suggestions([...WELCOME_SUGGESTIONS]),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <SendStateProvider>
        <MessageSyncer />
        <RAGProvider>
          <DraftSaver chatKey={chatKey} onDraftSave={onDraftSave} onThreadSwitch={onThreadSwitch} />
          <DraftRestorer draftText={draftText} />
          <Shadcn
            isOnboarded={isGuestMode || isOnboarded}
            isCoursesLoadingVisible={!isGuestMode && isCoursesLoading && !localOnboarded}
            coursesError={isGuestMode ? null : coursesError}
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
            isGuestMode={isGuestMode}
          />
        </RAGProvider>
      </SendStateProvider>
    </AssistantRuntimeProvider>
  );
};

const AssistantAppContent = () => {
  const { threads, activeThreadId, isLoadingMessages, messagesError, retryFetchMessages, saveDraft, getDraft, newChatCount } = useChatHistory();
  const { t } = useTranslation(["errors", "common"]);
  const { setBaseTitle } = useTitle();
  const [, startTransition] = useTransition();
  const { isGuestMode } = useGuestMode();

  const {
    courses: dbCourses,
    isCoursesLoading,
    coursesError,
    refetch: refetchCourses,
    retryCourses,
  } = useCourses();

  // Guest sessions must never inherit a signed-in user's local course state.
  // The guest chat is available immediately; course onboarding starts only
  // after authentication.
  // Course-onboarding form removed: study materials are added by uploading
  // files in chat (or the upload dialog) — each material creates its own
  // sidebar course entry. dbCourses is now the single source of truth.
  const courses = isGuestMode ? [] : dbCourses;
  const isOnboarded = true;

  // Use consolidated state management hook
  const { state, actions } = useAssistantState(activeThreadId, threads, dbCourses);

  // Transition-wrapped setters for heavy UI updates
  const setActiveView = useCallback((view: 'chat' | 'calendar') => {
    startTransition(() => { actions.setActiveView(view); });
  }, [actions]);
  const setArtifactPanelOpen = useCallback((open: boolean) => {
    startTransition(() => { actions.setArtifactPanelOpen(open); });
  }, [actions]);
  const setEmailHistoryOpen = useCallback((open: boolean) => {
    startTransition(() => { actions.setEmailHistoryOpen(open); });
  }, [actions]);

  const chatKey = activeThreadId
    ? activeThreadId
    : state.activeCourse
    ? `new-${state.activeCourse.id}-${newChatCount}`
    : `new-general-${newChatCount}`;

  const { onThreadChange, restorePosition: _restorePosition } = useScrollPreservation(chatKey);

  const handleDraftSave = useCallback((key: string, text: string) => {
    saveDraft(key, text);
  }, [saveDraft]);

  useEffect(() => {
    setBaseTitle("Sigma AI");
    return () => setBaseTitle("Sigma AI");
  }, [setBaseTitle]);

  // Onboarding form removed — materials/courses are created by uploading
  // files in chat. Handlers kept as stable no-ops for layout prop types.
  const handleCompleteOnboarding = useCallback(async (_draftCourses: { course_name: string; credit_hours: number }[]) => {
    await refetchCourses();
  }, [refetchCourses]);

  const handleSkipOnboarding = useCallback(() => {}, []);

  const draftText = getDraft(chatKey);

  return (
    <div className="assistant-app-shell flex flex-1 h-full w-full overflow-hidden bg-[#FDFBF7] text-foreground">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#ffffff',
            border: '1px solid #EBE5DF',
            color: '#2C2825',
            padding: '8px 12px',
            fontSize: '13px',
            minWidth: 'auto',
            maxWidth: 'fit-content',
            borderRadius: '8px',
            fontFamily: 'IBM Plex Sans Arabic, Inter, sans-serif',
          },
          className: 'toast-compact',
        }}
        offset="16px"
        expand={false}
        richColors
      />
      <TooltipProvider>
        <div className="hidden md:block shrink-0 overflow-visible">
          <SidebarView
            collapsed={state.sidebarCollapsed}
            onToggle={() => actions.toggleSidebar()}
            courses={courses}
            activeCourse={state.activeCourse}
            onActiveCourseChange={actions.setActiveCourse}
            isGuestMode={isGuestMode}
          />
        </div>
        <div className="md:hidden shrink-0">
          <MobileSidebarView
            courses={courses}
            activeCourse={state.activeCourse}
            onActiveCourseChange={actions.setActiveCourse}
            isGuestMode={isGuestMode}
          />
        </div>
        <div className="flex-1 min-w-0 h-full flex flex-col">
          <LoadingAnnouncer
            busy={isLoadingMessages}
            label={t("common:loadingMessages", { ns: "common" })}
          />
          <Header
            sidebarCollapsed={state.sidebarCollapsed}
            onToggleSidebar={() => actions.toggleSidebar()}
            activeView={state.activeView}
            onToggleView={setActiveView}
            onToggleArtifacts={() => setArtifactPanelOpen(!state.artifactPanelOpen)}
            onToggleEmailHistory={() => setEmailHistoryOpen(!state.emailHistoryOpen)}
            isGuestMode={isGuestMode}
          />
          <div
            className="relative flex-1 min-h-0 overflow-hidden"
            aria-busy={isLoadingMessages}
            aria-live="polite"
          >
            {isLoadingMessages && !messagesError && <TopLoadingBar />}
            {messagesError && !isLoadingMessages && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
                <LoadErrorPanel errorCode={messagesError} onRetry={retryFetchMessages} />
              </div>
            )}
            <motion.div
              key={chatKey}
              initial={false}
              animate={{ opacity: 1 }}
              className="flex flex-1 h-full w-full overflow-hidden"
            >
              <AssistantChatInner
                activeCourse={state.activeCourse}
                isOnboarded={isOnboarded}
                isCoursesLoading={isCoursesLoading}
                coursesError={coursesError}
                retryCourses={retryCourses}
                localOnboarded={false}
                handleCompleteOnboarding={handleCompleteOnboarding}
                handleSkipOnboarding={handleSkipOnboarding}
                setActiveCourse={actions.setActiveCourse}
                activeThreadId={activeThreadId}
                draftText={draftText}
                chatKey={chatKey}
                onDraftSave={handleDraftSave}
                onThreadSwitch={onThreadChange}
                activeView={state.activeView}
                onToggleView={setActiveView}
                artifactPanelOpen={state.artifactPanelOpen}
                setArtifactPanelOpen={setArtifactPanelOpen}
                emailHistoryOpen={state.emailHistoryOpen}
                setEmailHistoryOpen={setEmailHistoryOpen}
                isGuestMode={isGuestMode}
              />
            </motion.div>
          </div>
        </div>
      </TooltipProvider>
      <SearchDialog />
    </div>
  );
};

export const AssistantApp = () => {
  return (
    <GuestModeProvider>
      <ChatHistoryProvider>
        <AssistantAppContent />
      </ChatHistoryProvider>
    </GuestModeProvider>
  );
};
