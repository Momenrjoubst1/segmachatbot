/**
 * `botActivityBridge` — like `sendStateBridge`, but for `BotActivity`.
 *
 * Why we need it: components like the sidebar logo and the header live
 * OUTSIDE the `AssistantRuntimeProvider`, but they want to show a small
 * status pulse based on the active thread's bot activity. They can't
 * call `useBotActivity()` directly because that hook uses
 * `useAuiState` and must be called inside the runtime.
 *
 * Pattern:
 *   - A component INSIDE the runtime (`BotActivityReporter`) reads
 *     `useBotActivity()` on every render and pushes the result to this
 *     bridge.
 *   - Components OUTSIDE the runtime use `useBotActivitySnapshot()`,
 *     which subscribes to the bridge and returns the last-known
 *     activity snapshot.
 *
 * If the runtime hasn't reported yet (e.g. on first paint), the snapshot
 * is an idle activity — no pulse, no harm.
 */

import { useEffect, useState } from "react";
import type { BotActivity } from "./types";

const IDLE_ACTIVITY: BotActivity = {
  status: "idle",
  steps: [],
  currentStep: null,
  elapsedMs: 0,
  tokenCount: 0,
  isStreaming: false,
};

let lastActivity: BotActivity = IDLE_ACTIVITY;
const subscribers = new Set<(a: BotActivity) => void>();

/** Push a new activity snapshot. Called from inside the AUI runtime. */
export function reportBotActivity(activity: BotActivity): void {
  if (
    lastActivity.status === activity.status &&
    lastActivity.isStreaming === activity.isStreaming &&
    lastActivity.steps.length === activity.steps.length
  ) {
    lastActivity = activity;
    return;
  }
  lastActivity = activity;
  for (const cb of subscribers) cb(activity);
}

/** Subscribe to activity changes from outside the AUI runtime. */
export function useBotActivitySnapshot(): BotActivity {
  const [snap, setSnap] = useState<BotActivity>(lastActivity);
  useEffect(() => {
    const cb = (a: BotActivity) => setSnap(a);
    subscribers.add(cb);
    // Push the latest immediately on mount (in case it changed before
    // the subscriber attached).
    setSnap(lastActivity);
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  return snap;
}
