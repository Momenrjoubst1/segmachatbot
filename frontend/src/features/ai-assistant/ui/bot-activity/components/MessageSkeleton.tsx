/**
 * `MessageSkeleton` — empty-state placeholder shown inside the assistant
 * message bubble while the bot is working but hasn't produced any text
 * yet. Matches Claude.ai's "two-line shimmer" UX.
 *
 * Reads from `useBotActivity()` to decide:
 *  - If the message is running (status in running-* set) AND
 *  - There are no text parts yet,
 *  → render a 2-line skeleton placeholder.
 *
 * Honors `prefers-reduced-motion` (skeleton becomes static gray bars).
 */

import { type FC, useEffect, useState } from "react";
import { useAuiState } from "../../../shims/assistant-ui-compat-shim";
import { useBotActivity } from "../useBotActivity";
import type { AuiPart } from "../types";

const RUNNING_STATUSES = new Set([
  "thinking",
  "tool_running",
  "moderating",
  "compacting",
  "retrieving",
  "queued",
]);

function hasTextContent(parts: AuiPart[]): boolean {
  return parts.some((p) => {
    if (p.type === "text") {
      return ((p as Extract<AuiPart, { type: "text" }>).text?.length ?? 0) > 0;
    }
    // Reasoning deltas (thinking stream) count as visible content —
    // the skeleton should yield as soon as thoughts start arriving.
    if (p.type === "reasoning") {
      return ((p as Extract<AuiPart, { type: "reasoning" }>).text?.length ?? 0) > 0;
    }
    return false;
  });
}

export const MessageSkeleton: FC = () => {
  const activity = useBotActivity();
  const parts = useAuiState((s) => s.message.parts as unknown as AuiPart[]);

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (hasTextContent(parts)) return null;
  if (!RUNNING_STATUSES.has(activity.status)) return null;

  const animationClass = reducedMotion ? "opacity-60" : "animate-pulse";

  return (
    <div
      className="flex flex-col gap-2 py-1 motion-reduce:animate-none"
      aria-hidden="true"
    >
      <div className={`h-3 w-11/12 rounded bg-muted-foreground/15 ${animationClass}`} />
      <div className={`h-3 w-7/12 rounded bg-muted-foreground/15 ${animationClass}`} />
    </div>
  );
};

MessageSkeleton.displayName = "MessageSkeleton";
