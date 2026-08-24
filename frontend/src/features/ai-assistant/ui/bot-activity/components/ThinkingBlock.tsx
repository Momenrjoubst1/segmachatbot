/**
 * `ThinkingBlock` — collapsible view of the model's streamed reasoning.
 * Claude.ai-style "Thought for Ns" pattern:
 *
 *   while thinking:  [🧠 Thinking… ▾]     ← expanded, text streams in
 *                    | muted reasoning    |
 *                    |  text, auto-scroll |
 *
 *   after done:      [✓ Thought for 3.2s ▴]  ← collapsed, click to expand
 *
 * Used in two shapes:
 *  - native `reasoning` parts (Gemini thoughts via the AI SDK)
 *  - <think>…</think> segments recovered from OpenAI-compatible streams
 *
 * Auto-expands while running and auto-collapses when done (unless the user
 * toggled manually). Honors `prefers-reduced-motion` via motion-reduce classes.
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconBrain, IconChevronDown, IconChevronRight, IconLoader } from "./icons";

const THINKING_BLOCK_MAX = 3; // seconds resolution for the done-label

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

  // Auto-scroll the thought body while streaming.
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

  const seconds =
    durationRef.current ??
    (startedAtRef.current != null
      ? Math.max(0, (Date.now() - startedAtRef.current) / 1000)
      : null);
  const showDuration = !running && seconds != null && seconds >= THINKING_BLOCK_MAX;

  const label = running
    ? t("thinking.active")
    : showDuration
      ? t("thinking.done", { duration: `${seconds.toFixed(1)}s` })
      : t("thinking.past");

  return (
    <div className="bot-thinking mb-1 select-none" aria-live="polite">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? t("collapse") : t("expand")}
        className="group flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted/60 transition-colors duration-150"
      >
        {running ? (
          <IconLoader className="size-3.5 text-primary motion-reduce:hidden" />
        ) : (
          <IconBrain className="size-3.5 text-primary/70" />
        )}
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {expanded ? (
          <IconChevronDown className="size-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          className="ml-3 mr-2 mt-1 max-h-56 overflow-y-auto rounded-md border-l-2 border-primary/30 bg-muted/30 px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-6 text-muted-foreground/85">
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

ThinkingBlock.displayName = "ThinkingBlock";
