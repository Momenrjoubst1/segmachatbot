import { Button } from "@/components/ui/button";
import {
  PlusIcon,
  TrashIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  MoreVerticalIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FC } from "react";
import { useChatHistory, ChatThread } from "../../../hooks/useChatHistory";
import type { AcademicCourse } from "../../../hooks/useCourses";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { dispatchUIAction, useAgenticAction } from "@/context/AgenticUIBus";
import { TextbookUpload } from "../components/TextbookUpload";
import { CurriculumPanel } from "../components/CurriculumPanel";
import { FlashcardsStudy } from "../components/chat/FlashcardsStudy";
import { StudyProgressPanel } from "../components/chat/StudyProgressPanel";
import { DailyPlanPanel } from "../components/chat/DailyPlanPanel";
import { useDueFlashcardsCount } from "@/hooks/useStudy";
import { GraduationCapIcon, CalendarCheckIcon, LayersIcon, UploadIcon, BarChart3Icon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// ThreadList (main export)
// ─────────────────────────────────────────────────────────────────────────────

export const ThreadList: FC<{
  courses: AcademicCourse[];
  activeCourse: AcademicCourse | null;
  onActiveCourseChange: (course: AcademicCourse | null) => void;
  /** Called after a thread is selected — used to close the mobile Sheet */
  onThreadSelected?: () => void;
}> = ({ courses, activeCourse, onActiveCourseChange, onThreadSelected }) => {

  const {
    threads,
    getThreadsByCourse,
    loadThread,
    activeThreadId,
  } = useChatHistory();

  // ── Auto-expand courses to always show the active thread ──────────────────
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(
    () => new Set(courses?.map((c) => c.id) || [])
  );

  // Expand all newly loaded courses
  useEffect(() => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      courses?.forEach((c) => next.add(c.id));
      return next;
    });
  }, [courses]);

  // Fix #7 — auto-expand the course that contains the currently active thread
  useEffect(() => {
    if (!activeThreadId || !threads.length || !courses.length) return;
    const activeThread = threads.find((t) => t.id === activeThreadId);
    if (activeThread?.course_id) {
      setExpandedCourses((prev) => {
        if (prev.has(activeThread.course_id!)) return prev;
        const next = new Set(prev);
        next.add(activeThread.course_id!);
        return next;
      });
    }
  }, [activeThreadId, threads, courses]);

  const toggleCourse = (courseId: string) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      next.has(courseId) ? next.delete(courseId) : next.add(courseId);
      return next;
    });
  };

  const handleNewChat = (courseId?: string) => {
    // Always navigate to new chat — loadThread(null) sets URL to `?` (empty) and clears the thread
    loadThread(null);
    onActiveCourseChange(courseId ? (courses.find((c) => c.id === courseId) ?? null) : null);
    onThreadSelected?.();
  };

  const uncategorizedThreads = getThreadsByCourse(null);

  const [bookUploadCourseId, setBookUploadCourseId] = useState<string | null>(null);
  const [bookUploadDialogOpen, setBookUploadDialogOpen] = useState(false);
  type StudyTab = "curriculum" | "quiz" | "flashcards" | "progress" | "daily" | "upload";
  const [studyTab, setStudyTab] = useState<StudyTab>("curriculum");
  // "quiz" is a transient bus value that renders the curriculum panel on its quiz tab
  const activeTab: StudyTab = studyTab === "quiz" ? "curriculum" : studyTab;
  const { count: dueCount, refresh: refreshDueCount } = useDueFlashcardsCount();
  const { t } = useTranslation("study");

  // ── AI-triggered study panel actions (Octopus bus → study dialog) ─────────
  useAgenticAction("study", (action) => {
    const payload = action.payload as { tab?: StudyTab; courseId?: string };
    switch (action.action) {
      case "OPEN_FLASHCARDS":
        setStudyTab("flashcards");
        setBookUploadCourseId(payload.courseId ?? null);
        setBookUploadDialogOpen(true);
        break;
      case "OPEN_DAILY_PLAN":
        setStudyTab("daily");
        setBookUploadCourseId(null);
        setBookUploadDialogOpen(true);
        break;
      case "OPEN_QUIZ":
        setStudyTab("quiz");
        setBookUploadCourseId(payload.courseId ?? null);
        setBookUploadDialogOpen(true);
        break;
      case "OPEN_STUDY":
      default:
        setStudyTab(payload.tab ?? "daily");
        setBookUploadCourseId(payload.courseId ?? null);
        setBookUploadDialogOpen(true);
        break;
    }
  });

  const openStudyHub = useCallback(() => {
    setBookUploadCourseId(null);
    setStudyTab("daily");
    setBookUploadDialogOpen(true);
  }, []);

  // "Train me" — open the chat with a step-by-step tutor prompt for a topic.
  // The sidebar renders OUTSIDE the AuiProvider tree, so the composer hook
  // cannot be used here; the AgenticUIBus composer actions are provider-free
  // and handled by AssistantLayout (pre-fill + focus, user presses send).
  const handleTrainTopic = useCallback((topic: string) => {
    const prompt = `علّمني موضوع "${topic}" خطوة بخطوة: ابدأ بسؤال بسيط لتعرف مستواي، ثم اشرح لي مع مثال، ثم اختبرني بسؤال وصحّح لي.`;
    dispatchUIAction({ target: "composer", action: "SET_TEXT", payload: { text: prompt } });
    dispatchUIAction({ target: "composer", action: "FOCUS", payload: {} });
    setBookUploadDialogOpen(false);
  }, []);

  const handleBookUploadClick = (courseId: string) => {
    setBookUploadCourseId(courseId);
    setStudyTab("upload");
    setBookUploadDialogOpen(true);
  };

  const uploadCourseName = bookUploadCourseId
    ? courses.find((c) => c.id === bookUploadCourseId)?.course_name
    : null;

  // Study Hub navigation — desktop rail + mobile pills share this definition
  const studyTabs: Array<{ id: StudyTab; label: string; icon: LucideIcon; badge?: number }> = [
    { id: "daily", label: t("threadList.tabDaily"), icon: CalendarCheckIcon },
    { id: "flashcards", label: t("threadList.tabFlashcards"), icon: LayersIcon, badge: dueCount },
    { id: "curriculum", label: t("threadList.tabCurriculum"), icon: BookOpenIcon },
    { id: "progress", label: t("threadList.tabProgress"), icon: BarChart3Icon },
    { id: "upload", label: t("threadList.tabUpload"), icon: UploadIcon },
  ];
  const dueBadge =
    dueCount > 0 ? (
      <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
        {dueCount > 99 ? "99+" : dueCount}
      </span>
    ) : null;

  const handleSelectThread = useCallback(
    (id: string) => {
      loadThread(id);
      onThreadSelected?.(); // Fix #15 — close mobile sheet
    },
    [loadThread, onThreadSelected]
  );

  return (
    <div data-testid="thread-list" className="aui-root aui-thread-list-root flex h-full min-h-0 flex-col gap-1.5">
      {/* Thread list — scrollable area, New Chat button moved to SidebarView */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 pb-2 ps-2 pe-0 pt-2">

          {/* Study Hub — global 1-click entry to all study tools */}
          <button
            type="button"
            onClick={openStudyHub}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent/50"
          >
            <GraduationCapIcon className="size-4 shrink-0 text-amber-500" />
            <span className="flex-1 text-start">{t("threadList.studyHub")}</span>
            {dueCount > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
                {dueCount > 99 ? "99+" : dueCount}
              </span>
            )}
          </button>

          {/* Course sections (expandable accordion) */}
          {(courses || []).map((course) => {
            const courseThreads = getThreadsByCourse(course.id);
            const isExpanded = expandedCourses.has(course.id);
            const isActive = activeCourse?.id === course.id;

            return (
              <section key={course.id} className="flex flex-col">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    toggleCourse(course.id);
                    if (!isActive) onActiveCourseChange(course);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleCourse(course.id);
                      if (!isActive) onActiveCourseChange(course);
                    }
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isExpanded ? (
                      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBookUploadClick(course.id);
                      }}
                      className="p-1 rounded-md hover:bg-accent/50 transition-colors"
                      aria-label={t("threadList.uploadBookFor", { course: course.course_name })}
                    >
                      <BookOpenIcon className={`size-4 shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`} />
                    </button>
                    {dueCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBookUploadCourseId(course.id);
                          setStudyTab("flashcards");
                          setBookUploadDialogOpen(true);
                        }}
                        className="relative p-1 rounded-md hover:bg-accent/50 transition-colors"
                        aria-label={t("threadList.dueFlashcards", { count: dueCount })}
                      >
                        <GraduationCapIcon className="size-4 shrink-0 text-amber-500" />
                        <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
                          {dueCount > 99 ? "99+" : dueCount}
                        </span>
                      </button>
                    )}
                    <span className="truncate font-medium">{course.course_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {course.credit_hours} cr
                    </span>
                    <span className="text-[11px] text-muted-foreground">{courseThreads.length}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="ml-2 mt-0.5 flex flex-col border-l border-border pl-2">
                    {!activeThreadId && activeCourse?.id === course.id && (
                      <ThreadListItem
                        thread={{
                          id: "new-chat-virtual",
                          title: "New Chat",
                          updated_at: new Date().toISOString(),
                          course_id: course.id,
                        }}
                        compact
                        onSelect={() => {}}
                      />
                    )}

                    {courseThreads.length === 0 && !(activeCourse?.id === course.id && !activeThreadId) ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">{t("threadList.noChats")}</div>
                    ) : (
                      courseThreads.map((thread) => (
                        <ThreadListItem
                          key={thread.id}
                          thread={thread}
                          compact
                          onSelect={handleSelectThread}
                        />
                      ))
                    )}
                    <button
                      type="button"
                      onClick={() => handleNewChat(course.id)}
                      className="state-layer flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
                    >
                      <PlusIcon className="size-3 transition-transform group-hover:rotate-90" />
                      {t("threadList.newThread")}
                    </button>
                  </div>
                )}
              </section>
            );
          })}

          {/* Uncategorized threads — flat list like Claude */}
          {(uncategorizedThreads.length > 0 || (!activeThreadId && !activeCourse)) && (
            <section>
              <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("threadList.recents")}
              </h3>
              <div className="flex flex-col gap-0.5">
                {!activeThreadId && !activeCourse && (
                  <ThreadListItem
                    thread={{
                      id: "new-chat-virtual",
                      title: "New Chat",
                      updated_at: new Date().toISOString(),
                      course_id: null,
                    }}
                    onSelect={handleSelectThread}
                  />
                )}
                {uncategorizedThreads.map((thread) => (
                  <ThreadListItem
                    key={thread.id}
                    thread={thread}
                    onSelect={handleSelectThread}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

      {/* Study Hub — full-height workspace: header + side rail (desktop) / pills (mobile) + panel */}
      <Dialog open={bookUploadDialogOpen} onOpenChange={setBookUploadDialogOpen}>
        <DialogContent
          className="flex h-[86vh] max-h-[780px] w-[calc(100%-2rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl border-[#EBE5DF] bg-white p-0 text-[#2C2825] sm:rounded-2xl"
          style={{ zIndex: 99999 }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-[#EBE5DF] px-5 py-4 pe-14 rtl:ps-14">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm shadow-amber-500/40">
              <GraduationCapIcon className="size-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-bold text-[#2C2825]">
                {t("threadList.studyHub")}
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-xs leading-relaxed text-[#7A736E]">
                {t("threadList.studyHubDescription")}
              </DialogDescription>
            </div>
          </div>

          {/* Mobile: horizontal pills */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-[#EBE5DF] bg-[#F9F6F0]/60 px-3 py-2 sm:hidden">
            {studyTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStudyTab(tab.id)}
                className={
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
                  (activeTab === tab.id
                    ? "bg-white text-[#2C2825] shadow-sm ring-1 ring-[#EBE5DF]"
                    : "text-[#7A736E] hover:text-[#2C2825]")
                }
              >
                <tab.icon className="size-3.5 shrink-0" />
                {tab.label}
                {tab.id === "flashcards" && dueBadge}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Desktop: side rail */}
            <nav className="hidden w-44 shrink-0 flex-col gap-1 border-e border-[#EBE5DF] bg-[#F9F6F0]/50 p-2.5 sm:flex">
              {studyTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStudyTab(tab.id)}
                  className={
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors " +
                    (activeTab === tab.id
                      ? "bg-white text-[#2C2825] shadow-sm ring-1 ring-[#EBE5DF]"
                      : "text-[#7A736E] hover:bg-white/70 hover:text-[#2C2825]")
                  }
                >
                  <tab.icon
                    className={
                      "size-4 shrink-0 " + (activeTab === tab.id ? "text-amber-500" : "text-[#7A736E]/60")
                    }
                  />
                  <span className="flex-1 text-start">{tab.label}</span>
                  {tab.id === "flashcards" && dueBadge}
                </button>
              ))}
            </nav>

            {/* Panel content — one tool at a time, full width */}
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div key={studyTab} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
                {activeTab === "upload" && (
                  <div className="space-y-3">
                    {uploadCourseName && (
                      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                        <BookOpenIcon className="size-4 shrink-0" />
                        {t("threadList.uploadBookFor", { course: uploadCourseName })}
                      </div>
                    )}
                    <TextbookUpload
                      courseId={bookUploadCourseId || undefined}
                      onUploadComplete={() => {
                        setBookUploadDialogOpen(false);
                        toast.success(t("textbook.uploadedToast"), { duration: 2500 });
                      }}
                    />
                  </div>
                )}
                {activeTab === "curriculum" && (
                  <CurriculumPanel
                    initialTab={studyTab === "quiz" ? "quiz" : "structure"}
                    contentClassName="max-h-none"
                  />
                )}
                {activeTab === "flashcards" && (
                  <FlashcardsStudy courseId={bookUploadCourseId || undefined} onReviewComplete={refreshDueCount} />
                )}
                {activeTab === "progress" && (
                  <StudyProgressPanel
                    courseId={bookUploadCourseId || undefined}
                    onTrainTopic={handleTrainTopic}
                  />
                )}
                {activeTab === "daily" && (
                  <DailyPlanPanel
                    onNavigateToFlashcards={() => setStudyTab("flashcards")}
                    onQuestionSent={() => setBookUploadDialogOpen(false)}
                    onTrainTopic={handleTrainTopic}
                  />
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ThreadListItem
// ─────────────────────────────────────────────────────────────────────────────

const ThreadListItem: FC<{
  thread: ChatThread;
  compact?: boolean;
  onSelect: (id: string) => void;
}> = ({ thread, compact, onSelect }) => {
  const { t } = useTranslation("study");
  const { activeThreadId, deleteThread, isLoadingMessages, prefetchThread, updateThreadTitle } = useChatHistory();
  const isActive = activeThreadId === thread.id || (activeThreadId === null && thread.id === "new-chat-virtual");

  const isNavigating = isActive && isLoadingMessages;
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(thread.title || "");

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = setTimeout(() => {
      prefetchThread(thread.id);
    }, 150);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleClick = () => {
    if (isActive || isDeletingThread || isRenaming) return;
    onSelect(thread.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(thread.title || "");
    setIsRenaming(true);
  };

  const handleRenameSubmit = async () => {
    const newTitle = renameValue.trim() || thread.title || "New Chat";
    setIsRenaming(false);
    if (newTitle !== thread.title) {
      try {
        await updateThreadTitle(thread.id, newTitle);
        toast.success(t("threadList.renamed"), { duration: 1500 });
      } catch {
        toast.error(t("threadList.renameFailed"), { duration: 2000 });
      }
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsRenaming(false);
      setRenameValue(thread.title || "");
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeletingThread(true);
    try {
      await deleteThread(thread.id);
      setShowDeleteDialog(false);
      toast.success(t("threadList.deleted"), { duration: 2500 });
    } catch {
      toast.error(t("threadList.deleteFailed"), { duration: 2500 });
      setIsDeletingThread(false);
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={thread.id !== "new-chat-virtual" ? handleRenameClick : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group relative flex items-center gap-2.5 rounded-lg text-foreground cursor-pointer select-none ps-1 pe-1 transition-colors duration-150 ease-in-out
          ${compact ? "h-7 text-xs" : "h-8 text-sm"}
          ${isDeletingThread || isNavigating ? "opacity-50 pointer-events-none" : ""}
          ${isActive ? "text-foreground font-medium bg-[#EBE5DF]" : "hover:bg-[#EBE5DF]/60"}
        `}
      >
        {/* Fix #9 — spinner while navigating */}
        {isNavigating && (
          <span className="size-3.5 shrink-0 rounded-full border-2 border-foreground/20 border-t-foreground/70 animate-spin pointer-events-none" />
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent border-b border-primary/50 outline-none text-sm text-foreground px-0 py-0"
            maxLength={120}
          />
        ) : (
          <>
            <span className="flex-1 truncate text-start pointer-events-none">
              {thread.title || "New Chat"}
            </span>
          </>
        )}

        {/* Three-dot menu — appears on hover or when active */}
        {thread.id !== "new-chat-virtual" && !isRenaming && (
          <div className={`shrink-0 transition-opacity duration-150 pointer-events-none ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className={`pointer-events-auto p-1.5 rounded-md text-foreground/40 hover:text-foreground hover:bg-[#DED2C7] transition-colors duration-150 ${isActive ? "bg-[#EBE5DF]" : "bg-transparent"}`}
                  aria-label={t("threadList.moreOptions")}
                >
                  <MoreVerticalIcon className="size-4 pointer-events-none" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="w-52 rounded-xl border-[#EBE5DF] bg-white p-1.5 shadow-lg">
                <DropdownMenuItem onClick={handleRenameClick} disabled={isDeletingThread} className="gap-3 rounded-lg px-3 py-2 text-sm text-[#2C2825] focus:bg-[#F9F6F0] focus:text-[#2C2825]">
                  <PencilIcon className="size-4 text-[#7A736E]" />
                  Rename
                  <span className="ml-auto text-xs text-[#7A736E]">R</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 mx-2 h-px bg-[#EBE5DF]" />
                <DropdownMenuItem onClick={handleDeleteClick} disabled={isDeletingThread} className="gap-3 rounded-lg px-3 py-2 text-sm text-red-600 focus:bg-red-50 focus:text-red-700">
                  <TrashIcon className="size-4" />
                  Delete
                  <span className="ml-auto text-xs text-[#7A736E]">D</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent
          className="bg-white border-[#EBE5DF] text-[#2C2825] sm:max-w-sm p-6 gap-6 rounded-2xl"
          style={{ zIndex: 99999 }}
        >
          <div className="space-y-3">
            <DialogTitle className="text-lg font-semibold text-[#2C2825]">
              {t("threadList.deleteChat")}
            </DialogTitle>
            <DialogDescription className="text-[#7A736E] text-sm leading-relaxed">
              {t("threadList.deleteConfirm", { title: thread.title || "" })}
            </DialogDescription>
          </div>

          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeletingThread}
              className="flex-1 h-9 bg-transparent text-[#7A736E] hover:bg-[#F9F6F0] transition-colors rounded-lg"
            >
              {t("threadList.cancel")}
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={isDeletingThread}
              className="flex-1 h-9 bg-[#dc2626] text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-50 rounded-lg"
            >
              {isDeletingThread ? t("threadList.deleting") : t("threadList.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
