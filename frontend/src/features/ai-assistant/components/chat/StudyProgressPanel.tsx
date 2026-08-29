import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "react-i18next";
import { useStudyProgress, type StudyProgress } from "@/hooks/useStudy";
import { BarChart3Icon, AlertTriangleIcon, CheckCircleIcon, DumbbellIcon } from "lucide-react";

interface StudyProgressPanelProps {
  courseId?: string;
  textbookId?: string;
  /** Opens the chat with a tutor prompt for the given topic. */
  onTrainTopic?: (topic: string) => void;
  className?: string;
}

export function StudyProgressPanel({
  courseId,
  textbookId,
  onTrainTopic,
  className,
}: StudyProgressPanelProps) {
  const { progress, isLoading, error } = useStudyProgress(courseId, textbookId, 20);
  const { t } = useTranslation("study");

  const weakTopics = useMemo(
    () => progress.filter((p) => p.mastery_level < 0.5),
    [progress]
  );
  const strongTopics = useMemo(
    () => progress.filter((p) => p.mastery_level >= 0.8),
    [progress]
  );

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center p-6", className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <BarChart3Icon className="h-5 w-5 animate-pulse" />
          <span className="text-xs">{t("progress.loading")}</span>
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

  if (progress.length === 0) {
    return (
      <div className={cn("flex items-center justify-center p-6", className)}>
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <BarChart3Icon className="h-6 w-6" />
          <span className="text-sm">{t("progress.noProgress")}</span>
          <span className="text-xs text-muted-foreground/70">
            {t("progress.noProgressHint")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 p-4", className)}>
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<BarChart3Icon className="h-4 w-4 text-blue-500" />}
          label={t("progress.totalTopics")}
          value={progress.length}
        />
        <StatCard
          icon={<AlertTriangleIcon className="h-4 w-4 text-amber-500" />}
          label={t("progress.weakTopics")}
          value={weakTopics.length}
          highlight={weakTopics.length > 0}
        />
        <StatCard
          icon={<CheckCircleIcon className="h-4 w-4 text-emerald-500" />}
          label={t("progress.strongTopics")}
          value={strongTopics.length}
        />
      </div>

      {weakTopics.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
            {t("progress.needsReview")}
          </h4>
          <div className="space-y-2">
            {weakTopics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                variant="weak"
                onTrain={onTrainTopic ? () => onTrainTopic(topic.topic) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {strongTopics.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
            {t("progress.excelling")}
          </h4>
          <div className="space-y-2">
            {strongTopics.map((topic) => (
              <TopicRow key={topic.id} topic={topic} variant="strong" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border p-3 text-center",
        highlight
          ? "border-amber-500/40 bg-amber-50/10"
          : "border-border/40 bg-background"
      )}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-lg font-bold">{value}</span>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function TopicRow({
  topic,
  variant,
  onTrain,
}: {
  topic: StudyProgress;
  variant: "weak" | "strong";
  onTrain?: () => void;
}) {
  const { t } = useTranslation("study");
  const total = topic.correct_count + topic.incorrect_count;
  const correctPct = total > 0 ? Math.round((topic.correct_count / total) * 100) : 0;
  const masteryPct = Math.round(topic.mastery_level * 100);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-background p-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">
          {topic.topic}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {t("progress.questionsCount", { count: total })} · {t("progress.correctPct", { pct: correctPct })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onTrain && (
          <button
            type="button"
            onClick={onTrain}
            className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-500/25 transition-colors"
          >
            <DumbbellIcon className="size-3" />
            {t("progress.trainTopic")}
          </button>
        )}
        <div className="w-16 h-1.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              variant === "weak" ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${masteryPct}%` }}
          />
        </div>
        <span className="text-[10px] font-medium text-muted-foreground w-8 text-right">
          {masteryPct}%
        </span>
      </div>
    </div>
  );
}