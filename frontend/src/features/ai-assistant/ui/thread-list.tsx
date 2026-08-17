import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MessageSquareIcon,
  PlusIcon,
  TrashIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
} from "lucide-react";
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
import { toast } from "sonner";
import { GooeySearchBar } from "@/components/ui/animated-search-bar";
import { NewChatButtonFull } from "../shadcn/components/Sidebar/NewChatButton";
import { TextbookUpload } from "../components/TextbookUpload";
import { CurriculumPanel } from "../components/CurriculumPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Time grouping helpers
// ─────────────────────────────────────────────────────────────────────────────

type TimeGroup = "Today" | "Yesterday" | "This Week" | "Older";

function getTimeGroup(dateStr: string): TimeGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1) return "Today";
  if (diffDays < 2) return "Yesterday";
  if (diffDays < 7) return "This Week";
  return "Older";
}

function groupThreadsByTime(threads: ChatThread[]): Record<TimeGroup, ChatThread[]> {
  const groups: Record<TimeGroup, ChatThread[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };
  for (const t of threads) {
    groups[getTimeGroup(t.updated_at)].push(t);
  }
  return groups;
}

const TIME_GROUP_ORDER: TimeGroup[] = ["Today", "Yesterday", "This Week", "Older"];

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
    isLoadingThreads,
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

  const handleBookUploadClick = (courseId: string) => {
    setBookUploadCourseId(courseId);
    setBookUploadDialogOpen(true);
  };

  const handleSelectThread = useCallback(
    (id: string) => {
      loadThread(id);
      onThreadSelected?.(); // Fix #15 — close mobile sheet
    },
    [loadThread, onThreadSelected]
  );

  return (
    <div data-testid="thread-list" className="aui-root aui-thread-list-root flex h-full min-h-0 flex-col gap-1.5">
      {/* New Chat button — full variant, rendered only while the sidebar is expanded */}
      <NewChatButtonFull onClick={() => handleNewChat(undefined)} />

      {/* Animated Search bar */}
      <div className="gooey-search-wrapper">
        <GooeySearchBar />
      </div>

      {/* Thread list */}
      <div className="mt-1 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2 pb-2">

          {/* Course sections (expandable accordion) */}
          {(courses || []).map((course) => {
            const courseThreads = getThreadsByCourse(course.id);
            const isExpanded = expandedCourses.has(course.id);
            const isActive = activeCourse?.id === course.id;

            return (
              <section key={course.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    toggleCourse(course.id);
                    if (!isActive) onActiveCourseChange(course);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
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
                      aria-label={`Upload textbook for ${course.course_name}`}
                    >
                      <BookOpenIcon className={`size-4 shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`} />
                    </button>
                    <span className="truncate font-medium">{course.course_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {course.credit_hours} cr
                    </span>
                    <span className="text-[11px] text-muted-foreground">{courseThreads.length}</span>
                  </div>
                </button>

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
                      <div className="px-3 py-2 text-xs text-muted-foreground">No chats yet</div>
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
                      New thread
                    </button>
                  </div>
                )}
              </section>
            );
          })}

          {/* Uncategorized threads with time grouping */}
          {(uncategorizedThreads.length > 0 || (!activeThreadId && !activeCourse)) && (() => {
            const groups = groupThreadsByTime(uncategorizedThreads);
            if (!activeThreadId && !activeCourse) {
              groups["Today"] = [
                {
                  id: "new-chat-virtual",
                  title: "New Chat",
                  updated_at: new Date().toISOString(),
                  course_id: null,
                },
                ...groups["Today"],
              ];
            }
            return (
              <section>
                {TIME_GROUP_ORDER.map((group) => {
                  const groupThreads = groups[group];
                  if (groupThreads.length === 0) return null;
                  return (
                    <div key={group} className="mb-2">
                      <h3 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group}
                      </h3>
                      <div className="flex flex-col gap-0.5">
                        {groupThreads.map((thread) => (
                          <ThreadListItem
                            key={thread.id}
                            thread={thread}
                            onSelect={handleSelectThread}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })()}
        </div>
      </div>

      {/* Book Upload Dialog */}
      <Dialog open={bookUploadDialogOpen} onOpenChange={setBookUploadDialogOpen}>
        <DialogContent
          className="bg-white border-zinc-200 text-zinc-900 sm:max-w-md p-6 gap-6 rounded-2xl"
          style={{ zIndex: 99999 }}
        >
          <div className="space-y-3">
            <DialogTitle className="text-lg font-semibold text-zinc-900">
              Upload Textbook
            </DialogTitle>
            <DialogDescription className="text-zinc-500 text-sm leading-relaxed">
              Upload a PDF textbook for this course to help with your studies.
            </DialogDescription>
          </div>

          <div className="max-h-[60vh] overflow-y-auto space-y-4">
            <TextbookUpload
              courseId={bookUploadCourseId || undefined}
              onUploadComplete={() => {
                setBookUploadDialogOpen(false);
                toast.success("Textbook uploaded successfully!", { duration: 2500 });
              }}
            />
            <CurriculumPanel />
          </div>

          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setBookUploadDialogOpen(false)}
              className="flex-1 h-9 bg-transparent text-zinc-900 hover:bg-zinc-100 transition-colors rounded-lg"
            >
              Close
            </Button>
          </DialogFooter>
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
        toast.success("Renamed", { duration: 1500 });
      } catch {
        toast.error("Failed to rename", { duration: 2000 });
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
      toast.success("Chat deleted", { duration: 2500 });
    } catch {
      toast.error("Failed to delete", { duration: 2500 });
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
        className={`group state-layer relative flex items-center gap-2.5 rounded-xl text-foreground/70 transition-all duration-200 ease-out cursor-pointer select-none px-3
          ${compact ? "h-8 text-xs" : "h-9 text-sm"}
          ${isDeletingThread || isNavigating ? "opacity-50 pointer-events-none" : ""}
          ${isActive
            ? // ACTIVE state — Gemini-style: bolder bg, white text, left accent bar
              "bg-accent/80 text-foreground font-medium shadow-sm"
            : // HOVER state — state-layer handles background, text goes full opacity
              "hover:text-foreground active:scale-[0.98] active:bg-accent/70"
          }
        `}
      >
        {/* Left accent bar for active item (Gemini-style indicator) */}
        <span
          className={`absolute start-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary transition-all duration-200 ${
            isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"
          }`}
          aria-hidden
        />

        {/* Fix #9 — spinner while navigating, icon otherwise */}
        {isNavigating ? (
          <span className="size-3.5 shrink-0 rounded-full border-2 border-foreground/20 border-t-foreground/70 animate-spin" />
        ) : (
          <MessageSquareIcon
            className={`shrink-0 transition-all duration-200 ${
              compact ? "size-3" : "size-3.5"
            } ${isActive ? "opacity-100" : "opacity-60 group-hover:opacity-90 group-hover:scale-110"}`}
          />
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
          <span className="flex-1 truncate text-start">
            {thread.title || "New Chat"}
          </span>
        )}

        {/* Action buttons — shown on hover, smooth fade-in like Gemini */}
        {thread.id !== "new-chat-virtual" && !isRenaming && (
          <div className="flex items-center gap-0.5 shrink-0
            opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0
            transition-all duration-200 ease-out">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleRenameClick}
                  disabled={isDeletingThread}
                  className="state-layer p-1 rounded-md text-foreground/40 hover:text-foreground active:scale-90 transition-all duration-150"
                  aria-label="Rename chat"
                >
                  <PencilIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Rename chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleDeleteClick}
                  disabled={isDeletingThread}
                  className="state-layer p-1 rounded-md text-foreground/40 hover:text-red-400 active:scale-90 transition-all duration-150"
                  aria-label="Delete chat"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Delete chat</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent
          className="bg-white border-zinc-200 text-zinc-900 sm:max-w-sm p-6 gap-6 rounded-2xl"
          style={{ zIndex: 99999 }}
        >
          <div className="space-y-3">
            <DialogTitle className="text-lg font-semibold text-zinc-900">
              Delete chat
            </DialogTitle>
            <DialogDescription className="text-zinc-500 text-sm leading-relaxed">
              Are you sure you want to delete &ldquo;{thread.title || "this chat"}&rdquo;? This cannot be undone.
            </DialogDescription>
          </div>

          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeletingThread}
              className="flex-1 h-9 bg-transparent text-zinc-600 hover:bg-zinc-100 transition-colors rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={isDeletingThread}
              className="flex-1 h-9 bg-[#dc2626] text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-50 rounded-lg"
            >
              {isDeletingThread ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
