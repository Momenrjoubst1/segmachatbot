import { type AcademicCourse } from "../../../hooks/useCourses";
import { useState, useEffect, useCallback, useMemo, type FC, lazy, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTranslation } from "react-i18next";
import { LOAD_ERROR_I18N, type LoadErrorCode } from "@/lib/load-errors";

import { useKeyboardShortcuts } from "../../../hooks/useKeyboardShortcuts";
import { useChatHistory } from "@/hooks/useChatHistory";
import { toast } from "sonner";
import { startOfMonth, endOfYear } from "date-fns";
import type { CalendarEvent } from "@/features/calendar/types";
import useCalendarSync from "@/features/calendar/hooks/useCalendarSync";
import { expandRecurringEvents } from "@/features/calendar/utils/recurrence";
import { Thread } from "./components/Thread/ThreadWelcome";
import { useAgenticAction } from "../../../context/AgenticUIBus";
import { useAssistantLayout } from "../context/AssistantLayoutContext";
import { BarsSpinner } from "@/components/ui/BarsSpinner";
import { LoadingSpinner } from "@/components/ui/LoadingStates";
import { ErrorBoundary } from "@/components/ui/core/ErrorBoundary";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Lazy load heavy components
const EmailHistoryPanel = lazy(() => import("../components/EmailHistoryPanel").then(m => ({ default: m.EmailHistoryPanel })));
const FullScreenCalendar = lazy(() => import("@/components/ui/fullscreen-calendar").then(m => ({ default: m.FullScreenCalendar })));
const SchedulingPanel = lazy(() => import("@/features/calendar/components").then(m => ({ default: m.SchedulingPanel })));
const TaskList = lazy(() => import("@/features/tasks/components/TaskList"));

// Re-export for backward compatibility
export { useAssistantSettings } from "../context/AssistantSettingsContext";
export { Thread } from "./components/Thread/ThreadWelcome";

const PanelLoading = () => (
  <div className="flex items-center justify-center h-32">
    <LoadingSpinner size="sm" />
  </div>
);

