
import { useState, type FC } from "react";
import { MenuIcon, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { getUserAvatarUrl } from "@/lib/cn";
import { signOut } from "@/lib/supabaseClient";
import { ThreadList } from "../../../ui/thread-list";
import { type AcademicCourse } from "../../../../../hooks/useCourses";
import { useUserProfile } from "./UserProfileCard";

export interface MobileSidebarViewProps {
  courses: AcademicCourse[];
  activeCourse: AcademicCourse | null;
  onActiveCourseChange: (course: AcademicCourse | null) => void;
}

export const MobileSidebarView: FC<MobileSidebarViewProps> = ({
  courses,
  activeCourse,
  onActiveCourseChange,
}) => {
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
          <ThreadList
            courses={courses}
            activeCourse={activeCourse}
            onActiveCourseChange={onActiveCourseChange}
            onThreadSelected={() => setOpen(false)}
          />
        </div>
        <div className="shrink-0 px-3 pb-3">
          {/* Reuse profile already fetched above — no extra DB call */}
          {profile && (
            <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-1 pt-3">
              <img
                src={profile.avatar}
                alt={profile.name}
                className="size-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = getUserAvatarUrl(null, profile.name, 32);
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/90">{profile.name}</p>
                <p className="truncate text-xs text-neutral-500">{profile.email}</p>
              </div>
              <button
                onClick={async () => { await signOut(); window.location.href = "/"; }}
                className="shrink-0 rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
                title="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
