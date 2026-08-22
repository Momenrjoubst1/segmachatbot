import { useState, useCallback } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import {
  useDueFlashcards,
  reviewFlashcardApi,
  type Flashcard,
} from "@/hooks/useStudy";
import {
  RotateCcwIcon,
  XIcon,
  BookOpenIcon,
  GraduationCapIcon,
} from "lucide-react";

interface FlashcardsStudyProps {
  courseId?: string;
  onComplete?: () => void;
  onReviewComplete?: () => void;
  className?: string;
}

type ReviewQuality = "again" | "hard" | "good" | "easy";

export function FlashcardsStudy({
  courseId,
  onComplete,
  onReviewComplete,
  className,
}: FlashcardsStudyProps) {
  const { cards: dueCards, isLoading, error, refetch } = useDueFlashcards(courseId, 30);
  const { t } = useTranslation("study");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentCard: Flashcard | undefined = dueCards[currentIndex];
  const remaining = dueCards.length - reviewedIds.size;
  const isComplete = remaining === 0;

  const handleReview = useCallback(
    async (quality: ReviewQuality) => {
      if (!currentCard || isSubmitting) return;
      setIsSubmitting(true);
      try {
        await reviewFlashcardApi(currentCard.id, quality);
        setReviewedIds((prev) => new Set(prev).add(currentCard.id));
        setIsFlipped(false);
        onReviewComplete?.();
        // Move to next card
        if (currentIndex < dueCards.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        } else {
          // All cards reviewed
          onComplete?.();
        }
      } catch (err) {
        console.error("Review failed:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentCard, currentIndex, dueCards.length, isSubmitting, onComplete]
  );

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setReviewedIds(new Set());
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RotateCcwIcon className="h-6 w-6 animate-spin" />
          <span className="text-sm">{t("flashcards.loading")}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <div className="flex flex-col items-center gap-3 text-destructive">
          <XIcon className="h-6 w-6" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            {t("flashcards.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (dueCards.length === 0) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <BookOpenIcon className="h-8 w-8" />
          <span className="text-sm">{t("flashcards.noCards")}</span>
          <span className="text-xs text-muted-foreground/70">
            {t("flashcards.noCardsHint")}
          </span>
        </div>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <div className="flex flex-col items-center gap-3 text-emerald-600">
          <GraduationCapIcon className="h-8 w-8" />
          <span className="text-sm font-medium">{t("flashcards.complete")}</span>
          <span className="text-xs text-muted-foreground">
            {t("flashcards.reviewedCount", { reviewed: reviewedIds.size, total: dueCards.length })}
          </span>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcwIcon className="h-4 w-4 ml-1" />
            {t("flashcards.reviewAgain")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-4 p-4", className)}>
      {/* Progress indicator */}
      <div className="w-full flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {currentIndex + 1} / {dueCards.length}
        </span>
        <span>{remaining} {t("flashcards.remaining")}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${((currentIndex + 1) / dueCards.length) * 100}%` }}
        />
      </div>

      {/* Flashcard */}
      <button
        onClick={() => setIsFlipped(!isFlipped)}
        className={cn(
          "w-full min-h-[200px] rounded-2xl border border-border/60 bg-background p-6 text-center shadow-sm",
          "hover:shadow-md transition-all duration-200 cursor-pointer",
          "flex flex-col items-center justify-center gap-4",
          isFlipped && "border-emerald-500/40 bg-emerald-50/10"
        )}
        aria-label={isFlipped ? t("flashcards.clickToShowQuestion") : t("flashcards.clickToShowAnswer")}
      >
        {!isFlipped ? (
          <>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("flashcards.question")}
            </span>
            <span className="text-lg font-medium text-foreground leading-relaxed">
              {currentCard.question}
            </span>
            <span className="text-xs text-muted-foreground/60 italic">
              {t("flashcards.clickToReveal")}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
              {t("flashcards.answer")}
            </span>
            <span className="text-lg font-medium text-emerald-700 leading-relaxed">
              {currentCard.answer}
            </span>
          </>
        )}
      </button>

      {/* Review buttons (shown only when flipped) */}
      {isFlipped && (
        <div className="w-full flex items-center justify-center gap-2 animate-in slide-in-from-bottom-2 duration-150">
          <ReviewButton
            quality="again"
            label={t("flashcards.again")}
            sublabel={t("flashcards.againInterval")}
            color="destructive"
            onClick={handleReview}
            disabled={isSubmitting}
          />
          <ReviewButton
            quality="hard"
            label={t("flashcards.hard")}
            sublabel={t("flashcards.hardInterval")}
            color="amber"
            onClick={handleReview}
            disabled={isSubmitting}
          />
          <ReviewButton
            quality="good"
            label={t("flashcards.good")}
            sublabel={t("flashcards.goodInterval")}
            color="emerald"
            onClick={handleReview}
            disabled={isSubmitting}
          />
          <ReviewButton
            quality="easy"
            label={t("flashcards.easy")}
            sublabel={t("flashcards.easyInterval")}
            color="blue"
            onClick={handleReview}
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Card metadata */}
      {currentCard.topic && (
        <div className="w-full flex items-center gap-2 text-xs text-muted-foreground/70">
          <span>{t("flashcards.topic")}: {currentCard.topic}</span>
          {currentCard.section_path && (
            <>
              <span>·</span>
              <span>{currentCard.section_path}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Review Button ────────────────────────────────────────────────────────────
interface ReviewButtonProps {
  quality: ReviewQuality;
  label: string;
  sublabel: string;
  color: "destructive" | "amber" | "emerald" | "blue";
  onClick: (quality: ReviewQuality) => void;
  disabled?: boolean;
}

function ReviewButton({
  quality,
  label,
  sublabel,
  color,
  onClick,
  disabled,
}: ReviewButtonProps) {
  const colorMap = {
    destructive: "border-rose-500/40 hover:bg-rose-500/10 text-rose-600",
    amber: "border-amber-500/40 hover:bg-amber-500/10 text-amber-600",
    emerald: "border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-600",
    blue: "border-blue-500/40 hover:bg-blue-500/10 text-blue-600",
  };

  return (
    <button
      onClick={() => onClick(quality)}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        colorMap[color]
      )}
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{sublabel}</span>
    </button>
  );
}