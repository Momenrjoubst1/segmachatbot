/**
 * `BotStatusInline` — the visible status widget that lives under the active
 * assistant message. Mirrors the REAL claude.ai flow (verified from a
 * screen recording, Aug 2026):
 *
 *   idle/parked:        coral starburst alone at the message-start slot
 *                       (see `ParkedSpark` below).
 *   working, thinking:  ✳ <Verb> — the coral starburst spins next to a
 *                       playful gerund ("Figuring", "يفكّر"…) whose text
 *                       carries the shimmer sweep. Verb is picked once per
 *                       run (stable hash of the message id).
 *   working, tools:     the verb header stays while NO step has completed;
 *                       tool lines stack under it as plain muted text
 *                       (icon + label). Once the first step completes the
 *                       header drops and the shimmer moves to the running
 *                       line.
 *   answer streaming:   activity collapses into past-tense lines
 *                       ("Searched the web") + source chips above the
 *                       text; the starburst travels to the content edge
 *                       (`ParkedSpark`, animated).
 *   done:               past-tense lines + chips persist, verb gone,
 *                       starburst parks below the message (static).
 *   error:              "Something went wrong" + Retry.
 *   interrupted:        NULL (the interrupted banner owns that state).
 *
 * No spinner icon, no live elapsed timer, no token counter, no per-step
 * durations, no expand/collapse — exactly like Claude.
 *
 * Scoping: the LIVE paths render only on the thread's LAST message
 * (`useBotActivity` reads the thread's last message, so older messages
 * must never render the active run). Done-state lines/chips are derived
 * from the message's OWN parts, so every message keeps its own trace.
 */

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuiState } from "../../../shims/assistant-ui-compat-shim";
import { useBotActivity, extractStepEvents } from "../useBotActivity";
import { deriveBotActivity } from "../deriveBotActivity";
import { resolveStepLabel, formatResultSummary } from "../stepLabel";
import { splitThinkBlocks } from "../thinkTags";
import type { AuiPart, BotStep } from "../types";
import { ShimmerText } from "./ShimmerText";
import {
  IconAlert, IconBook, IconBrain, IconCalendar, IconClock, IconCloud, IconCode,
  IconFilter, IconHammer, IconMail, IconRefresh, IconSearch, IconShield,
  IconSpark, IconStack,
} from "./icons";
import { SigmaMark } from "./SigmaMark";

/* Sigma's own mark in the logo's authentic crimson (see public/favicon.svg). */
const SPARK_COLOR = "text-[#BE1E2D]";

/** Sigma's working mark: elastic wobble + node bounce, off under reduced motion. */
const SPIN_CLASS = "motion-reduce:hidden sigma-activity";

const ICON_FOR_KIND: Record<string, FC<{ className?: string }>> = {
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
  tool_result: IconSpark,
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
    return <Icon className="size-3.5 shrink-0" />;
  }
  const Icon = ICON_FOR_KIND[step.kind] ?? IconSpark;
  return <Icon className="size-3.5 shrink-0" />;
}

const RUNNING_STATUSES = new Set([
  "thinking",
  "tool_running",
  "moderating",
  "compacting",
  "retrieving",
  "streaming",
  "queued",
  "retrying",
]);

/** Stable per-message pick from the playful-verb pool (Claude rotates
 *  gerunds like "Figuring"/"Triangulating" once per run). */
function pickVerb(verbs: string[], seedText: string): string {
  if (!verbs.length) return "";
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) | 0;
  return verbs[Math.abs(h) % verbs.length];
}

/** True once the visible ANSWER has text (think-blocks excluded). */
function hasVisibleAnswer(parts: AuiPart[]): boolean {
  return parts.some((p) => {
    if (p.type !== "text") return false;
    const split = splitThinkBlocks((p as Extract<AuiPart, { type: "text" }>).text ?? "");
    return split.answer.trim().length > 0;
  });
}

/** True while reasoning is visible in the ThinkingBlock (native or <think>). */
function hasVisibleThinking(parts: AuiPart[]): boolean {
  return parts.some((p) => {
    if (p.type === "reasoning") {
      return ((p as Extract<AuiPart, { type: "reasoning" }>).text?.length ?? 0) > 0;
    }
    if (p.type === "text") {
      return splitThinkBlocks((p as Extract<AuiPart, { type: "text" }>).text ?? "").open;
    }
    return false;
  });
}

// ─── Done-state source chips (the collapsed results card) ────────────────

