/**
 * `ThinkingBlock` — collapsible view of the model's streamed reasoning.
 * Claude.ai's exact pattern:
 *
 *   while thinking:  [Thinking      ▾]   ← "Thinking" carries the shimmer
 *                      | muted reasoning |   sweep, no icon, no timer
 *                      |  text, muted    |
 *
 *   after done:      [Thought for 12s  ▸] ← collapsed pill with frozen
 *                                           duration; click to expand
 *
 * Used in two shapes:
 *  - native `reasoning` parts (Gemini thoughts via the AI SDK)
 *  - <think>…</think> segments recovered from OpenAI-compatible streams
 *
 * Auto-expands while running and auto-collapses when done (unless the user
 * toggled manually). No live seconds counter — Claude shows the duration
 * only once thinking completes.
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronDown, IconChevronRight } from "./icons";
import { ShimmerText } from "./ShimmerText";

/** Whole-second duration format, Claude pill style: `6s`, `2m 15s`. */
function formatThinkDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

interface ThinkingBlockProps {
  /** Accumulated reasoning text so far. */
  text: string;
  /** True while the model is still producing thoughts. */
  running: boolean;
}

export const ThinkingBlock: FC<ThinkingBlockProps> = ({ text, running }) => {
  const { t } = useTranslation("botStatus");
  const [expanded, setExpanded] = useState(running);
  const userToggledRef = useRef(false);
  const startedAtRef = useRef<number | null>(running ? Date.now() : null);
  const durationRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Freeze the duration when the run completes.
  useEffect(() => {
    if (running && startedAtRef.current == null) {
      startedAtRef.current = Date.now();
    }
    if (!running && startedAtRef.current != null && durationRef.current == null) {
      durationRef.current = (Date.now() - startedAtRef.current) / 1000;
    }
  }, [running]);

  // Follow expansion state unless the user took manual control.
  useEffect(() => {
    if (!userToggledRef.current) setExpanded(running);
  }, [running]);

  // Follow the thought body while streaming.
  useEffect(() => {
    if (running && expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, running, expanded]);

  const onToggle = useCallback(() => {
    userToggledRef.current = true;
    setExpanded((v) => !v);
  }, []);

  if (!text) return null;

  const seconds = durationRef.current;
  const label = running
    ? t("thinking.active")
    : seconds != null
      ? t("thinking.done", { duration: formatThinkDuration(seconds) })
      : t("thinking.past");

  return (
    <div className="bot-thinking mb-1 select-none" aria-live="polite">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? t("collapse") : t("expand")}
        className="group flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors duration-150 hover:bg-muted/60"
      >
        {running ? (
          <ShimmerText className="text-[13px] font-medium">{label}</ShimmerText>
        ) : (
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        )}
        {expanded ? (
          <IconChevronDown className="size-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          className="ml-4 mr-2 mt-0.5 max-h-64 overflow-y-auto border-l border-border/40 py-1 pl-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-6 text-muted-foreground/80">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

ThinkingBlock.displayName = "ThinkingBlock";
