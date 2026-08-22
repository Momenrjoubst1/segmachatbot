/**
 * Line-style icons for the bot status indicator. Minimalist / Claude.ai
 * aesthetic — 1.5px stroke, rounded line caps, currentColor.
 *
 * All icons accept a `className` and are 16×16 by default.
 */

import { type FC, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const IconBrain: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M5.5 2.5a2 2 0 0 0-2 2v.5a2 2 0 0 0-1 3.5 2 2 0 0 0 1 3.5v.5a2 2 0 0 0 2 2M10.5 2.5a2 2 0 0 1 2 2v.5a2 2 0 0 1 1 3.5 2 2 0 0 1-1 3.5v.5a2 2 0 0 1-2 2M5.5 4v8M10.5 4v8M8 6v4" />
  </svg>
);

export const IconSearch: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3 3" />
  </svg>
);

export const IconCheck: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="m3 8 3 3 7-7" />
  </svg>
);

export const IconChevronRight: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="m6 4 4 4-4 4" />
  </svg>
);

export const IconChevronDown: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="m4 6 4 4 4-4" />
  </svg>
);

export const IconShield: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M8 2 3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4l-5-2Z" />
  </svg>
);

export const IconStack: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="m2 5 6 3 6-3M2 5v6l6 3 6-3V5M2 9l6 3 6-3" />
  </svg>
);

export const IconHammer: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M3 13 11 5l2 2-8 8H3v-2ZM9 3l2 2 2-2-2-2-2 2Z" />
  </svg>
);

export const IconAlert: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3M8 11h.01" />
  </svg>
);

export const IconStop: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRefresh: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M3 8a5 5 0 0 1 9-3l1 1M13 8a5 5 0 0 1-9 3l-1-1" />
    <path d="M13 3v3h-3M3 13v-3h3" />
  </svg>
);

export const IconLoader: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p} style={{ animation: "spin 1.2s linear infinite", ...p.style }}>
    <path d="M13 8a5 5 0 1 1-2-4" />
  </svg>
);

export const IconBook: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M3 3h6a3 3 0 0 1 3 3v8a2 2 0 0 0-2-2H3V3ZM13 3h-1a3 3 0 0 0-3 3v8a2 2 0 0 1 2-2h2V3Z" />
  </svg>
);

export const IconCalendar: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5 2v3M11 2v3" />
  </svg>
);

export const IconMail: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <rect x="2" y="4" width="12" height="8" rx="1.5" />
    <path d="m2 5 6 4 6-4" />
  </svg>
);

export const IconCode: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="m5 5-3 3 3 3M11 5l3 3-3 3M9 3l-2 10" />
  </svg>
);

export const IconClock: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);

export const IconCloud: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M4 12a3 3 0 0 1-1-5.8A4 4 0 0 1 11 4a3 3 0 0 1 4 3 3 3 0 0 1-3 3H4Z" />
  </svg>
);

export const IconSpark: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />
  </svg>
);

export const IconFilter: FC<IconProps> = (p) => (
  <svg {...baseProps} {...p}>
    <path d="M2 3h12l-4 5v5l-4-2V8L2 3Z" />
  </svg>
);
