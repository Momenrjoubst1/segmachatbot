
import { AssistantRuntimeProvider, Suggestions, useAui, useAuiState } from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shadcn } from "./shadcn/AssistantLayout";
import { useRuntime, MessageSyncer } from "./ui/useChatRuntime";
import { useChatHistory, ChatHistoryProvider } from "../../hooks/useChatHistory";
import { useCourses, type AcademicCourse } from "../../hooks/useCourses";
import { useScrollPreservation } from "../../hooks/useScrollPreservation";
import { useTitle } from "@/context/TitleContext";
import { useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState, useTransition } from "react";
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
import { BotActivityReporter } from "./ui/bot-activity/BotActivityReporter";
import { AssistantLayoutProvider } from "./context/AssistantLayoutContext";
import { AssistantSettingsProvider } from "./context/AssistantSettingsContext";
import { ChatModelProvider } from "./context/ChatModelContext";
import { MaterialViewerDialog } from "./ui/material-viewer/MaterialViewerDialog";
import {
  COUNTRY_RESOLVE_GRACE_MS,
  useIsInJordan,
} from "./hooks/useUserCountry";


/**
 * Welcome pills under the composer, from the chat namespace (suggestion.*
 * keys). The pill renders `title` (SuggestionPrimitive.Title); `prompt` is
 * what actually gets sent when clicked.
 *
 * Dialect targeting: visitors in Jordan get the Jordanian-dialect set
 * (`lng: "ar"`), everyone else gets the English defaults. Pills are held
 * back briefly until the country lookup settles (or its grace elapses) so
 * labels never visibly flip after mount. UI language stays English/LTR.
 */
const SUGGESTION_KEYS = [
  ["suggestion.registerCourses", "suggestion.registerCoursesPrompt"],
  ["suggestion.aboutJust", "suggestion.aboutJustPrompt"],
  ["suggestion.organizeNotes", "suggestion.organizeNotesPrompt"],
] as const;

const useWelcomeSuggestions = () => {
  const { t } = useTranslation("chat");
  const inJordan = useIsInJordan();

  const [resolved, setResolved] = useState(inJordan !== null);
  useEffect(() => {
    if (inJordan !== null) {
      setResolved(true);
      return;
    }
    const timer = setTimeout(() => setResolved(true), COUNTRY_RESOLVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [inJordan]);

  return useMemo(() => {
    // Unresolved past the grace window → default (English) set.
    const lng = resolved ? (inJordan === true ? "ar" : "en") : null;
    return SUGGESTION_KEYS.map(([titleKey, promptKey]) =>
      lng === null
        ? null
        : {
            title: t(titleKey, { lng }),
            label: t(titleKey, { lng }),
            prompt: t(promptKey, { lng }),
          }
    ).filter((s): s is { title: string; label: string; prompt: string } => s !== null);
  }, [t, inJordan, resolved]);
};

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
        const composer = aui.composer() as { getText?: () => string };
        const text = typeof composer?.getText === "function" ? composer.getText() : "";
        if (text) {
          onDraftSaveRef.current(chatKeyRef.current, text);
        }
      } catch {
        // Composer not mounted — nothing to save
      }
    };
    // pagehide covers refresh, tab close, and mobile app switch;
    // it fires reliably even when beforeunload is ignored (iOS Safari).
    window.addEventListener("pagehide", saveDraftNow);
    document.addEventListener("visibilitychange", saveDraftNow);
    // beforeunload as additional safety net (works on most desktop browsers)
    window.addEventListener("beforeunload", saveDraftNow);
    // Periodic save as last resort (every 5s) - handles cases where
    // pagehide/visibilitychange/beforeunload all fail (e.g., iOS Safari kills process)
    const intervalId = setInterval(saveDraftNow, 5_000);
    return () => {
      window.removeEventListener("pagehide", saveDraftNow);
      document.removeEventListener("visibilitychange", saveDraftNow);
      window.removeEventListener("beforeunload", saveDraftNow);
      clearInterval(intervalId);
    };
  }, [aui]);

  useLayoutEffect(() => {
    const prevKey = prevKeyRef.current;
    if (prevKey !== chatKey) {
      onThreadSwitch(prevKey, chatKey);

      try {
        const composer = aui.composer() as { getText?: () => string };
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
}

/**
 * Inner component that runs inside AssistantRuntimeProvider.
 */
const AssistantChatInnerRuntime = ({
  activeCourse,
  isOnboarded,
  isCoursesLoading,
  coursesError,
  retryCourses,
  localOnboarded,
  handleCompleteOnboarding,
  handleSkipOnboarding,
  setActiveCourse,
  draftText,
  chatKey,
  onDraftSave,
  onThreadSwitch,
}: Omit<AssistantChatInnerProps, "activeThreadId">) => {
  const { isGuestMode } = useGuestMode();
  const runtime = useRuntime(activeCourse, chatKey);
  const welcomeSuggestions = useWelcomeSuggestions();
  const aui = useAui({
    suggestions: Suggestions(welcomeSuggestions),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <SendStateProvider>
        <MessageSyncer />
        <BotActivityReporter />
        <AssistantSettingsProvider>
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
            isGuestMode={isGuestMode}
          />
        </RAGProvider>
        </AssistantSettingsProvider>
      </SendStateProvider>
    </AssistantRuntimeProvider>
  );
};

const AssistantChatInner = (props: AssistantChatInnerProps) => {
  // Destructure activeThreadId out so it's not passed to the runtime component
  const { activeThreadId: _activeThreadId, ...rest } = props;
  return <AssistantChatInnerRuntime {...rest} />;
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

  // Listen for keyboard-triggered sidebar toggle (Ctrl+Shift+E), wired from
  // the global shortcut handler in AssistantLayout. The real toggle action
  // lives here in the parent, so we bridge the event to it.
  useEffect(() => {
    const handleToggleSidebar = () => actions.toggleSidebar();
    window.addEventListener("sigma:toggle-sidebar", handleToggleSidebar);
    return () => window.removeEventListener("sigma:toggle-sidebar", handleToggleSidebar);
  }, [actions]);

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
            {/*
              ChatModelProvider lives above the chatKey-keyed remount so the
              user's model choice persists across new chats / thread switches.
              Without this, picking a model and then starting a new chat would
              silently reset it to the app default.
            */}
            <ChatModelProvider>
              <motion.div
                key={chatKey}
                initial={false}
                animate={{ opacity: 1 }}
                className="flex flex-1 h-full w-full overflow-hidden"
              >
                <AssistantLayoutProvider
                  value={{
                    activeView: state.activeView,
                    onToggleView: setActiveView,
                    artifactPanelOpen: state.artifactPanelOpen,
                    setArtifactPanelOpen,
                    emailHistoryOpen: state.emailHistoryOpen,
                    setEmailHistoryOpen,
                  }}
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
                  />
                </AssistantLayoutProvider>
              </motion.div>
            </ChatModelProvider>
          </div>
        </div>
      </TooltipProvider>
      <SearchDialog />
      {/* Global study-material viewer — opened from material cards in replies */}
      <MaterialViewerDialog />
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
