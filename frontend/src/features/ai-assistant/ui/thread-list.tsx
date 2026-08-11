import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquareIcon,
  PlusIcon,
  TrashIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
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

  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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

  // ── Search filter ─────────────────────────────────────────────────────────
  const lowerQuery = searchQuery.toLowerCase().trim();
  const filteredThreads = lowerQuery
    ? threads.filter((t) => (t.title || "New Chat").toLowerCase().includes(lowerQuery))
    : null; // null = no filter active

  const uncategorizedThreads = filteredThreads
    ? filteredThreads.filter((t) => !t.course_id)
    : getThreadsByCourse(null);

  const handleSelectThread = useCallback(
    (id: string) => {
      loadThread(id);
      onThreadSelected?.(); // Fix #15 — close mobile sheet
    },
    [loadThread, onThreadSelected]
  );

  return (
    <div data-testid="thread-list" className="aui-root aui-thread-list-root flex h-full min-h-0 flex-col gap-1.5 overflow-hidden">
      {/* New Chat button */}
      <Button
        variant="outline"
        onClick={() => handleNewChat(undefined)}
        className="aui-thread-list-new h-11 justify-start gap-2 rounded-2xl border-border bg-card px-4 text-sm text-foreground shadow-none hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <PlusIcon className="size-4" />
        New General Chat
      </Button>

      {/* Fix #11 — Search bar */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search chats…"
          className="w-full rounded-xl border border-border bg-card py-1.5 pl-8 pr-7 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-ring focus:bg-accent transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {/* Thread list */}
      <div className="mt-1 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2 pb-2">

          {/* Search results — flat list with time grouping */}
          {filteredThreads ? (
            filteredThreads.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No chats match &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredThreads.map((thread) => (
                  <ThreadListItem
                    key={thread.id}
                    thread={thread}
                    onSelect={handleSelectThread}
                  />
                ))}
              </div>
            )
          ) : (
            <>
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
                        <BookOpenIcon className={`size-4 shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`} />
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
                          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <PlusIcon className="size-3" />
                          New thread
                        </button>
                      </div>
                    )}
                  </section>
                );
              })}

              {/* Fix #10 — Uncategorized threads with time grouping */}
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
            </>
          )}

          {/* Loading skeleton */}
          {isLoadingThreads && <ThreadListSkeleton />}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

const ThreadListSkeleton: FC = () => (
  <div className="flex flex-col gap-1">
    {Array.from({ length: 3 }, (_, i) => (
      <div key={i} className="flex h-9 items-center px-3">
        <Skeleton className="h-4 w-full rounded-md" />
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// ThreadListItem
// ─────────────────────────────────────────────────────────────────────────────

const ThreadListItem: FC<{
  thread: ChatThread;
  compact?: boolean;
  onSelect: (id: string) => void;
}> = ({ thread, compact, onSelect }) => {
  const { activeThreadId, deleteThread, isLoadingMessages, prefetchThread } = useChatHistory();
  const isActive = activeThreadId === thread.id || (activeThreadId === null && thread.id === "new-chat-virtual");

  const isNavigating = isActive && isLoadingMessages;
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
    if (isActive || isDeletingThread) return;
    onSelect(thread.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group relative flex items-center gap-2 rounded-xl text-foreground/80 transition-all duration-150 cursor-pointer hover:bg-accent hover:text-foreground px-3
          ${isActive ? "bg-accent text-foreground" : ""}
          ${compact ? "h-8 text-xs" : "h-9"}
          ${isDeletingThread || isNavigating ? "opacity-50 pointer-events-none" : ""}`}
      >
        {/* Fix #9 — spinner while navigating, icon otherwise */}
        {isNavigating ? (
          <span className="size-3.5 shrink-0 rounded-full border-2 border-foreground/20 border-t-foreground/70 animate-spin" />
        ) : (
          <MessageSquareIcon className={`opacity-70 shrink-0 ${compact ? "size-3" : "size-3.5"}`} />
        )}

        <span className="flex-1 truncate text-start text-sm">
          {thread.title || "New Chat"}
        </span>

        {/* Delete button — shown on hover */}
        {thread.id !== "new-chat-virtual" && (
          <button
            onClick={handleDeleteClick}
            disabled={isDeletingThread}
            className="shrink-0 md:opacity-0 md:group-hover:opacity-100 opacity-70 transition-opacity duration-200 p-1 rounded-md hover:bg-red-500/20 text-foreground/50 hover:text-red-400 disabled:opacity-50"
            title="Delete chat"
          >
            <TrashIcon className="size-4" />
          </button>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent
          className="bg-[#1a1a1a] border-none text-white sm:max-w-sm p-6 gap-6 rounded-2xl"
          style={{ zIndex: 99999 }}
        >
          <div className="space-y-3">
            <DialogTitle className="text-lg font-semibold text-white">
              Delete chat
            </DialogTitle>
            <DialogDescription className="text-white/60 text-sm leading-relaxed">
              Are you sure you want to delete &ldquo;{thread.title || "this chat"}&rdquo;? This cannot be undone.
            </DialogDescription>
          </div>

          <DialogFooter className="flex-row gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeletingThread}
              className="flex-1 h-9 bg-transparent text-white hover:bg-white/10 transition-colors rounded-lg"
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
