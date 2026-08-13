
import { type FC } from "react";
import { cn } from "@/lib/cn";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import { ThreadList } from "../../../ui/thread-list";
import { type AcademicCourse } from "../../../../../hooks/useCourses";
import { UserProfileCard, useUserProfile } from "./UserProfileCard";
import { getUserAvatarUrl } from "@/lib/cn";
import { PlusIcon } from "lucide-react";
import { useChatHistory } from "../../../../../hooks/useChatHistory";

const SidebarCollapsedView: FC<{
  onToggle?: () => void;
  onNewChat?: () => void;
}> = ({ onToggle, onNewChat }) => {
  const profile = useUserProfile();

  return (
    <div
      className="flex h-full w-full flex-col items-center gap-3 pt-3 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onToggle}
    >
      <TooltipIconButton
        variant="ghost"
        size="icon"
        tooltip="Expand sidebar"
        side="right"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className="size-9 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg group"
      >
        <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <polyline points="14 9 18 12 14 15" className="transition-transform duration-300 ease-in-out group-hover:scale-x-[-1]" style={{ transformOrigin: 'center' }} />
        </svg>
      </TooltipIconButton>

      {/* New Chat shortcut — visible even when sidebar is collapsed */}
      <TooltipIconButton
        variant="ghost"
        size="icon"
        tooltip="New Chat"
        side="right"
        onClick={(e) => {
          e.stopPropagation();
          onNewChat?.();
        }}
        className="size-9 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
      >
        <PlusIcon className="size-4" />
      </TooltipIconButton>

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
}

export const SidebarView: FC<SidebarViewProps> = ({
  collapsed,
  onToggle,
  courses,
  activeCourse,
  onActiveCourseChange,
}) => {
  const { loadThread, threadsError, retryFetchThreads } = useChatHistory();

  return (
    <aside
      data-testid="sidebar-view"
      className={cn(
        "flex h-full flex-col transition-all duration-200 shrink-0 overflow-hidden",
        !collapsed ? "w-65 opacity-100" : "w-12 opacity-100",
      )}
    >
      <span data-testid="sidebar-collapsed" className="hidden">{String(collapsed)}</span>
      {!collapsed ? (
        <div className="flex h-full w-65 shrink-0 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-3 w-full">
            <span className="text-2xl font-semibold tracking-tight text-foreground select-none">Sigma</span>
            <TooltipIconButton
              variant="ghost"
              size="icon"
              tooltip="Collapse sidebar"
              onClick={onToggle}
              data-testid="sidebar-toggle"
              className="size-9 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg group"
            >
              <svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <polyline points="18 15 14 12 18 9" className="transition-transform duration-300 ease-in-out group-hover:scale-x-[-1]" style={{ transformOrigin: 'center' }} />
              </svg>
            </TooltipIconButton>
          </div>
          <div className="flex-1 overflow-y-auto p-3 pb-1">
            {threadsError ? (
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
            <UserProfileCard />
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
