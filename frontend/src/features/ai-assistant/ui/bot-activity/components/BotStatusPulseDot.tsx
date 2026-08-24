/**
 * `BotStatusPulseDot` — tiny reusable indicator for the bot's overall
 * status. Used in the sidebar next to the logo, and in the per-thread
 * row of the thread list.
 *
 * Reads status from the `botActivityBridge` (populated by
 * `BotActivityReporter` inside the AUI runtime), so this component can
 * be safely rendered ANYWHERE in the tree — including outside the
 * `AssistantRuntimeProvider` (e.g. the sidebar).
 *
 * Visual:
 *   - idle         → muted gray dot, no animation
 *   - running/*    → primary-colored dot, gentle pulse
 *   - error        → red dot, no animation
 *   - interrupted  → amber dot, no animation
 *
 * Honors `prefers-reduced-motion` (no pulse when the user opts out).
 */

import { type FC, useEffect, useState } from "react";
import { useBotActivitySnapshot } from "../botActivityBridge";
import type { BotStatus } from "../types";

const COLOR_FOR: Record<BotStatus, string> = {
  // Invisible while idle/queued — the gray dots bothered the user; the dot
  // only appears once there is real activity to signal.
  idle: "bg-transparent",
  queued: "bg-transparent",
  thinking: "bg-primary",
  tool_running: "bg-primary",
  moderating: "bg-primary",
  compacting: "bg-primary",
  retrieving: "bg-primary",
  streaming: "bg-primary",
  interrupted: "bg-amber-500",
  retrying: "bg-primary",
  error: "bg-red-500",
};

const PULSING_STATUSES: ReadonlySet<BotStatus> = new Set<BotStatus>([
  "thinking",
  "tool_running",
  "moderating",
  "compacting",
  "retrieving",
  "streaming",
  "queued",
  "retrying",
]);

interface BotStatusPulseDotProps {
  size?: "xs" | "sm";
  /** When set, overrides the active activity's status (e.g. for
   *  showing the status of a non-active thread). When undefined, reads
   *  from the global bot activity bridge. */
  overrideStatus?: BotStatus;
  className?: string;
}

export const BotStatusPulseDot: FC<BotStatusPulseDotProps> = ({
  size = "xs",
  overrideStatus,
  className = "",
}) => {
  const activity = useBotActivitySnapshot();
  const status: BotStatus = overrideStatus ?? activity.status;

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const shouldPulse = PULSING_STATUSES.has(status) && !reducedMotion;
  const sizeClass = size === "sm" ? "size-2" : "size-1.5";

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      aria-label={`Bot status: ${status}`}
    >
      {/* Static dot */}
      <span
        className={`${sizeClass} rounded-full ${COLOR_FOR[status]} ${
          shouldPulse ? "animate-[botPulse_1.6s_ease-in-out_infinite]" : ""
        }`}
      />
      {/* Soft halo while running (for extra visibility) */}
      {shouldPulse && (
        <span
          className={`absolute ${sizeClass} rounded-full ${COLOR_FOR[status]} opacity-40 animate-ping`}
          style={{ animationDuration: "1.6s" }}
        />
      )}
    </span>
  );
};

BotStatusPulseDot.displayName = "BotStatusPulseDot";
