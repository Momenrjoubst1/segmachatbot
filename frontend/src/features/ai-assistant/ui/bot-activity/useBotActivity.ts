/**
 * `useBotActivity` — the public hook for everything in the status indicator
 * system. Reads AUI state, extracts data-step events from the parts array,
 * derives the `BotActivity` snapshot, and ticks every 250ms while running
 * so durations stay live.
 *
 * Must be called from inside the AUI runtime (it uses `useAuiState`).
 */

import { useEffect, useMemo, useState } from "react";
import { useAui, useAuiState } from "../../shims/assistant-ui-compat-shim";
import { deriveBotActivity } from "./deriveBotActivity";
import type {
  AuiMessageStatusLike,
  AuiPart,
  BotActivity,
  StepStreamEvent,
} from "./types";

const TICK_MS = 250;

/** Extract step events from the data-* parts in an AUI message. */
export function extractStepEvents(parts: AuiPart[]): StepStreamEvent[] {
  const out: StepStreamEvent[] = [];
  for (const p of parts) {
    if (p && typeof p === "object" && typeof p.type === "string" && p.type.startsWith("data-")) {
      const data = (p as { data?: unknown }).data;
      if (data && typeof data === "object" && "kind" in data && "status" in data && "id" in data) {
        out.push(data as unknown as StepStreamEvent);
      }
    }
  }
  return out;
}

/** Re-render every `TICK_MS` while the message is running, so durations stay live. */
function useLiveTick(isRunning: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [isRunning]);
  return tick;
}

/**
 * Reads the last message's parts and status via the AUI client API
 * (not `useAuiState`), avoiding the proxy's new-object-on-each-access
 * problem that causes infinite re-renders.
 */
function useLastMessage() {
  const aui = useAui();
  const [parts, setParts] = useState<AuiPart[]>([]);
  const [status, setStatus] = useState<AuiMessageStatusLike | undefined>(undefined);

  useEffect(() => {
    const read = () => {
      try {
        const thread = aui.thread();
        const state = thread.getState();
        const messages = state.messages;
        const last = messages && messages.length > 0 ? messages[messages.length - 1] : undefined;
        const p = (last?.parts ?? []) as unknown as AuiPart[];
        const s = last?.status as AuiMessageStatusLike | undefined;
        setParts((prev) => {
          if (prev.length === p.length && prev.every((v, i) => v === p[i])) return prev;
          return p;
        });
        setStatus((prev) => (prev === s ? prev : s));
      } catch {
        // Thread not ready yet
      }
    };
    read();
    const unsub = aui.subscribe(read);
    return unsub;
  }, [aui]);

  return { parts, status };
}

export function useBotActivity(): BotActivity {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { parts, status } = useLastMessage();
  const tick = useLiveTick(isRunning);

  return useMemo(() => {
    const events = extractStepEvents(parts);
    return deriveBotActivity({ parts, status, streamEvents: events });
    // `tick` is intentionally in the deps so the memo re-evaluates and the
    // duration labels stay fresh while running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, status, tick]);
}
