import { type FC, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { ThreadList } from "../../../ui/thread-list";
import { type AcademicCourse } from "../../../../../hooks/useCourses";
import { UserProfileCard, useUserProfile } from "./UserProfileCard";
import { NewChatButtonIcon, NewChatButtonFull } from "./NewChatButton";
import { getUserAvatarUrl } from "@/lib/cn";
import { LogIn, AlertCircle, SearchIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatHistory } from "../../../../../hooks/useChatHistory";
import { useGuestMode } from "@/context/GuestModeContext";

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 300;
const COLLAPSE_THRESHOLD = 150;

const SidebarCollapsedView: FC<{
  onToggle?: () => void;
  onNewChat?: () => void;
}> = ({ onToggle, onNewChat }) => {
  const profile = useUserProfile();

  return (
    <div
      className="flex h-full w-full flex-col items-center gap-3 pt-3 cursor-pointer transition-colors"
      onClick={() => onToggle?.()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className="state-layer shrink-0 inline-flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground group"
        aria-label="Expand sidebar"
      >
        <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <polyline points="14 9 18 12 14 15" className="transition-transform duration-300 ease-in-out group-hover:scale-x-[-1]" style={{ transformOrigin: 'center' }} />
        </svg>
      </button>

      <NewChatButtonIcon onClick={onNewChat} />

      <div className="mt-auto mb-4 flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {profile ? (
          <img
            src={profile.avatar}
            alt={profile.name}
            className="size-7 rounded-full object-cover ring-1 ring-[#EBE5DF] cursor-pointer"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = getUserAvatarUrl(null, profile.name, 28);
            }}
          />
        ) : (
          <div className="size-7 rounded-full bg-[#EBE5DF] ring-1 ring-[#EBE5DF] cursor-pointer" />
        )}
      </div>
    </div>
  );
};


export interface SidebarViewProps {
  collapsed?: boolean;
  onToggle?: () => void;
  courses: AcademicCourse[];
  activeCourse: AcademicCourse | null;
  onActiveCourseChange: (course: AcademicCourse | null) => void;
  isGuestMode?: boolean;
}

