/**
 * @deprecated Use `useBotActivity` from `./bot-activity/useBotActivity` instead.
 * This thin shim is kept only so the existing `markdown-text.tsx` import
 * keeps working. The new system derives the same `isStreamingText` signal
 * from the unified `BotActivity` snapshot.
 */

import { useBotActivity } from "./bot-activity/useBotActivity";
import type { BotStatus } from "./bot-activity/types";

export type { BotStatus };

export function useBotStatus(): { status: BotStatus; label: string; isStreamingText: boolean } {
  const activity = useBotActivity();
  return {
    status: activity.status,
    label: "", // legacy consumers ignored this; populated in the new UI layer
    isStreamingText: activity.isStreaming,
  };
}
