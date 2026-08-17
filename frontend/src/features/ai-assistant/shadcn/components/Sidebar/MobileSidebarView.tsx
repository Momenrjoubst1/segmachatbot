import { useState, type FC } from "react";
import { MenuIcon, LogIn, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { getUserAvatarUrl } from "@/lib/cn";
import { signOut } from "@/lib/supabaseClient";
import { ThreadList } from "../../../ui/thread-list";
import { type AcademicCourse } from "../../../../../hooks/useCourses";
import { useUserProfile } from "./UserProfileCard";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export interface MobileSidebarViewProps {
  courses: AcademicCourse[];
  activeCourse: AcademicCourse | null;
  onActiveCourseChange: (course: AcademicCourse | null) => void;
  isGuestMode?: boolean;
}

export const MobileSidebarView: FC<MobileSidebarViewProps> = ({
  courses,
  activeCourse,
  onActiveCourseChange,
  isGuestMode = false,
}) => {
  const navigate = useNavigate();
  // Fix #15 — controlled open state so we can close it from ThreadList
  const [open, setOpen] = useState(false);
  // Fix #2 — single useUserProfile call shared between header avatar and profile card
  const profile = useUserProfile();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 md:hidden">
          <MenuIcon className="size-4" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-70 flex-col p-0"
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        <div className="flex-1 overflow-y-auto p-3 pb-1 mt-10">
          {isGuestMode ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center">
              <p className="text-sm font-medium">Continue with a free account</p>
              <p className="mt-1 text-xs text-muted-foreground">Sign in to access your courses and saved chats.</p>
              <button
                onClick={() => navigate("/login", { state: { from: `` } })}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <LogIn className="size-4" />
                Sign in
              </button>
            </div>
          ) : (
            <ThreadList
              courses={courses}
              activeCourse={activeCourse}
              onActiveCourseChange={onActiveCourseChange}
              onThreadSelected={() => setOpen(false)}
            />
          )}
        </div>
        {!isGuestMode && <div className="shrink-0 px-3 pb-3">
          {/* Reuse profile already fetched above — no extra DB call */}
          {profile && (
            <div className="flex items-center gap-2.5 border-t border-zinc-200 px-1 pt-3">
              <img
                src={profile.avatar}
                alt={profile.name}
                className="size-8 shrink-0 rounded-full object-cover ring-1 ring-zinc-200"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = getUserAvatarUrl(null, profile.name, 32);
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-700">{profile.name}</p>
                <p className="truncate text-xs text-neutral-500">{profile.email}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={async () => { await signOut(); window.location.href = "/"; }}
                    className="state-layer shrink-0 rounded-md p-1.5 text-neutral-400 hover:text-zinc-900 transition-colors"
                  >
                    <LogOut className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Sign out</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>}
      </SheetContent>
    </Sheet>
  );
};
