/**
 * `SigmaMark` — Sigma's own brand mark (the molecular network from
 * `public/favicon.svg`), drawn with `currentColor` so the parent sets the
 * color (`text-[#BE1E2D]` = the logo's authentic crimson). Used as the
 * status-indicator spark in place of Claude's starburst: next to the
 * working verb (spinning), at the content edge while streaming, and parked
 * below the finished message.
 */

import { type FC } from "react";

export const SigmaMark: FC<{ className?: string }> = ({ className = "" }) => (
  <svg
    viewBox="10 10 85 80"
    fill="none"
    stroke="currentColor"
    strokeWidth={7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <line x1="50" y1="23" x2="50" y2="77" />
    <path d="M 50 23 L 26 50 L 50 77" />
    <path d="M 50 23 L 74 50 L 50 77" />
    <line x1="74" y1="50" x2="87" y2="37" />
    <line x1="74" y1="50" x2="87" y2="63" />
    <g fill="currentColor" stroke="none">
      <circle cx="50" cy="23" r="6.5" />
      <circle cx="50" cy="77" r="6.5" />
      <circle cx="26" cy="50" r="7.5" />
      <circle cx="87" cy="37" r="6.5" />
      <circle cx="87" cy="63" r="6.5" />
    </g>
  </svg>
);

SigmaMark.displayName = "SigmaMark";
