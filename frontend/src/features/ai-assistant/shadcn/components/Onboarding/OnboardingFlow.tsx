
import { useState, type FC } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { type AcademicCourse } from "../../../../../hooks/useCourses";

export interface OnboardingFlowProps {
  onComplete: (draftCourses: { course_name: string; credit_hours: number }[]) => Promise<void>;
  onSkip?: () => void;
}

export const OnboardingFlow: FC<OnboardingFlowProps> = ({ onComplete, onSkip }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [totalHours, setTotalHours] = useState("");
  const [courseName, setCourseName] = useState("");
  const [creditHours, setCreditHours] = useState("3");
  const [draftCourses, setDraftCourses] = useState<AcademicCourse[]>([]);
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);

  const canContinue = totalHours.trim() !== "" && Number(totalHours) > 0;
  const canAddCourse = courseName.trim() !== "" && Number(creditHours) > 0;
  const canConfirm = draftCourses.length > 0;

  const handleAddCourse = () => {
    if (!canAddCourse) return;

    setDraftCourses((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        course_name: courseName.trim(),
        credit_hours: Number(creditHours),
      },
    ]);
    setCourseName("");
    setCreditHours("3");
  };

  const handleRemoveCourse = (courseId: string) => {
    setDraftCourses((prev) => prev.filter((course) => course.id !== courseId));
  };

  const handleConfirm = async () => {
    if (!canConfirm || isSavingOnboarding) return;
    setIsSavingOnboarding(true);
    try {
      await onComplete(draftCourses.map((c) => ({ course_name: c.course_name, credit_hours: c.credit_hours })));
    } finally {
      setIsSavingOnboarding(false);
    }
  };

  return (
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0f0f10]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-8">
        <div className="mb-6 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-500">
          <span>Setup Assistant</span>
          <span>Step {step} of 2</span>
        </div>

        {step === 1 ? (
          <div className="fade-in slide-in-from-bottom-1 animate-in space-y-6 duration-300">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-white">Welcome to your AI Assistant</h1>
              <p className="text-base leading-7 text-neutral-400">
                How many credit hours are you taking this semester?
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="total-hours" className="block text-sm font-medium text-neutral-300">
                Total Credit Hours
              </label>
              <input
                id="total-hours"
                type="number"
                min="1"
                inputMode="numeric"
                value={totalHours}
                onChange={(event) => setTotalHours(event.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && canContinue) setStep(2); }}
                className="h-14 w-full rounded-2xl border border-white/10 bg-background px-4 text-base text-white outline-none transition-all placeholder:text-neutral-500 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-700/60"
                placeholder="e.g. 15"
              />
            </div>

            <div className="flex items-center justify-between">
              {onSkip && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="text-sm text-neutral-500 underline-offset-2 hover:underline hover:text-neutral-300"
                >
                  I'm not a student — skip to chat
                </button>
              )}
              <Button
                type="button"
                onClick={() => canContinue && setStep(2)}
                disabled={!canContinue}
                className="h-11 rounded-2xl bg-white px-6 text-sm font-medium text-black transition-all hover:bg-neutral-200 disabled:bg-white/10 disabled:text-white/40 ml-auto"
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <div className="fade-in slide-in-from-bottom-1 animate-in space-y-6 duration-300">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight text-white">Enter your courses this semester</h2>
              <p className="text-sm leading-6 text-neutral-400">
                Add the courses you registered for so the assistant can personalize answers and study plans for you.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end">
              <div className="space-y-2 sm:order-1">
                <label htmlFor="course-name" className="block text-sm font-medium text-neutral-300">
                  Course Name
                </label>
                <input
                  id="course-name"
                  type="text"
                  value={courseName}
                  onChange={(event) => setCourseName(event.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (courseName.trim()) { handleAddCourse(); }
                      else if (canConfirm) { handleConfirm(); }
                    }
                  }}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-background px-4 text-sm text-white outline-none transition-all placeholder:text-neutral-500 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-700/60"
                  placeholder="e.g. Calculus I"
                />
              </div>

              <div className="space-y-2 sm:order-2">
                <label htmlFor="credit-hours" className="block text-sm font-medium text-neutral-300">
                  Hours
                </label>
                <input
                  id="credit-hours"
                  type="number"
                  min="1"
                  max="4"
                  inputMode="numeric"
                  value={creditHours}
                  onChange={(event) => setCreditHours(event.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCourse(); } }}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-background px-4 text-sm text-white outline-none transition-all placeholder:text-neutral-500 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-700/60"
                  placeholder="3"
                />
              </div>

              <Button
                type="button"
                onClick={handleAddCourse}
                disabled={!canAddCourse}
                className="h-12 rounded-2xl bg-white px-5 text-sm font-medium text-black transition-all hover:bg-neutral-200 disabled:bg-white/10 disabled:text-white/40 sm:order-3"
              >
                Add Course
              </Button>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/8 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Added Courses</span>
                <span className="text-xs text-neutral-500">{draftCourses.length} course{draftCourses.length !== 1 ? "s" : ""}</span>
              </div>

              {draftCourses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-neutral-500">
                  No courses added yet.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {draftCourses.map((course) => (
                    <div
                      key={course.id}
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-white/80 transition-colors duration-150 hover:bg-neutral-800/50 hover:text-white"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate">{course.course_name}</span>
                        <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                          {course.credit_hours} cr
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCourse(course.id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white/5 hover:text-white"
                        aria-label={`Remove ${course.course_name}`}
                      >
                        <XIcon className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep(1)}
                className="h-11 rounded-2xl px-4 text-neutral-400 hover:bg-white/5 hover:text-white"
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm || isSavingOnboarding}
                className="h-11 rounded-2xl bg-white px-6 text-sm font-medium text-black transition-all hover:bg-neutral-200 disabled:bg-white/10 disabled:text-white/40"
              >
                {isSavingOnboarding ? "Saving..." : "Confirm & Save"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
