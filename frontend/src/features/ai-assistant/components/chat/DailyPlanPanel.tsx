import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  useDailyPlan,
  useStudyProfile,
  useGamification,
  type StudyProfilePatch,
  type StudyProfile,
} from "@/hooks/useStudy";
import { unstable_useComposerInput } from "../../shims/assistant-ui-compat-shim";
import {
  BookOpenIcon,
  GraduationCapIcon,
  AlertTriangleIcon,
  LightbulbIcon,
  DumbbellIcon,
  Loader2,
  UserCogIcon,
  CalendarClockIcon,
  FlameIcon,
  ZapIcon,
  TargetIcon,
} from "lucide-react";

interface DailyPlanPanelProps {
  onNavigateToFlashcards: () => void;
  onQuestionSent?: () => void;
  /** Opens the chat with a tutor prompt for the given topic. */
  onTrainTopic?: (topic: string) => void;
  className?: string;
}

/** Streak + daily goal + XP strip. */
function StreakStrip({ dailyGoal }: { dailyGoal: number | null }) {
  const { t } = useTranslation("study");
  const { summary } = useGamification();
  if (!summary) return null;

  const goal = dailyGoal ?? 10;
  const goalPct = Math.min(100, Math.round((summary.reviewedToday / goal) * 100));

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background px-3 py-2">
      <span
        className={cn(
          "flex items-center gap-1 text-xs font-bold",
          summary.streak > 0 ? "text-orange-600" : "text-muted-foreground"
        )}
        title={t("gamification.streakTitle")}
      >
        <FlameIcon className="size-3.5" />
        {summary.streak}
      </span>
      <div className="flex-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <TargetIcon className="size-3" />
            {t("gamification.goalToday", { done: summary.reviewedToday, goal })}
          </span>
          <span className="flex items-center gap-0.5 font-medium text-amber-600">
            <ZapIcon className="size-3" />
            {t("gamification.xp", { count: summary.xp })}
          </span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              goalPct >= 100 ? "bg-emerald-500" : "bg-amber-500"
            )}
            style={{ width: `${goalPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact study-profile form — grade, major, exam date, daily goal. */
function ProfileCard({
  profile,
  isLoading,
  isSaving,
  saveProfile,
  onExamDateSet,
}: {
  profile: StudyProfile | null;
  isLoading: boolean;
  isSaving: boolean;
  saveProfile: (patch: StudyProfilePatch) => Promise<boolean>;
  onExamDateSet: boolean;
}) {
  const { t } = useTranslation("study");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<StudyProfilePatch>({});

  const countdown = (() => {
    if (!profile?.exam_date) return null;
    const days = Math.round(
      (new Date(`${profile.exam_date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000
    );
    return Number.isNaN(days) ? null : days;
  })();

  const handleSave = async () => {
    try {
      await saveProfile(form);
      setForm({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* inline error ignored — button state shows result */
    }
  };

  if (isLoading) return null;

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <UserCogIcon className="size-3.5" />
          {profile ? t("daily.profileEdit") : t("daily.profileSetup")}
        </button>
        {profile?.exam_date && countdown !== null && (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              onExamDateSet && countdown <= 7
                ? "bg-red-500/15 text-red-700"
                : "bg-blue-500/10 text-blue-700"
            )}
          >
            <CalendarClockIcon className="size-3" />
            {countdown !== null && countdown >= 0
              ? t("daily.examCountdown", { days: countdown })
              : profile.exam_date}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <UserCogIcon className="size-3.5" />
          {t("daily.profileTitle")}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          {t("daily.profileClose")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          dir="auto"
          value={form.gradeLevel ?? profile?.grade_level ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))}
          placeholder={t("daily.gradeLevel")}
          className="rounded-md border border-border/60 bg-card px-2 py-1.5 text-xs outline-none focus:border-primary/50"
        />
        <input
          dir="auto"
          value={form.major ?? profile?.major ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, major: e.target.value }))}
          placeholder={t("daily.major")}
          className="rounded-md border border-border/60 bg-card px-2 py-1.5 text-xs outline-none focus:border-primary/50"
        />
        <input
          type="date"
          value={form.examDate ?? profile?.exam_date ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, examDate: e.target.value || null }))}
          className="rounded-md border border-border/60 bg-card px-2 py-1.5 text-xs outline-none focus:border-primary/50"
        />
        <input
          type="number"
          min={1}
          max={200}
          value={form.dailyGoal ?? profile?.daily_goal ?? ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, dailyGoal: e.target.value ? Number(e.target.value) : undefined }))
          }
          placeholder={t("daily.dailyGoal")}
          className="rounded-md border border-border/60 bg-card px-2 py-1.5 text-xs outline-none focus:border-primary/50"
        />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving || Object.keys(form).length === 0}
        className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saved ? t("daily.profileSaved") : isSaving ? t("daily.profileSaving") : t("daily.profileSave")}
      </button>
    </div>
  );
}