interface SourceChip {
  key: string;
  label: string;
  url?: string;
  title?: string;
  step: BotStep;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Chips from a message's completed steps — item-level sources only;
 *  counts live in the past-tense lines. Internal plumbing steps
 *  (moderation, persistence…) produce nothing, like Claude. */
function collectSourceChips(steps: BotStep[]): SourceChip[] {
  const chips: SourceChip[] = [];
  for (const step of steps) {
    if (step.status !== "complete") continue;
    for (const [i, item] of (step.result?.items ?? []).entries()) {
      chips.push({
        key: `${step.id}-${i}`,
        label: item.title || (item.url ? hostOf(item.url) : undefined) || step.label,
        url: item.url,
        title: item.preview ?? item.title ?? item.url,
        step,
      });
    }
  }
  return chips;
}

const MAX_CHIPS = 4;

const SourceChips: FC<{ steps: BotStep[] }> = ({ steps }) => {
  const [showAll, setShowAll] = useState(false);

  const chips = useMemo(() => collectSourceChips(steps), [steps]);
  if (chips.length === 0) return null;

  const visible = showAll ? chips : chips.slice(0, MAX_CHIPS);
  const hidden = chips.length - visible.length;

  const chipClass =
    "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground";

  return (
    <div className="bot-source-chips mt-1 flex flex-wrap items-center gap-1.5" role="list">
      {visible.map((chip) => {
        const body = (
          <>
            <span className="shrink-0 text-muted-foreground/60" aria-hidden>
              <IconForStep step={chip.step} />
            </span>
            <span className="truncate">{chip.label}</span>
          </>
        );
        return chip.url ? (
          <a
            key={chip.key}
            role="listitem"
            href={chip.url}
            target="_blank"
            rel="noreferrer"
            className={chipClass}
            title={chip.title}
          >
            {body}
          </a>
        ) : (
          <span key={chip.key} role="listitem" className={chipClass} title={chip.title}>
            {body}
          </span>
        );
      })}
      {hidden > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={`${chipClass} cursor-pointer font-medium`}
        >
          +{hidden}
        </button>
      )}
    </div>
  );
};

SourceChips.displayName = "SourceChips";

// ─── Parked starburst (below the last message / at the content edge) ─────

/**
 * `ParkedSpark` — Claude's persistent coral starburst: sits alone at the
 * bottom of the LAST assistant message when idle; travels to the growing
 * content edge (spinning) while the answer streams. Hidden while the
 * pre-content verb header owns the moment, and on error/interrupted.
 */
export const ParkedSpark: FC = () => {
  const activity = useBotActivity();
  const [isAnimating, setIsAnimating] = useState(false);
  const parts = useAuiState((s) => s.message.parts) as unknown as AuiPart[] | undefined;
  const isLast = useAuiState((s) => {
    const msgs = s.thread.messages;
    return msgs.length > 0 && msgs[msgs.length - 1]?.id === s.message.id;
  });

  const handleSparkClick = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 1800);
  };

  if (!isLast) return null;
  if (activity.status === "error" || activity.status === "interrupted") return null;

  const isRunning = RUNNING_STATUSES.has(activity.status);
  if (isRunning) {
    // While working pre-content, the verb header at the top owns the spark;
    // once the answer streams, the spark travels to the content edge.
    if (!hasVisibleAnswer(parts ?? [])) return null;
    return (
      <div className="mt-8 py-1 ps-2" aria-hidden>
        <SigmaMark className={`size-6 ${SPARK_COLOR} ${SPIN_CLASS}`} />
      </div>
    );
  }

  // Parked below the finished message; clickable easter-egg like the welcome logo.
  return (
    <div className="mt-8 py-1 ps-2">
      <div
        className="size-6 cursor-pointer select-none"
        onClick={handleSparkClick}
        title="Click me!"
      >
        <SigmaMark className={`size-6 ${SPARK_COLOR} opacity-90 ${isAnimating ? "sigma-click" : ""}`} />
      </div>
    </div>
  );
};

ParkedSpark.displayName = "ParkedSpark";

// ─── Main widget ──────────────────────────────────────────────────────────

