/**
 * `BotStatusInline` — the visible status widget that lives under the active
 * assistant message. Minimalist Claude.ai style:
 *
 *   while running:  [● Thinking…        1.2s ▾]
 *                   └─ ✓ Checked content      120ms
 *                   └─ ● Searching the web    780ms
 *                   └─ ⏸ Generating
 *
 *   after done:    [✓ 4 steps · 4.2s   ▾]
 *
 *   error:         [⚠ Something went wrong  Retry]
 *
 *   interrupted:   [■ Stopped  Regenerate]
 *
 * Fully controlled by `useBotActivity()` — no internal state. Click the
 * summary to expand/collapse.
 */

import { type FC, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useBotActivity } from "../useBotActivity";
import { formatDuration } from "../deriveBotActivity";
import { resolveStepLabel, resolveStatusLabel, formatResultSummary } from "../stepLabel";
import type { BotStep, StepKind } from "../types";
import {
  IconAlert, IconBook, IconBrain, IconCalendar, IconCheck, IconChevronDown, IconChevronRight,
  IconClock, IconCloud, IconCode, IconFilter, IconHammer, IconLoader, IconMail, IconRefresh,
  IconSearch, IconShield, IconSpark, IconStack, IconStop,
} from "./icons";

const ICON_FOR_KIND: Record<StepKind, FC<{ className?: string }>> = {
  moderation: IconShield,
  intent_detection: IconBrain,
  memory_context: IconStack,
  rag_pipeline: IconBook,
  fetch_user_courses: IconBook,
  thread_resolution: IconFilter,
  context_window: IconStack,
  persist_message: IconStack,
  ui_fastpass: IconSpark,
  tool_call: IconHammer,
  tool_result: IconCheck,
  generation: IconSpark,
  error: IconAlert,
};

function IconForStep({ step }: { step: BotStep }) {
  // Tool steps use a tool-specific icon when we recognize the tool.
  if (step.kind === "tool_call" && step.toolName) {
    const map: Record<string, FC<{ className?: string }>> = {
      web_search: IconSearch,
      calculator: IconCode,
      get_time: IconClock,
      get_weather: IconCloud,
      send_email: IconMail,
      create_calendar_event: IconCalendar,
      get_course_info: IconBook,
      generate_flashcards: IconStack,
      code_executor: IconCode,
      create_artifact: IconSpark,
    };
    const Icon = map[step.toolName] ?? ICON_FOR_KIND[step.kind];
    return <Icon className="size-3.5" />;
  }
  const Icon = ICON_FOR_KIND[step.kind] ?? IconSpark;
  return <Icon className="size-3.5" />;
}

export const BotStatusInline: FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation("botStatus");
  const activity = useBotActivity();
  const [expanded, setExpanded] = useState(false);

  const onToggle = useCallback(() => setExpanded((v) => !v), []);

  const isRunning = ["thinking", "tool_running", "moderating", "retrieving", "compacting", "streaming", "queued", "retrying"].includes(activity.status);
  const isError = activity.status === "error";
  const isInterrupted = activity.status === "interrupted";

  const summary = useMemo(() => {
    if (isError) return t("error");
    if (isInterrupted) return t("interrupted");
    return resolveStatusLabel(t, activity.status as never);
  }, [t, activity.status, isError, isInterrupted]);

  const completedCount = activity.steps.filter((s) => s.status === "complete").length;
  const elapsed = formatDuration(activity.elapsedMs);

  if (activity.status === "idle") return null;

  return (
    <div
      className="bot-status-inline mb-2 text-muted-foreground select-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Summary row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? t("collapse") : t("expand")}
          className="group flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted/60 transition-colors duration-150"
        >
          {isError ? (
            <IconAlert className="size-3.5 text-red-500" />
          ) : isInterrupted ? (
            <IconStop className="size-3.5 text-amber-500" />
          ) : isRunning ? (
            <IconLoader className="size-3.5 text-primary motion-reduce:hidden" />
          ) : (
            <IconCheck className="size-3.5 text-emerald-600" />
          )}
          <span className="text-[13px] font-medium">{summary}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground/70">
            {isRunning || activity.elapsedMs > 0 ? elapsed : ""}
          </span>
          {activity.steps.length > 0 && (
            expanded
              ? <IconChevronDown className="size-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
              : <IconChevronRight className="size-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
          )}
        </button>

        {/* Inline action: retry on error, regenerate on interrupted.
            (Stop intentionally lives in the composer only — a stop button
            next to the status line was noisy and redundant.) */}
        {isError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
            aria-label={t("retry")}
          >
            <IconRefresh className="size-3" />
            {t("retry")}
          </button>
        )}
        {isInterrupted && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
            aria-label={t("regenerate")}
          >
            <IconRefresh className="size-3" />
            {t("regenerate")}
          </button>
        )}
      </div>

      {/* Expanded step list */}
      {expanded && activity.steps.length > 0 && (
        <ul
          className="ml-3 mt-1 border-l border-border/40 pl-3 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-200"
          role="list"
        >
          {activity.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 py-0.5 text-[12px]">
              <span
                className={
                  step.status === "error"
                    ? "text-red-500"
                    : step.status === "running"
                    ? "text-primary"
                    : step.status === "skipped"
                    ? "text-muted-foreground/50"
                    : "text-emerald-600"
                }
                aria-hidden
              >
                {step.status === "running" ? (
                  <IconLoader className="size-3 motion-reduce:hidden" />
                ) : step.status === "error" ? (
                  <IconAlert className="size-3" />
                ) : step.status === "skipped" ? (
                  <span className="inline-block size-1.5 rounded-full bg-muted-foreground/40" />
                ) : (
                  <IconCheck className="size-3" />
                )}
              </span>
              <IconForStep step={step} />
              <span className={step.status === "skipped" ? "text-muted-foreground/50 line-through" : "text-muted-foreground/90"}>
                {resolveStepLabel(t, step, { completed: step.status === "complete" })}
              </span>
              {step.result && step.result.count !== undefined && (
                <span className="text-muted-foreground/60 text-[11px]">
                  · {formatResultSummary(t, step.result)}
                </span>
              )}
              {step.detail && step.status === "complete" && (
                <span className="text-muted-foreground/50 text-[11px] truncate max-w-[16rem]" title={step.detail}>
                  {step.detail}
                </span>
              )}
              {step.durationMs !== undefined && (
                <span className="ml-auto tabular-nums text-muted-foreground/50 text-[11px]">
                  {formatDuration(step.durationMs)}
                </span>
              )}
            </li>
          ))}
          {activity.status === "streaming" && (
            <li className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground/70">
              <IconLoader className="size-3 text-primary motion-reduce:hidden" />
              <span>{resolveStatusLabel(t, "streaming")}</span>
              {activity.tokenCount > 0 && (
                <span className="text-muted-foreground/50 text-[11px]">
                  · {t("tokens", { count: activity.tokenCount })}
                </span>
              )}
            </li>
          )}
        </ul>
      )}

      {/* Quiet summary line when done (no expansion) */}
      {!expanded && !isRunning && !isError && !isInterrupted && activity.steps.length > 0 && (
        <p className="ml-1 mt-0.5 text-[11px] text-muted-foreground/60">
          {t("steps.summary", { count: completedCount })} · {elapsed}
        </p>
      )}
    </div>
  );
};

BotStatusInline.displayName = "BotStatusInline";