export const Shadcn: FC<{
  isOnboarded: boolean;
  isCoursesLoadingVisible?: boolean;
  coursesError?: LoadErrorCode | null;
  retryCourses?: () => void;
  onActiveCourseChange: (course: AcademicCourse | null) => void;
  onCompleteOnboarding: (draftCourses: { course_name: string; credit_hours: number }[]) => Promise<void>;
  onSkipOnboarding?: () => void;
  isGuestMode?: boolean;
}> = ({ isOnboarded, isCoursesLoadingVisible, coursesError, retryCourses, onActiveCourseChange, onCompleteOnboarding, onSkipOnboarding, isGuestMode = false }) => {
  const { activeView, onToggleView, emailHistoryOpen, setEmailHistoryOpen } = useAssistantLayout();
  const { t } = useTranslation("errors");
  const { t: tCal } = useTranslation("calendar");
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const { loadThread, goToPreviousThread, goToNextThread } = useChatHistory();

  // Same behavior as the sidebar "New Chat" button: clear the active thread
  // AND reset the active course, so the welcome screen shows immediately.
  const startNewChat = useCallback(() => {
    loadThread(null);
    onActiveCourseChange(null);
    toast("New chat created");
  }, [loadThread, onActiveCourseChange]);

  // Navigation callbacks for keyboard shortcuts - message navigation still uses events
  const goToPreviousMessage = useCallback(() => {
    const event = new CustomEvent("sigma:navigate-previous-message");
    window.dispatchEvent(event);
  }, []);

  const goToNextMessage = useCallback(() => {
    const event = new CustomEvent("sigma:navigate-next-message");
    window.dispatchEvent(event);
  }, []);

  const toggleSidebar = useCallback(() => {
    const event = new CustomEvent("sigma:toggle-sidebar");
    window.dispatchEvent(event);
  }, []);

  const toggleEmail = useCallback(() => {
    setEmailHistoryOpen(!emailHistoryOpen);
  }, [emailHistoryOpen, setEmailHistoryOpen]);

  const toggleCalendar = useCallback(() => {
    onToggleView(activeView === 'chat' ? 'calendar' : 'chat');
  }, [activeView, onToggleView]);

  // Calendar state
  const [calendarUserId, setCalendarUserId] = useState<string | undefined>();
  const [showScheduler, setShowScheduler] = useState(false);
  /** Event being edited; null = create mode. */
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  /** Day chosen in the grid — prefills the create form. */
  const [selectedDay, setSelectedDay] = useState(new Date());
  /** Pending delete awaiting confirmation. */
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);

  // Get user ID for calendar
  useEffect(() => {
    if (isGuestMode) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) setCalendarUserId(data.user.id);
    }).catch(console.error);
  }, [isGuestMode]);

  const calendar = useCalendarSync({ userId: isGuestMode ? undefined : calendarUserId });

  // Fetch events on mount and when calendar view opens
  useEffect(() => {
    if (!isGuestMode && calendarUserId && activeView === 'calendar') {
      calendar.fetchEvents('this_month');
    }
  }, [calendarUserId, activeView]);

  // Listen for AI-triggered calendar refresh
  useEffect(() => {
    if (isGuestMode) return;
    const handleRefresh = () => {
      if (calendarUserId) calendar.fetchEvents('this_month');
    };
    window.addEventListener("sigma:calendar-refresh", handleRefresh);
    return () => window.removeEventListener("sigma:calendar-refresh", handleRefresh);
  }, [calendarUserId, calendar.fetchEvents]);

  const closeScheduler = useCallback(() => {
    setShowScheduler(false);
    setEditingEvent(null);
  }, []);

  const handleCreateEvent = useCallback(async (event: Partial<CalendarEvent>) => {
    const result = await calendar.createEvent(event);
    if (result.success) {
      closeScheduler();
      toast.success(tCal("toastCreated"));
    } else {
      toast.error(result.error || tCal("toastSaveFailed"));
    }
  }, [calendar, closeScheduler, tCal]);

  const handleUpdateEvent = useCallback(async (event: Partial<CalendarEvent>) => {
    if (!editingEvent?.id) return;
    const result = await calendar.updateEvent(editingEvent.id, event);
    if (result.success) {
      closeScheduler();
      toast.success(tCal("toastUpdated"));
    } else {
      toast.error(result.error || tCal("toastSaveFailed"));
    }
  }, [calendar, editingEvent, closeScheduler, tCal]);

  // Confirmation happens here (single choke point); both the grid modal and
  // the scheduler panel route their deletes through this.
  const requestDeleteEvent = useCallback((eventId: string) => {
    const base = calendar.events.find((e) => e.id === eventId);
    setDeleteTarget(base ?? { id: eventId, title: "" } as CalendarEvent);
  }, [calendar.events]);

  const confirmDeleteEvent = useCallback(async () => {
    if (!deleteTarget) return;
    const result = await calendar.deleteEvent(deleteTarget.id);
    if (result.success) {
      toast.success(tCal("toastDeleted"));
    } else {
      toast.error(result.error || tCal("toastDeleteFailed"));
    }
    setDeleteTarget(null);
    setShowScheduler(false);
    setEditingEvent(null);
  }, [calendar, deleteTarget, t]);

  // Convert CalendarEvent[] to the grid's CalendarData[] format, expanding
  // recurring bases into concrete occurrences for the visible window.
  const calendarData = useMemo(() => {
    const now = new Date();
    const expanded = expandRecurringEvents(calendar.events, startOfMonth(now), endOfYear(now));
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of expanded) {
      const dateKey = new Date(event.start_time).toDateString();
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey)!.push(event);
    }
    return Array.from(grouped.entries()).map(([dateKey, dayEvents]) => ({
      day: new Date(dateKey),
      events: dayEvents.map((e) => ({
        id: e.id,
        baseId: e.id.split(':')[0],
        title: e.title,
        description: e.description,
        location: e.location,
        time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(e.start_time)),
        datetime: e.start_time,
        end_datetime: e.end_time,
        is_all_day: e.is_all_day,
        color: e.color,
        attendees: e.attendees?.map((a) => ({ email: a.email, name: a.name, status: a.status })),
      })),
    }));
  }, [calendar.events]);

  // Month navigation inside the grid refetches the visible window (including
  // recurring bases that started before it).
  const handleVisibleRangeChange = useCallback((range: { start: Date; end: Date }) => {
    if (!calendarUserId) return;
    calendar.fetchEvents('this_month', undefined, range);
  }, [calendarUserId, calendar.fetchEvents]);

  const openEditEvent = useCallback((gridEvent: { baseId?: string; id: string }) => {
    const baseId = gridEvent.baseId ?? gridEvent.id;
    const full = calendar.events.find((e) => e.id === baseId);
    if (!full) return;
    setEditingEvent(full);
    setShowScheduler(true);
  }, [calendar.events]);

  const openCreateAtSelectedDay = useCallback(() => {
    setEditingEvent(null);
    setShowScheduler(true);
  }, []);

  useKeyboardShortcuts({
    // General shortcuts
    "ctrl+shift+o": startNewChat,
    "ctrl+n": startNewChat,
    "ctrl+k": () => {
      const composer = document.querySelector('[data-slot="aui-composer-input"]') as HTMLElement;
      composer?.focus();
    },
    "ctrl+/": () => setShortcutsModalOpen(true),
    "escape": () => {
      // Use the stable class, not the aria-label — the label is translated
      // (e.g. Arabic "إيقاف التوليد") and the old selector never matched it.
      const cancelButton = document.querySelector(
        ".aui-composer-cancel"
      ) as HTMLButtonElement | null;
      cancelButton?.click();
    },
    // Navigation shortcuts
    "ctrl+[": goToPreviousThread,
    "ctrl+]": goToNextThread,
    "ctrl+arrowup": goToPreviousMessage,
    "ctrl+arrowdown": goToNextMessage,
    // Action shortcuts
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
    "ctrl+shift+e": toggleSidebar,
    "ctrl+shift+m": toggleEmail,
    "ctrl+shift+k": toggleCalendar,
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
    } else if (action.action === "OPEN_TASKS") {
      onToggleView('calendar');
    } else if (action.action === "OPEN_EMAIL") {
      setEmailHistoryOpen(true);
    }
  }, [onToggleView, setEmailHistoryOpen]));

  useAgenticAction("composer", useCallback((action) => {
    if (action.action === "SET_TEXT") {
      const composer = document.querySelector('[data-slot="aui-composer-input"]') as HTMLElement;
      if (composer) {
        (composer as HTMLElement).focus();
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
          {!isGuestMode && activeView === 'calendar' ? (
            <div className="flex-1 h-full flex overflow-hidden bg-background">
              <div className="flex-1 min-w-0 h-full overflow-y-auto custom-scrollbar">
                {calendar.isCalendarLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <LoadingSpinner size="md" />
                  </div>
                ) : (
                  <Suspense fallback={<PanelLoading />}>
                    <ErrorBoundary componentName="FullScreenCalendar">
                      <FullScreenCalendar
                        data={calendarData}
                        onCreateEvent={openCreateAtSelectedDay}
                        onEditEvent={openEditEvent}
                        onDeleteEvent={requestDeleteEvent}
                        onVisibleRangeChange={handleVisibleRangeChange}
                        onSelectedDayChange={setSelectedDay}
                      />
                    </ErrorBoundary>
                  </Suspense>
                )}

                {/* Scheduling Panel Slide-in */}
                {showScheduler && (
                  <div className="fixed right-0 top-0 bottom-0 w-[420px] max-w-full border-s border-border bg-background z-50 overflow-y-auto shadow-2xl">
                    <Suspense fallback={<PanelLoading />}>
                      <ErrorBoundary componentName="SchedulingPanel">
                        <SchedulingPanel
                          key={editingEvent?.id ?? "new"}
                          onSubmit={editingEvent ? handleUpdateEvent : handleCreateEvent}
                          onDelete={requestDeleteEvent}
                          onCancel={closeScheduler}
                          existingEvents={calendar.events}
                          initialData={
                            editingEvent ?? {
                              start_time: selectedDay.toISOString(),
                              end_time: new Date(selectedDay.getTime() + 60 * 60 * 1000).toISOString(),
                            }
                          }
                        />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                )}
              </div>

              {/* Tasks panel — always visible next to the calendar */}
              <aside className="hidden md:flex w-72 shrink-0 border-l border-border">
                <Suspense fallback={<PanelLoading />}>
                  <ErrorBoundary componentName="TaskList">
                    <TaskList userId={calendarUserId} className="w-full" />
                  </ErrorBoundary>
                </Suspense>
              </aside>
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
              <BarsSpinner size={60} className="text-primary" aria-label="Loading courses" />
            </div>
          )}
          {coursesError && !isCoursesLoadingVisible && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center max-w-md">
                <div className="text-destructive text-sm font-medium">{t(LOAD_ERROR_I18N[coursesError as LoadErrorCode])}</div>
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
        {!isGuestMode && emailHistoryOpen && (
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
        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          open={shortcutsModalOpen}
          onOpenChange={setShortcutsModalOpen}
        />

        {/* Delete-event confirmation — single choke point for grid + panel */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-[420px]" dir="auto">
            <DialogHeader>
              <DialogTitle>{tCal("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {tCal("deleteMessage", { title: deleteTarget?.title ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                {tCal("keepEvent")}
              </Button>
              <Button variant="destructive" onClick={confirmDeleteEvent}>
                {tCal("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};