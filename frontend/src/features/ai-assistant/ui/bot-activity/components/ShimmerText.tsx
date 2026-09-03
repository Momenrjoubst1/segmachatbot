/**
 * `ShimmerText` — Claude.ai-style status label: the text itself carries a
 * sweeping bright band (`.shimmer-text`), no spinner icon. Used by
 * `BotStatusInline` (current activity line) and `ThinkingBlock`
 * ("Thinking" while reasoning streams).
 */

import { type FC } from "react";

export const ShimmerText: FC<{ children: string; className?: string }> = ({
  children,
  className = "",
}) => (
  <span className={`shimmer-text ${className}`.trim()} aria-hidden="false">
    {children}
  </span>
);

ShimmerText.displayName = "ShimmerText";
