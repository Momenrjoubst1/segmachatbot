/**
 * `ComposerStatus` — small inline indicator that lives in the composer
 * action group. Shows token count + elapsed time while a message is
 * being generated.
 *
 * Renders nothing in idle state. The stop / send button is owned by
 * the existing `ComposerAction` component — this is purely an indicator
 * that sits to the LEFT of the action button.
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useBotActivity } from "../useBotActivity";
import { formatDuration } from "../deriveBotActivity";

interface ComposerStatusProps {
  /** Whether the composer is currently submitting or streaming. */
  active: boolean;
}

export const ComposerStatus: FC<ComposerStatusProps> = ({ active }) => {
  const { t } = useTranslation("botStatus");
  const activity = useBotActivity();

  if (!active) return null;

  // Only show the counter once we have something to show. Empty streams
  // should stay quiet — the spinner is enough visual feedback.
  if (activity.tokenCount <= 0 && activity.elapsedMs < 200) return null;

  return (
    <span
      className="composer-status flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/70 animate-in fade-in duration-200"
      aria-live="off"
    >
      {activity.tokenCount > 0 && (
        <span>{t("tokens", { count: activity.tokenCount })}</span>
      )}
      {activity.tokenCount > 0 && activity.elapsedMs >= 200 && (
        <span className="text-muted-foreground/40">·</span>
      )}
      {activity.elapsedMs >= 200 && (
        <span>{formatDuration(activity.elapsedMs)}</span>
      )}
    </span>
  );
};

ComposerStatus.displayName = "ComposerStatus";