export function DailyPlanPanel({
  onNavigateToFlashcards,
  onQuestionSent,
  onTrainTopic,
  className,
}: DailyPlanPanelProps) {
  const { t } = useTranslation("study");
  const { plan, isLoading, error } = useDailyPlan();
  const { profile, isLoading: profileLoading, isSaving, saveProfile } = useStudyProfile();
  const composer = unstable_useComposerInput();

  const handleSendQuestion = (text: string) => {
    composer.setText(text);
    // Small delay to ensure text is set before send
    requestAnimationFrame(() => {
      composer.send();
      onQuestionSent?.();
    });
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center p-6", className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-pulse" />
          <span className="text-xs">{t("daily.loading")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex items-center justify-center p-6", className)}>
        <span className="text-xs text-destructive">{error}</span>
      </div>
    );
  }

  if (!plan) return null;

  const hasDueCards = plan.dueCardsCount > 0;
  const dueTopics = (plan.dueTopics || []).filter(
    (dt) => !(plan.weakTopics || []).some((w) => w.topic === dt.topic)
  );
  const hasDueTopics = dueTopics.length > 0;
  const hasWeakTopics = plan.weakTopics.length > 0;
  const hasQuestions = plan.suggestedQuestions.length > 0;
  const isEmpty = !hasDueCards && !hasDueTopics && !hasWeakTopics && !hasQuestions;

  if (isEmpty) {
    return (
      <div className={cn("space-y-3 p-1", className)}>
        {!profileLoading && <StreakStrip dailyGoal={profile?.daily_goal ?? null} />}
        <ProfileCard
          profile={profile}
          isLoading={profileLoading}
          isSaving={isSaving}
          saveProfile={saveProfile}
          onExamDateSet={!!plan.dueTopics}
        />
        <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground">
          <GraduationCapIcon className="h-6 w-6" />
          <span className="text-sm">{t("daily.empty")}</span>
          <span className="text-xs text-muted-foreground/70">
            {t("daily.emptyHint")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 p-1", className)}>
      {!profileLoading && <StreakStrip dailyGoal={profile?.daily_goal ?? null} />}
      <ProfileCard
        profile={profile}
        isLoading={profileLoading}
        isSaving={isSaving}
        saveProfile={saveProfile}
        onExamDateSet={!!plan.dueTopics}
      />

      {/* Due Cards Card */}
      {hasDueCards && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-50/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <BookOpenIcon className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {t("daily.dueCards", { count: plan.dueCardsCount })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("daily.dueCardsHint")}
                </div>
              </div>
            </div>
            <button
              onClick={onNavigateToFlashcards}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 transition-colors"
            >
              {t("daily.startReview")}
            </button>
          </div>
        </div>
      )}

      {/* Topics due for review (topic-level SRS) */}
      {hasDueTopics && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <CalendarClockIcon className="h-3.5 w-3.5 text-orange-500" />
            {t("daily.dueTopics")}
          </h4>
          <div className="space-y-2">
            {dueTopics.map((topic, i) => {
              const total = topic.correct_count + topic.incorrect_count;
              const pct = total > 0 ? Math.round(topic.mastery_level * 100) : 0;
              return (
                <div
                  key={`due-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-border/40 bg-background p-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">
                      {topic.topic}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {total} {t("daily.questionsCount")} · {pct}% {t("daily.mastery")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onTrainTopic && (
                      <button
                        type="button"
                        onClick={() => onTrainTopic(topic.topic)}
                        className="flex items-center gap-1 rounded-md bg-orange-500/15 px-2 py-1 text-[10px] font-medium text-orange-700 hover:bg-orange-500/25 transition-colors"
                      >
                        <DumbbellIcon className="size-3" />
                        {t("daily.trainTopic")}
                      </button>
                    )}
                    <div className="w-16 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-orange-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weak Topics */}
      {hasWeakTopics && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <AlertTriangleIcon className="h-3.5 w-3.5 text-amber-500" />
            {t("daily.weakTopics")}
          </h4>
          <div className="space-y-2">
            {plan.weakTopics.map((topic, i) => {
              const total = topic.correct_count + topic.incorrect_count;
              const pct = total > 0 ? Math.round(topic.mastery_level * 100) : 0;
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-border/40 bg-background p-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">
                      {topic.topic}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {total} {t("daily.questionsCount")} · {pct}% {t("daily.mastery")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onTrainTopic && (
                      <button
                        type="button"
                        onClick={() => onTrainTopic(topic.topic)}
                        className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-500/25 transition-colors"
                      >
                        <DumbbellIcon className="size-3" />
                        {t("daily.trainTopic")}
                      </button>
                    )}
                    <div className="w-16 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggested Questions */}
      {hasQuestions && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <LightbulbIcon className="h-3.5 w-3.5 text-blue-500" />
            {t("daily.suggestedQuestions")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {plan.suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSendQuestion(q.text)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-blue-50/50 hover:border-blue-300/40 transition-colors text-left"
              >
                {q.text.length > 60 ? q.text.slice(0, 60) + "..." : q.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