export const BotStatusInline: FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation("botStatus");
  const activity = useBotActivity();
  const parts = useAuiState((s) => s.message.parts) as unknown as AuiPart[] | undefined;
  const scrollRef = useRef<HTMLUListElement | null>(null);

  // Only the thread's LAST message may show live state — useBotActivity
  // is thread-scoped, so older messages must never render the active run.
  const isLast = useAuiState((s) => {
    const msgs = s.thread.messages;
    return msgs.length > 0 && msgs[msgs.length - 1]?.id === s.message.id;
  });
  const messageId = useAuiState((s) => s.message.id);

  const isRunning = RUNNING_STATUSES.has(activity.status);
  const isError = activity.status === "error";

  // Playful working verb, stable for this message (Claude rotates gerunds).
  const verbs = t("verbs", { returnObjects: true }) as unknown as string[];
  const verb = useMemo(() => pickVerb(Array.isArray(verbs) ? verbs : [], messageId ?? ""), [verbs, messageId]);

  // Claude: once the visible answer starts, the activity lines collapse
  // into past-tense lines + source chips; the caret is the live signal.
  const answerStarted = useMemo(() => hasVisibleAnswer(parts ?? []), [parts]);
  // Claude: while reasoning streams in the ThinkingBlock, the verb header
  // would be redundant — that block owns the moment.
  const thinkingVisible = useMemo(() => hasVisibleThinking(parts ?? []), [parts]);

  // Per-message steps from THIS message's own parts → done-state lines/chips.
  const ownSteps = useMemo(
    () => deriveBotActivity({ parts, status: undefined, streamEvents: extractStepEvents(parts ?? []) }).steps,
    [parts],
  );

  // Keep the newest activity line in view while the stack grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activity.steps.length, activity.currentStep?.id]);

  // ── Done state (any message, from its own parts): past-tense lines ──
  // for visible tools + item-level source chips. Claude keeps exactly one
  // collapsed line ("Searched the web"); internal plumbing vanishes.
  const doneBlock = (() => {
    const visible = ownSteps.filter(
      (s) => s.status === "complete" && (s.kind === "tool_call" || s.result !== undefined),
    );
    if (visible.length === 0 && collectSourceChips(ownSteps).length === 0) return null;
    return (
      <div className="bot-status-done mb-2 select-none">
        <ul className="ml-1 space-y-0.5" role="list">
          {visible.slice(0, 4).map((step) => (
            <li key={step.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
              <span className="text-muted-foreground/60" aria-hidden>
                <IconForStep step={step} />
              </span>
              <span className="text-muted-foreground/80">
                {resolveStepLabel(t, step, { completed: true })}
              </span>
              {step.result && step.result.count !== undefined && step.result.items?.length ? null : (
                step.result && step.result.count !== undefined ? (
                  <span className="text-[11px] text-muted-foreground/60">
                    · {formatResultSummary(t, step.result)}
                  </span>
                ) : null
              )}
            </li>
          ))}
        </ul>
        <SourceChips steps={ownSteps} />
      </div>
    );
  })();

  // Older messages: their own done-block, never live state.
  if (!isLast) return doneBlock;

  if (isError) {
    return (
      <div className="bot-status-inline mb-2 flex items-center gap-2 select-none" aria-live="polite">
        <IconAlert className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">{t("error")}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground/80 transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
            aria-label={t("retry")}
          >
            <IconRefresh className="size-3" />
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  if (!isRunning) return doneBlock; // done → past-tense trace persists

  // ── Running on the last message ──
  if (answerStarted) return doneBlock; // past-tense lines ride above the text

  const completedCount = activity.steps.filter((s) => s.status !== "running").length;
  // Claude: the ✳ verb header shows while NO step has completed; after
  // that the shimmer moves to the still-running line.
  const showVerbHeader = completedCount === 0;

  if (activity.steps.length > 0) {
    return (
      <div className="bot-status-inline mb-2 select-none" aria-live="polite" aria-atomic="false">
        <ul
          ref={scrollRef}
          className="ml-1 max-h-40 space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="list"
        >
          {showVerbHeader && verb && (
            <li className="flex items-center gap-2 py-0.5 text-[13px]">
              <SigmaMark className={`size-4 shrink-0 ${SPARK_COLOR} ${SPIN_CLASS}`} />
              <ShimmerText className="font-medium text-foreground/85">{verb}</ShimmerText>
            </li>
          )}
          {activity.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
              <span className="text-muted-foreground/60" aria-hidden>
                <IconForStep step={step} />
              </span>
              {step.status === "running" && !showVerbHeader ? (
                <ShimmerText>{resolveStepLabel(t, step)}</ShimmerText>
              ) : (
                <span
                  className={
                    step.status === "skipped" || step.status === "error"
                      ? "text-muted-foreground/50"
                      : "text-muted-foreground/80"
                  }
                >
                  {resolveStepLabel(t, step, { completed: step.status === "complete" })}
                </span>
              )}
              {step.result && step.result.count !== undefined && (
                <span className="text-[11px] text-muted-foreground/60">
                  · {formatResultSummary(t, step.result)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // No tool steps yet — ✳ + shimmering verb, unless reasoning is already
  // visible (ThinkingBlock owns it) or the answer has started.
  if (!thinkingVisible) {
    return (
      <div className="bot-status-inline mb-2 flex items-center gap-2 select-none" aria-live="polite">
        {verb && <SigmaMark className={`size-4 shrink-0 ${SPARK_COLOR} ${SPIN_CLASS}`} />}
        <ShimmerText className="text-[13px] font-medium text-foreground/85">{verb || t("status.thinking")}</ShimmerText>
      </div>
    );
  }

  return null;
};

BotStatusInline.displayName = "BotStatusInline";
