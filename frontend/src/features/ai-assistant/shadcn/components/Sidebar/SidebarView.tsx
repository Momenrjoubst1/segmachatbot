import { type FC, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThreadList } from "../../../ui/thread-list";
import { type AcademicCourse } from "../../../../../hooks/useCourses";
import { UserProfileCard, useUserProfile } from "./UserProfileCard";
import { NewChatButtonIcon } from "./NewChatButton";
import { getUserAvatarUrl } from "@/lib/cn";
import { LogIn, AlertCircle, SearchIcon, MessageSquareIcon } from "lucide-react";
import { useChatHistory } from "../../../../../hooks/useChatHistory";
import { useGuestMode } from "@/context/GuestModeContext";

const SidebarCollapsedView: FC<{
  onToggle?: () => void;
  onNewChat?: () => void;
}> = ({ onToggle, onNewChat }) => {
  const profile = useUserProfile();
  const { threads, loadThread } = useChatHistory();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return threads.filter((t) =>
      t.title?.toLowerCase().includes(query)
    ).slice(0, 8);
  }, [threads, searchQuery]);

  const handleSelectThread = useCallback((id: string) => {
    loadThread(id);
    setSearchOpen(false);
    setSearchQuery("");
  }, [loadThread]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  return (
    <div
      className="flex h-full w-full flex-col items-center gap-3 pt-3 cursor-pointer transition-colors"
      onClick={() => {
        if (!searchOpen) onToggle?.();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>

      {/* Search shortcut — inline search bar */}
      <div className="relative flex items-center" onClick={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchOpen(!searchOpen);
                if (searchOpen) {
                  setSearchQuery("");
                }
              }}
              className={cn(
                "group state-layer shrink-0 inline-flex size-10 items-center justify-center rounded-full transition-all duration-300",
                searchOpen
                  ? "text-foreground bg-accent/50 scale-110 shadow-md"
                  : "text-muted-foreground hover:text-foreground hover:scale-110 hover:bg-accent/50 hover:shadow-md"
              )}
              aria-label="Search"
            >
              <SearchIcon className={cn(
                "size-4 transition-transform duration-300",
                searchOpen ? "rotate-[15deg] scale-110" : "group-hover:rotate-[15deg] group-hover:scale-110"
              )} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Search</TooltipContent>
        </Tooltip>

        {/* Inline search input + results */}
        <div
          className={cn(
            "absolute left-12 transition-all duration-300 ease-in-out",
            searchOpen ? "w-64 opacity-100" : "w-0 opacity-0 pointer-events-none"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search chats..."
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            className="w-full h-10 rounded-full border border-zinc-200 bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 transition-all duration-200 cursor-text"
          />

          {/* Search results dropdown */}
          {searchQuery && filteredThreads.length > 0 && (
            <div
              className="absolute top-12 left-0 w-full bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden z-50"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="max-h-64 overflow-y-auto">
                {filteredThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectThread(thread.id);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-100 transition-colors border-b border-zinc-100 last:border-b-0 cursor-text"
                  >
                    <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm text-foreground truncate">{thread.title || "New Chat"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No results */}
          {searchQuery && filteredThreads.length === 0 && (
            <div
              className="absolute top-12 left-0 w-full bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden z-50"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">No chats found</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Chat shortcut — icon-only variant, rendered only while the sidebar is collapsed */}
      <NewChatButtonIcon onClick={onNewChat} />

      <div className="mt-auto mb-4 flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {profile ? (
          <img
            src={profile.avatar}
            alt={profile.name}
            className="size-7 rounded-full object-cover ring-1 ring-white/20 cursor-pointer"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = getUserAvatarUrl(null, profile.name, 28);
            }}
          />
        ) : (
          <div className="size-7 rounded-full bg-white/10 ring-1 ring-white/20 cursor-pointer" />
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
  const { loadThread, threadsError, retryFetchThreads } = useChatHistory();
  const { guestMessageCount, guestMessageLimit, limitReached, retryAfterSeconds } = useGuestMode();

  const remaining = Math.max(0, guestMessageLimit - guestMessageCount);
  const isLow = remaining <= 1 && remaining > 0;

  return (
    <aside
      data-testid="sidebar-view"
      className={cn(
        "flex h-full flex-col transition-all duration-200 shrink-0",
        !collapsed ? "w-65 opacity-100" : "w-12 opacity-100 overflow-visible",
      )}
    >
      <span data-testid="sidebar-collapsed" className="hidden">{String(collapsed)}</span>
      {!collapsed ? (
        <div className="flex h-full w-65 shrink-0 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-3 w-full">
            <span className="text-2xl font-semibold tracking-tight text-foreground select-none">Sigma</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggle}
                  data-testid="sidebar-toggle"
                  className="aui-sidebar-toggle text-muted-foreground hover:text-foreground group"
                >
                  <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <polyline points="18 15 14 12 18 9" className="transition-transform duration-300 ease-in-out group-hover:scale-x-[-1]" style={{ transformOrigin: 'center' }} />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex-1 overflow-y-auto p-3 pb-1">
            {isGuestMode ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center">
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
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
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
                      className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-foreground hover:bg-white/[0.15] transition-colors"
                    >
                      <LogIn className="size-4" />
                      Sign in
                    </button>
                  </>
                )}
              </div>
            ) : threadsError ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center">
                <p className="text-xs text-destructive">{threadsError}</p>
                <button
                  onClick={() => retryFetchThreads()}
                  className="text-xs font-medium text-destructive underline underline-offset-2 hover:text-destructive/80"
                >
                  Retry
                </button>
              </div>
            ) : (
              <ThreadList courses={courses} activeCourse={activeCourse} onActiveCourseChange={onActiveCourseChange} />
            )}
          </div>
          <div className="px-3 pb-3 shrink-0">
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
    </aside>
  );
};
