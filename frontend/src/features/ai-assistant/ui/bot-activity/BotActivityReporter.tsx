/**
 * `BotActivityReporter` — invisible component mounted INSIDE the
 * `AssistantRuntimeProvider`. Reads `useBotActivity()` on every render
 * and pushes the result to the global `botActivityBridge` so that
 * components outside the runtime (sidebar logo, header) can read the
 * current status without themselves needing the AUI runtime.
 *
 * Renders nothing.
 */

import { type FC, useEffect, useRef } from "react";
import { useBotActivity } from "./useBotActivity";
import { reportBotActivity } from "./botActivityBridge";
import type { BotActivity } from "./types";

function hasMeaningfulChange(a: BotActivity, b: BotActivity): boolean {
  return (
    a.status !== b.status ||
    a.isStreaming !== b.isStreaming ||
    a.steps.length !== b.steps.length
  );
}

export const BotActivityReporter: FC = () => {
  const activity = useBotActivity();
  const prevRef = useRef(activity);

  useEffect(() => {
    if (hasMeaningfulChange(prevRef.current, activity)) {
      prevRef.current = activity;
      reportBotActivity(activity);
    }
  });

  return null;
};

BotActivityReporter.displayName = "BotActivityReporter";
