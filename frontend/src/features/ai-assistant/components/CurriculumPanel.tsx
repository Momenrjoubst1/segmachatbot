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
import { useTextbooks } from "@/hooks/useTextbooks";
import {
  useCurriculum,
  type CurriculumSection,
} from "@/hooks/useCurriculum";

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

function QuizMode({ questions }: { questions: NonNullable<ReturnType<typeof useCurriculum>["questions"]> }) {
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

  if (shuffled.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
        No questions were extracted from this book.
      </p>
    );
  }

  const q = shuffled[index];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ListChecks className="size-3.5" />
          Question {index + 1} / {shuffled.length}
        </span>
        <span>{q.question_type === "unit_questions" ? "Unit questions" : "Lesson questions"}</span>
      </div>

      <div
        dir="auto"
        className="rounded-xl border border-border/60 bg-card p-4 text-sm leading-relaxed"
      >
        {q.number && <span className="font-semibold mr-1">{q.number}.</span>}
        {q.text}
      </div>

      {showAnswerHint && (
        <p className="px-1 text-xs text-muted-foreground">
          Answer it in your own words, then ask the assistant in chat to check your
          answer against page {q.page_number ?? "?"}.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={index === 0}
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1));
            setShowAnswerHint(false);
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
          {showAnswerHint ? "Hide hint" : "Hint"}
        </Button>
        <Button
          size="sm"
          disabled={index === shuffled.length - 1}
          onClick={() => {
            setIndex((i) => Math.min(shuffled.length - 1, i + 1));
            setShowAnswerHint(false);
          }}
          className="h-8"
        >
          Next <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function CurriculumPanel({ initialTab = "structure" }: { initialTab?: Tab }) {
  const { textbooks, isLoading: booksLoading } = useTextbooks();
  const completed = textbooks.filter((t) => t.status === "completed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  const activeId = selectedId && completed.some((t) => t.id === selectedId)
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
        Loading your books…
      </div>
    );
  }

  if (completed.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card/95 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <GraduationCap className="size-4 text-primary" />
            Study Map
        </h3>
        {completed.length > 1 && (
          <select
            value={activeId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="max-w-[55%] truncate rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {completed.map((t) => (
              <option key={t.id} value={t.id}>
                {t.file_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-muted p-0.5 text-xs">
        {(
          [
            ["structure", "Lessons"],
            ["glossary", "Terms"],
            ["quiz", "Quiz"],
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

      <div className="max-h-64 overflow-y-auto">
        {isLoading && (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
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
              No lesson structure detected for this book yet.
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
              {glossary ? "No glossary found in this book." : "Loading terms…"}
            </p>
          )
        )}

        {!isLoading && tab === "quiz" && (
          questions ? (
            <QuizMode questions={questions} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading questions…</p>
          )
        )}
      </div>

      {curriculum && (
        <p className="text-[10px] text-muted-foreground">
          {curriculum.counts.sections} sections · {curriculum.counts.questions} questions
          {curriculum.book_language ? ` · ${curriculum.book_language.toUpperCase()}` : ""}
        </p>
      )}
    </div>
  );
}
