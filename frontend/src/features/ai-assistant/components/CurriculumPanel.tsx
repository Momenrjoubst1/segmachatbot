import { useState, useMemo, useEffect } from "react";
import {
  BookOpen,
  GraduationCap,
  Layers,
  ChevronRight,
  ChevronDown,
  FileText,
  ArrowRight,
  ArrowLeft,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useTextbooks } from "@/hooks/useTextbooks";
import {
  useCurriculum,
  type CurriculumSection,
} from "@/hooks/useCurriculum";
import {
  gradeAnswerApi,
  type GradeAnswerResponse,
  type GraderVerdict,
} from "@/hooks/useStudy";

type Tab = "structure" | "glossary" | "quiz";

function SectionNode({ section, depth }: { section: CurriculumSection; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = (section.children?.length ?? 0) > 0;

  const icon =
    section.level === "unit" ? (
      <Layers className="size-3.5 text-blue-600 shrink-0" />
    ) : section.level === "lesson" ? (
      <BookOpen className="size-3.5 text-emerald-600 shrink-0" />
    ) : (
      <FileText className="size-3 shrink-0 text-muted-foreground" />
    );

  return (
    <div>
      <button
        type="button"
        onClick={() => hasChildren && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/60",
          !hasChildren && "cursor-default"
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {hasChildren ? (
          open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3" />
        )}
        {icon}
        <span
          dir="auto"
          className={cn(
            "flex-1 truncate text-xs",
            section.level === "unit" && "font-semibold",
            section.level === "lesson" && "font-medium",
            section.level === "topic" && "text-muted-foreground"
          )}
        >
          {section.title}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {section.page_start === section.page_end
            ? `p.${section.page_start}`
            : `pp.${section.page_start}-${section.page_end}`}
        </span>
      </button>
      {open &&
        section.children?.map((child) => (
          <SectionNode key={child.id} section={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function QuizMode({
  questions,
  textbookId,
}: {
  questions: NonNullable<ReturnType<typeof useCurriculum>["questions"]>;
  textbookId: string | null;
}) {
  const { t } = useTranslation("study");
  const shuffled = useMemo(() => {
    const arr = [...questions];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [questions]);

  const [index, setIndex] = useState(0);
  const [showAnswerHint, setShowAnswerHint] = useState(false);
  const [showAnswerBox, setShowAnswerBox] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradeAnswerResponse | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);

  const q = shuffled[index];

  const resetAnswerState = () => {
    setAnswerText("");
    setShowAnswerBox(false);
    setResult(null);
    setGradeError(null);
    setShowAnswerHint(false);
  };

  const checkAnswer = async () => {
    if (!q || !answerText.trim() || grading) return;
    setGrading(true);
    setGradeError(null);
    try {
      const res = await gradeAnswerApi({
        question: q.text,
        studentAnswer: answerText.trim(),
        topic: q.section_path?.split(">").pop()?.trim() || q.section_path || "عام",
        textbookId: textbookId ?? undefined,
        sectionPath: q.section_path ?? undefined,
      });
      setResult(res);
    } catch {
      setGradeError(t("quiz.gradingError"));
    } finally {
      setGrading(false);
    }
  };

  if (shuffled.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
        {t("curriculum.noQuestions")}
      </p>
    );
  }

  const verdictStyles: Record<GraderVerdict, string> = {
    correct: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
    partial: "border-amber-500/40 bg-amber-500/10 text-amber-700",
    incorrect: "border-red-500/40 bg-red-500/10 text-red-700",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ListChecks className="size-3.5" />
          {t("curriculum.questionOf", { current: index + 1, total: shuffled.length })}
        </span>
        <span>{q.question_type === "unit_questions" ? t("curriculum.unitQuestions") : t("curriculum.lessonQuestions")}</span>
      </div>

      <div
        dir="auto"
        className="rounded-xl border border-border/60 bg-card p-4 text-sm leading-relaxed"
      >
        {q.number && <span className="font-semibold mr-1">{q.number}.</span>}
        {q.text}
      </div>

      {!showAnswerBox && !result && (
        <button
          type="button"
          onClick={() => setShowAnswerBox(true)}
          className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t("quiz.writeAnswer")}
        </button>
      )}

      {showAnswerBox && !result && (
        <div className="space-y-2">
          <textarea
            dir="auto"
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            placeholder={t("quiz.answerPlaceholder")}
            rows={3}
            className="w-full resize-none rounded-lg border border-border/60 bg-background p-2.5 text-xs leading-relaxed outline-none focus:border-primary/50"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={checkAnswer}
              disabled={grading || !answerText.trim()}
              className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {grading ? t("quiz.checking") : t("quiz.checkAnswer")}
            </button>
            <button
              type="button"
              onClick={() => setShowAnswerBox(false)}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("quiz.cancelAnswer")}
            </button>
          </div>
        </div>
      )}

      {gradeError && (
        <p className="text-xs text-destructive">{gradeError}</p>
      )}

      {result && (
        <div className={cn("space-y-2 rounded-xl border p-3", verdictStyles[result.verdict])}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold">
              {t(`quiz.verdict.${result.verdict}`)}
            </span>
            {result.recorded && result.masteryLevel !== null && (
              <span className="text-[10px] font-medium opacity-80">
                {t("quiz.masteryNow", { pct: Math.round(result.masteryLevel * 100) })}
              </span>
            )}
          </div>
          <p dir="auto" className="text-xs leading-relaxed opacity-90">
            {result.feedback}
          </p>
          {result.missedPoints.length > 0 && (
            <ul dir="auto" className="list-disc space-y-0.5 ps-4 text-[11px] opacity-80">
              {result.missedPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}
          {result.modelAnswer && (
            <details className="group">
              <summary className="cursor-pointer text-[11px] font-medium underline underline-offset-2">
                {t("quiz.modelAnswer")}
              </summary>
              <p dir="auto" className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed opacity-90">
                {result.modelAnswer}
              </p>
            </details>
          )}
        </div>
      )}

      {showAnswerHint && !result && (
        <p className="px-1 text-xs text-muted-foreground">
          {t("quiz.hint", { page: q.page_number ?? "?" })}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={index === 0}
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1));
            resetAnswerState();
          }}
          className="h-8"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 flex-1"
          onClick={() => setShowAnswerHint((v) => !v)}
        >
          {showAnswerHint ? t("quiz.hideHint") : t("quiz.hintButton")}
        </Button>
        <Button
          size="sm"
          disabled={index === shuffled.length - 1}
          onClick={() => {
            setIndex((i) => Math.min(shuffled.length - 1, i + 1));
            resetAnswerState();
          }}
          className="h-8"
        >
          {t("curriculum.next")} <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function CurriculumPanel({
  initialTab = "structure",
  contentClassName,
}: {
  initialTab?: Tab;
  /** Overrides the inner scroll cap (pass "max-h-none" when hosted in a large scrollable dialog). */
  contentClassName?: string;
}) {
  const { t } = useTranslation("study");
  const { textbooks, isLoading: booksLoading } = useTextbooks();
  const completed = textbooks.filter((tb) => tb.status === "completed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  const activeId = selectedId && completed.some((tb) => tb.id === selectedId)
    ? selectedId
    : completed[0]?.id ?? null;

  const { curriculum, questions, glossary, isLoading, fetchQuestions, fetchGlossary } =
    useCurriculum(activeId);

  // When opened directly on the quiz tab (e.g. via an AI study action),
  // the questions fetch is triggered by switchTab — trigger it here too.
  useEffect(() => {
    if (initialTab === "quiz") fetchQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const switchTab = (t: Tab) => {
    setTab(t);
    if (t === "quiz") fetchQuestions();
    if (t === "glossary") fetchGlossary();
  };

  if (booksLoading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/95 p-4 text-center text-xs text-muted-foreground">
        {t("curriculum.loadingBooks")}
      </div>
    );
  }

  if (completed.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card/95 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <GraduationCap className="size-4 text-primary" />
            {t("curriculum.studyMap")}
        </h3>
        {completed.length > 1 && (
          <select
            value={activeId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="max-w-[55%] truncate rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {completed.map((tb) => (
              <option key={tb.id} value={tb.id}>
                {tb.file_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-muted p-0.5 text-xs">
        {(
          [
            ["structure", t("curriculum.tabLessons")],
            ["glossary", t("curriculum.tabTerms")],
            ["quiz", t("curriculum.tabQuiz")],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 transition-colors",
              tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={cn("overflow-y-auto", contentClassName ?? "max-h-64")}>
        {isLoading && (
          <p className="py-6 text-center text-xs text-muted-foreground">{t("curriculum.loading")}</p>
        )}

        {!isLoading && tab === "structure" && (
          curriculum && curriculum.sections.length > 0 ? (
            <div className="space-y-0.5">
              {curriculum.sections.map((s) => (
                <SectionNode key={s.id} section={s} depth={0} />
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("curriculum.noStructure")}
            </p>
          )
        )}

        {!isLoading && tab === "glossary" && (
          glossary && glossary.length > 0 ? (
            <ul className="space-y-2">
              {glossary.map((g) => (
                <li key={g.id} className="rounded-lg border border-border/60 p-2.5">
                  <p dir="auto" className="text-xs font-semibold">{g.term}</p>
                  {g.definition && (
                    <p dir="auto" className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {g.definition}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {glossary ? t("curriculum.noGlossary") : t("curriculum.loadingTerms")}
            </p>
          )
        )}

        {!isLoading && tab === "quiz" && (
          questions ? (
            <QuizMode questions={questions} textbookId={activeId} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("curriculum.loadingQuestions")}</p>
          )
        )}
      </div>

      {curriculum && (
        <p className="text-[10px] text-muted-foreground">
          {t("curriculum.countsLine", {
            sections: curriculum.counts.sections,
            questions: curriculum.counts.questions,
          })}
          {curriculum.book_language ? ` · ${curriculum.book_language.toUpperCase()}` : ""}
        </p>
      )}
    </div>
  );
}