export const SidebarView: FC<SidebarViewProps> = ({
  collapsed,
  onToggle,
  courses,
  activeCourse,
  onActiveCourseChange,
  isGuestMode = false,
}) => {
  const navigate = useNavigate();
  const { loadThread, goToPreviousThread, goToNextThread, threadsError, retryFetchThreads } = useChatHistory();
  const { guestMessageCount, guestMessageLimit, limitReached, retryAfterSeconds } = useGuestMode();

  const remaining = Math.max(0, guestMessageLimit - guestMessageCount);
  const isLow = remaining <= 1 && remaining > 0;

  // Listen for keyboard shortcut events for thread navigation
  useEffect(() => {
    const handlePreviousThread = () => goToPreviousThread();
    const handleNextThread = () => goToNextThread();

    window.addEventListener("sigma:navigate-previous-thread", handlePreviousThread);
    window.addEventListener("sigma:navigate-next-thread", handleNextThread);

    return () => {
      window.removeEventListener("sigma:navigate-previous-thread", handlePreviousThread);
      window.removeEventListener("sigma:navigate-next-thread", handleNextThread);
    };
  }, [goToPreviousThread, goToNextThread]);

  // ── Resizable sidebar state ──────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringHandle, setIsHoveringHandle] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setSidebarWidth((prev) => {
        if (prev < COLLAPSE_THRESHOLD) {
          onToggle?.();
          return DEFAULT_WIDTH;
        }
        return prev;
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, onToggle]);

  // Reset width when expanding from collapsed
  useEffect(() => {
    if (!collapsed) {
      setSidebarWidth(DEFAULT_WIDTH);
    }
  }, [collapsed]);

  return (
    <aside
      data-testid="sidebar-view"
      className={cn(
        "relative flex h-full flex-col shrink-0 border-r border-[#EBE5DF] bg-[#F4EFEC]",
        !collapsed ? "opacity-100" : "w-12 opacity-100 overflow-visible",
      )}
      style={!collapsed ? { width: sidebarWidth } : undefined}
    >
      <span data-testid="sidebar-collapsed" className="hidden">{String(collapsed)}</span>
      {!collapsed ? (
        <div className="flex h-full min-w-0 flex-col">
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center justify-between ps-3 pe-2">
            <span className="text-xl font-semibold tracking-tight text-foreground select-none">Sigma</span>
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      const event = new CustomEvent('open-search');
                      window.dispatchEvent(event);
                    }}
                    className="state-layer shrink-0 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Search"
                  >
                    <SearchIcon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Search conversations</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggle}
                    data-testid="sidebar-toggle"
                    className="state-layer aui-sidebar-toggle shrink-0 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Collapse sidebar"
                  >
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <polyline points="18 15 14 12 18 9" className="transition-transform duration-300 ease-in-out group-hover:scale-x-[-1]" style={{ transformOrigin: 'center' }} />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* New Chat button — fixed, not scrollable */}
          <div className="shrink-0 px-2 pt-2 pb-1">
            <NewChatButtonFull onClick={() => {
              loadThread(null);
              onActiveCourseChange(null);
            }} />
          </div>

          {/* Scrollable thread list area */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-0 mr-0">
            {isGuestMode ? (
              <div className="px-2 pt-2 pb-1">
                <div className="flex flex-col items-center gap-3 rounded-lg border border-[#EBE5DF] bg-white p-3 text-center shadow-sm">
                  {limitReached ? (
                    <>
                      <div className="flex items-center gap-2 text-amber-400">
                        <AlertCircle className="size-4" />
                        <p className="text-xs font-medium">Free message limit reached</p>
                      </div>
                      {retryAfterSeconds !== null && retryAfterSeconds > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          Try again in {Math.ceil(retryAfterSeconds / 60)} minutes
                        </p>
                      )}
                      <button
                        onClick={() => navigate("/login", { state: { from: `` } })}
                        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <LogIn className="size-4" />
                        Sign in for unlimited
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-muted-foreground">
                          {guestMessageCount} of {guestMessageLimit} free messages used
                        </p>
                        <div className="w-full h-1.5 bg-[#EBE5DF] rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              isLow ? "bg-amber-400" : "bg-primary"
                            )}
                            style={{ width: `${(guestMessageCount / guestMessageLimit) * 100}%` }}
                          />
                        </div>
                        {isLow && (
                          <p className="text-[10px] text-amber-400">
                            {remaining} {remaining === 1 ? "message" : "messages"} remaining
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => navigate("/login", { state: { from: `` } })}
                        className="flex items-center gap-2 rounded-lg border border-[#EBE5DF] bg-white px-3 py-2 text-sm text-foreground hover:bg-[#F9F6F0] transition-colors"
                      >
                        <LogIn className="size-4" />
                        Sign in
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : threadsError ? (
              <div className="px-2 pt-2 pb-1">
                <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-center">
                  <p className="text-xs text-destructive">{threadsError}</p>
                  <button
                    onClick={() => retryFetchThreads()}
                    className="text-xs font-medium text-destructive underline underline-offset-2 hover:text-destructive/80"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <ThreadList courses={courses} activeCourse={activeCourse} onActiveCourseChange={onActiveCourseChange} />
            )}
          </div>

          {/* Footer — divider spans full width to touch border-r */}
          <div className="w-full shrink-0">
            {!isGuestMode && <UserProfileCard />}
          </div>
        </div>
      ) : (
        <SidebarCollapsedView
          onToggle={onToggle}
          onNewChat={() => {
            loadThread(null);
            onActiveCourseChange(null);
          }}
        />
      )}

      {/* ── Drag handle ─────────────────────────────────────────────── */}
      {!collapsed && (
        <div
          className={cn(
            "absolute top-0 right-0 z-50 h-full w-1 cursor-col-resize transition-colors",
            isDragging
              ? "bg-[#BE1E2D]/40"
              : isHoveringHandle
                ? "bg-[#BE1E2D]/30"
                : "hover:bg-[#BE1E2D]/20",
          )}
          onMouseDown={handleDragStart}
          onMouseEnter={() => setIsHoveringHandle(true)}
          onMouseLeave={() => setIsHoveringHandle(false)}
        >
          {/* Tooltip on hover */}
          {isHoveringHandle && !isDragging && (
            <div className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#1a1a1a] px-3 py-2 text-xs text-white shadow-lg">
              <div className="font-medium">Drag to resize</div>
              <div className="mt-0.5 text-white/60">Click to collapse <kbd className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[10px]">Ctrl+B</kbd></div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
