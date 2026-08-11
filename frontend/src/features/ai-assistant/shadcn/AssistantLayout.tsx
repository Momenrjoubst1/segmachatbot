import { type AcademicCourse } from "../../../hooks/useCourses";
import { useState, useEffect, useCallback, useMemo, type FC, lazy, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";

import { useKeyboardShortcuts } from "../../../hooks/useKeyboardShortcuts";
import { toast } from "sonner";
import type { CalendarEvent } from "@/features/calendar/types";
import useCalendarSync from "@/features/calendar/hooks/useCalendarSync";
import { Thread } from "./components/Thread/ThreadWelcome";
import { useAgenticAction } from "../../../context/AgenticUIBus";
import { BarsSpinner } from "@/components/ui/BarsSpinner";
import { ErrorBoundary } from "@/components/ui/core/ErrorBoundary";

// Lazy load heavy components
const EmailHistoryPanel = lazy(() => import("../components/EmailHistoryPanel").then(m => ({ default: m.EmailHistoryPanel })));
const ArtifactPanel = lazy(() => import("@/features/artifacts/ArtifactPanel").then(m => ({ default: m.ArtifactPanel })));
const FullScreenCalendar = lazy(() => import("@/components/ui/fullscreen-calendar").then(m => ({ default: m.FullScreenCalendar })));
const SchedulingPanel = lazy(() => import("@/features/calendar/components").then(m => ({ default: m.SchedulingPanel })));

// Re-export for backward compatibility
export { useAssistantSettingsStore } from "./components/Thread/MessageComponents";
export { Thread } from "./components/Thread/ThreadWelcome";

const PanelLoading = () => (
  <div className="flex items-center justify-center h-32">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

export const Shadcn: FC<{
  isOnboarded: boolean;
  isCoursesLoadingVisible?: boolean;
  coursesError?: string | null;
  retryCourses?: () => void;
  onActiveCourseChange: (course: AcademicCourse | null) => void;
  onCompleteOnboarding: (draftCourses: { course_name: string; credit_hours: number }[]) => Promise<void>;
  onSkipOnboarding?: () => void;
  activeView: 'chat' | 'calendar';
  onToggleView: (view: 'chat' | 'calendar') => void;
  artifactPanelOpen: boolean;
  setArtifactPanelOpen: (open: boolean) => void;
  emailHistoryOpen: boolean;
  setEmailHistoryOpen: (open: boolean) => void;
}> = ({ isOnboarded, isCoursesLoadingVisible, coursesError, retryCourses, onActiveCourseChange, onCompleteOnboarding, onSkipOnboarding, activeView, onToggleView, artifactPanelOpen, setArtifactPanelOpen, emailHistoryOpen, setEmailHistoryOpen }) => {
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);

  // Calendar state
  const [calendarUserId, setCalendarUserId] = useState<string | undefined>();
  const [showScheduler, setShowScheduler] = useState(false);
  const [selectedDate, _setSelectedDate] = useState(new Date());

  // Get user ID for calendar
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) setCalendarUserId(data.user.id);
    }).catch(console.error);
  }, []);

  const calendar = useCalendarSync({ userId: calendarUserId });

  // Fetch events on mount and when calendar view opens
  useEffect(() => {
    if (calendarUserId && activeView === 'calendar') {
      calendar.fetchEvents('this_month');
    }
  }, [calendarUserId, activeView]);

  // Listen for AI-triggered calendar refresh
  useEffect(() => {
    const handleRefresh = () => {
      if (calendarUserId) calendar.fetchEvents('this_month');
    };
    window.addEventListener("sigma:calendar-refresh", handleRefresh);
    return () => window.removeEventListener("sigma:calendar-refresh", handleRefresh);
  }, [calendarUserId, calendar.fetchEvents]);

  const handleCreateEvent = useCallback(async (event: Partial<CalendarEvent>) => {
    const result = await calendar.createEvent(event);
    if (result.success) {
      setShowScheduler(false);
      toast.success("Event created successfully!");
    } else {
      toast.error(result.error || "Failed to create event");
    }
  }, [calendar]);

  const handleDeleteEvent = useCallback(async (eventId: string) => {
    const result = await calendar.deleteEvent(eventId);
    if (result.success) {
      toast.success("Event deleted");
    } else {
      toast.error(result.error || "Failed to delete event");
    }
  }, [calendar]);

  // Convert CalendarEvent[] to FullScreenCalendar's CalendarData[] format
  const calendarData = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of calendar.events) {
      const dateKey = new Date(event.start_time).toDateString();
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey)!.push(event);
    }
    return Array.from(grouped.entries()).map(([dateKey, dayEvents]) => ({
      day: new Date(dateKey),
      events: dayEvents.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        time: new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        datetime: e.start_time,
        color: e.color,
        attendees: e.attendees,
      })),
    }));
  }, [calendar.events]);

  useEffect(() => {
    const openArtifacts = (event: Event) => {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail?.artifactId;
      if (artifactId) setActiveArtifactId(artifactId);
      setArtifactPanelOpen(true);
    };
    window.addEventListener("sigma:open-artifacts", openArtifacts);
    return () => window.removeEventListener("sigma:open-artifacts", openArtifacts);
  }, [setArtifactPanelOpen]);

  useKeyboardShortcuts({
    "ctrl+n": () => {
      onActiveCourseChange(null);
      toast("New chat created");
    },
    "ctrl+k": () => {
      const composer = document.querySelector('[data-slot="aui-composer-input"]') as HTMLElement;
      composer?.focus();
    },
    "ctrl+shift+c": () => {
      const messages = document.querySelectorAll('[data-role="assistant"]');
      const last = messages[messages.length - 1];
      if (last) {
        const text = last.textContent;
        if (text) {
          navigator.clipboard.writeText(text);
          toast("Copied to clipboard");
        }
      }
    },
    "escape": () => {
      const cancelButton = document.querySelector(
        '[aria-label="Stop generating"]'
      ) as HTMLButtonElement | null;
      cancelButton?.click();
    },
  });

  // ─── Octopus: Listen for AgenticUI actions from the stream parser ────
  useAgenticAction("header", useCallback((action) => {
    if (action.action === "TOGGLE_RAG") {
      // RAG toggle is handled by Header component directly
    } else if (action.action === "SET_VIEW") {
      onToggleView(action.payload.view);
    }
  }, [onToggleView]));

  useAgenticAction("panel", useCallback((action) => {
    if (action.action === "OPEN_CALENDAR") {
      onToggleView('calendar');
    } else if (action.action === "OPEN_EMAIL") {
      setEmailHistoryOpen(true);
    } else if (action.action === "OPEN_ARTIFACTS") {
      if (action.payload?.artifactId) {
        setActiveArtifactId(action.payload.artifactId);
      }
      setArtifactPanelOpen(true);
    }
  }, [onToggleView, setEmailHistoryOpen, setArtifactPanelOpen]));

  useAgenticAction("composer", useCallback((action) => {
    if (action.action === "SET_TEXT") {
      const composer = document.querySelector('[data-slot="aui-composer-input"]') as HTMLElement;
      if (composer) {
        (composer as any).focus();
        // Dispatch input event for Lexical to pick up
        const textArea = composer.querySelector('[contenteditable]') as HTMLElement;
        if (textArea) {
          textArea.focus();
          // Use execCommand for contenteditable elements
          document.execCommand('selectAll', false, undefined);
          document.execCommand('insertText', false, action.payload.text);
        }
      }
    } else if (action.action === "FOCUS") {
      const composer = document.querySelector('[data-slot="aui-composer-input"]') as HTMLElement;
      composer?.focus();
    }
  }, []));

  useAgenticAction("sidebar", useCallback((action) => {
    if (action.action === "OPEN_THREAD") {
      // Navigate to the target thread by updating the chat history state
      // The useChatHistory hook's setActiveThreadId will handle the URL change
      const event = new CustomEvent("sigma:navigate-thread", {
        detail: { threadId: action.payload.threadId },
      });
      window.dispatchEvent(event);
    }
  }, []));

  return (
    <div className="flex flex-1 flex-col h-full w-full bg-background">
          <div className="flex flex-1 overflow-hidden relative">
            <main
              className="relative flex flex-1 overflow-hidden min-w-0"
            >
              {activeView === 'calendar' ? (
                <div className="flex-1 h-full overflow-y-auto custom-scrollbar bg-background">
                  {calendar.isCalendarLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <Suspense fallback={<PanelLoading />}>
                      <ErrorBoundary componentName="FullScreenCalendar">
                        <FullScreenCalendar
                          data={calendarData}
                          onCreateEvent={() => setShowScheduler(true)}
                          onEditEvent={(_event) => {
                            // Open the scheduler with the event data
                            setShowScheduler(true)
                          }}
                          onDeleteEvent={handleDeleteEvent}
                        />
                      </ErrorBoundary>
                    </Suspense>
                  )}

                  {/* Scheduling Panel Slide-in */}
                  {showScheduler && (
                    <div className="fixed right-0 top-0 bottom-0 w-[420px] border-l border-white/[0.08] bg-[#0f0f10] z-50 overflow-y-auto shadow-2xl">
                      <Suspense fallback={<PanelLoading />}>
                        <ErrorBoundary componentName="SchedulingPanel">
                          <SchedulingPanel
                            onSubmit={handleCreateEvent}
                            onCancel={() => setShowScheduler(false)}
                            initialData={{
                              start_time: selectedDate.toISOString(),
                              end_time: new Date(selectedDate.getTime() + 60 * 60 * 1000).toISOString(),
                            }}
                          />
                        </ErrorBoundary>
                      </Suspense>
                    </div>
                  )}
                </div>
              ) : (
                <Thread
                  isOnboarded={isOnboarded}
                  onCompleteOnboarding={onCompleteOnboarding}
                  onSkipOnboarding={onSkipOnboarding}
                />
              )}
              {isCoursesLoadingVisible && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                  <BarsSpinner size={60} className="text-primary" />
                </div>
              )}
              {coursesError && !isCoursesLoadingVisible && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
                  <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center max-w-md">
                    <div className="text-destructive text-sm font-medium">{coursesError}</div>
                    {retryCourses && (
                      <button
                        onClick={retryCourses}
                        className="rounded-lg bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </main>
            <Suspense fallback={<PanelLoading />}>
              <ErrorBoundary componentName="ArtifactPanel">
                <ArtifactPanel
                  open={artifactPanelOpen}
                  onClose={() => setArtifactPanelOpen(false)}
                  activeArtifactId={activeArtifactId}
                />
              </ErrorBoundary>
            </Suspense>
            {emailHistoryOpen && (
              <div className="absolute right-0 top-0 h-full w-96 border-l bg-background z-30 shadow-xl">
                <Suspense fallback={<PanelLoading />}>
                  <ErrorBoundary componentName="EmailHistoryPanel">
                    <EmailHistoryPanel
                      onClose={() => setEmailHistoryOpen(false)}
                      onAskBot={(message) => {
                        setEmailHistoryOpen(false);
                        const composer = document.querySelector('[data-slot="aui-composer-input"]') as HTMLElement;
                        if (composer) {
                          composer.focus();
                          const textArea = composer.querySelector('[contenteditable]') as HTMLElement;
                          if (textArea) {
                            textArea.focus();
                            document.execCommand('selectAll', false, undefined);
                            document.execCommand('insertText', false, message);
                          } else {
                            // Lexical composer input not found — copy to clipboard as fallback
                            navigator.clipboard.writeText(message);
                            toast.info("Message copied to clipboard — paste it into the composer");
                          }
                        }
                      }}
                    />
                  </ErrorBoundary>
                </Suspense>
              </div>
            )}
          </div>
    </div>
  );
};
