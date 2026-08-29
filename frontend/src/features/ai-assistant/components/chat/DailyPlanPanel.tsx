import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useDailyPlan } from "@/hooks/useStudy";
import { unstable_useComposerInput } from "../../shims/assistant-ui-compat-shim";
import {
  BookOpenIcon,
  GraduationCapIcon,
  AlertTriangleIcon,
  LightbulbIcon,
  DumbbellIcon,
  Loader2,
} from "lucide-react";

interface DailyPlanPanelProps {
  onNavigateToFlashcards: () => void;
  onQuestionSent?: () => void;
  /** Opens the chat with a tutor prompt for the given topic. */
  onTrainTopic?: (topic: string) => void;
  className?: string;
}

export function DailyPlanPanel({
  onNavigateToFlashcards,
  onQuestionSent,
  onTrainTopic,
  className,
}: DailyPlanPanelProps) {
  const { t } = useTranslation("study");
  const { plan, isLoading, error } = useDailyPlan();
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
  const hasWeakTopics = plan.weakTopics.length > 0;
  const hasQuestions = plan.suggestedQuestions.length > 0;
  const isEmpty = !hasDueCards && !hasWeakTopics && !hasQuestions;

  if (isEmpty) {
    return (
      <div className={cn("flex items-center justify-center p-6", className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
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
