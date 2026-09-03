import { useState, useEffect, useMemo, useRef, type FC, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  AuiIf,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
} from "../../../shims/assistant-ui-compat-shim";
import { ArrowDownIcon } from "lucide-react";
import { useUserProfile } from "../Sidebar/UserProfileCard";
import { ThreadMessage } from "./MessageComponents";
import { ThreadComposer, SelectionToolbar } from "./ThreadComposer";
import { OnboardingFlow } from "../Onboarding/OnboardingFlow";
import { useSmartAutoScroll } from "@/hooks/useSmartAutoScroll";
import { useChatHistory } from "@/hooks/useChatHistory";
import { useTranslation } from "react-i18next";
import { useTextbooks } from "@/hooks/useTextbooks";
import {
  COUNTRY_RESOLVE_GRACE_MS,
  useIsInJordan,
} from "../../../hooks/useUserCountry";

// ─── Time-Based Greeting System ────────────────────────────────────────────────────

type TimeBucket = "morning" | "afternoon" | "evening" | "lateNight";

// Get the current hour in the user's actual local timezone (IANA).
// hourCycle "h23" avoids the legacy "24" midnight quirk of hour12:false.
function getCurrentLocalHour(): number {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hourStr = new Date().toLocaleString("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    });
    return parseInt(hourStr, 10);
  } catch {
    return new Date().getHours();
  }
}

function getCurrentBucket(): TimeBucket {
  const hour = getCurrentLocalHour();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 23) return "evening";
  return "lateNight";
}

// ─── Sticky per-period greeting storage ────────────────────────────────
//
// A refresh must NOT reshuffle the greeting: the phrase picked for a time
// bucket sticks for the rest of the local calendar day (keyed per dialect
// set), then a fresh one is drawn the next day / next bucket. This keeps
// the welcome stable across reloads while still rotating through the pool
// over time.

const greetingStorageKey = (lng: string, bucket: TimeBucket) =>
  `sigma_greeting:${lng}:${bucket}`;

function localDayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getStickyGreeting(lng: string, bucket: TimeBucket): string | null {
  try {
    const raw = localStorage.getItem(greetingStorageKey(lng, bucket));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { phrase?: unknown; day?: unknown };
    if (
      typeof parsed?.phrase !== "string" ||
      !parsed.phrase ||
      parsed.day !== localDayString()
    ) {
      return null;
    }
    return parsed.phrase;
  } catch {
    return null;
  }
}

function setStickyGreeting(lng: string, bucket: TimeBucket, phrase: string) {
  try {
    localStorage.setItem(
      greetingStorageKey(lng, bucket),
      JSON.stringify({ phrase, day: localDayString() })
    );
  } catch {
    // Storage unavailable — greeting just reshuffles per open
  }
}

function drawPhrase(phrases: string[]): string {
  if (phrases.length === 0) return "";
  return phrases[Math.floor(Math.random() * phrases.length)];
}

// ─── Hook: useStudentGreeting ──────────────────────────────────────────────────────
//
// One phrase per time period, stable across page refreshes: picked ONCE
// per (dialect set, time bucket, day) and persisted, typed out once, left
// alone. No rotation.
//
// Dialect targeting: visitors in Jordan get the Jordanian-dialect phrases
// (the `ar` bundle); everyone else gets the English ones. The country is
// resolved via useIsInJordan — UI language and layout stay English/LTR
// regardless. The pick waits out a short grace window for that lookup so
// Jordanians don't see English flash first; past it we default to English.
//
// Async context upgrades the greeting without ever restarting it:
//   - Textbook recency gets a short grace window before picking, so
//     "welcome back / still in the zone" can be factored into the pick
//     itself; past that deadline we go with a time-based phrase instead of
//     stalling on a slow network.
//   - If the profile name arrives while typing and the target grows out of
//     the displayed prefix ({name} placeholders), the typewriter continues
//     seamlessly; after finishing, changes swap in silently.

const TYPE_SPEED_MS = 30; // ms per character
const CONTEXT_GRACE_MS = 1200; // how long to wait for textbook context

interface UseStudentGreetingOptions {
  name?: string;
}

function useStudentGreeting(options: UseStudentGreetingOptions = {}) {
  const { name = "there" } = options;
  const { t } = useTranslation("chat");
  const { textbooks, isLoading: isLoadingTextbooks } = useTextbooks();
  const inJordan = useIsInJordan();

  const [target, setTarget] = useState<string | null>(null); // unpicked phrase
  const [displayText, setDisplayText] = useState("");
  const displayRef = useRef("");
  displayRef.current = displayText;
  const typingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pickedRef = useRef(false);

  // Brief grace period for the textbook fetch, then proceed regardless.
  const [contextReady, setContextReady] = useState(false);
  useEffect(() => {
    if (!isLoadingTextbooks) {
      setContextReady(true);
      return;
    }
    const timer = setTimeout(() => setContextReady(true), CONTEXT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [isLoadingTextbooks]);

  // Same idea for the country lookup: Jordanians should get the dialect
  // phrases from the very first paint of the greeting, so give the IP
  // lookup a short grace window before defaulting to English.
  const [geoReady, setGeoReady] = useState(false);
  useEffect(() => {
    if (inJordan !== null) {
      setGeoReady(true);
      return;
    }
    const timer = setTimeout(() => setGeoReady(true), COUNTRY_RESOLVE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [inJordan]);

  // Pick THE phrase for this open — guarded by pickedRef so StrictMode's
  // double-invoke or late-arriving data can't repick mid-session.
  useEffect(() => {
    if (pickedRef.current || !contextReady || !geoReady) return;
    pickedRef.current = true;

    // Most recent activity across ALL textbooks — don't trust array order.
    const lastStudiedMs = textbooks.reduce(
      (max, book) => Math.max(max, Date.parse(book.updated_at) || 0),
      0
    );

    // Jordanian-dialect phrases (`ar` bundle) are Jordan-only.
    const phraseLng = inJordan === true ? "ar" : "en";

    let phrase: string | null = null;
    if (lastStudiedMs > 0) {
      const hoursSince = (Date.now() - lastStudiedMs) / 3600_000;
      if (hoursSince > 48)
        phrase = t("greeting.welcomeBack", { lng: phraseLng });
      else if (hoursSince < 2)
        phrase = t("greeting.stillInZone", { lng: phraseLng });
    }

    if (phrase === null) {
      const bucket = getCurrentBucket();
      // Refresh-stable: reuse today's already-picked phrase for this
      // bucket/dialect if we drew one earlier; otherwise draw and persist.
      const sticky = getStickyGreeting(phraseLng, bucket);
      if (sticky !== null) {
        phrase = sticky;
      } else {
        const phrases = t(`greeting.${bucket}`, {
          lng: phraseLng,
          returnObjects: true,
        }) as string[];
        phrase = drawPhrase(Array.isArray(phrases) ? phrases : []);
        if (phrase) setStickyGreeting(phraseLng, bucket, phrase);
      }
    }
    setTarget(phrase);
  }, [contextReady, geoReady, inJordan, textbooks, t]);

  // Fill {name} placeholders once the profile name is known.
  const fullText = useMemo(() => {
    if (target === null) return "";
    return target.replace(/\{name\}/g, name);
  }, [target, name]);

  // Type toward `fullText`:
  //   - nothing shown yet → start from scratch
  //   - mid-type and current text is a prefix → continue seamlessly
  //   - finished earlier → swap silently (never retype)
  // Honors prefers-reduced-motion by showing the final text immediately.
  useEffect(() => {
    if (!fullText) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayText(fullText);
      return;
    }

    const current = displayRef.current;
    let index: number;
    if (current === "") {
      index = 0;
    } else if (!typingRef.current) {
      setDisplayText(fullText);
      return;
    } else if (fullText.startsWith(current)) {
      index = current.length;
    } else {
      index = 0;
    }

    typingRef.current = true;
    let lastTick = 0;
    const step = (now: number) => {
      if (now - lastTick >= TYPE_SPEED_MS) {
        index += 1;
        setDisplayText(fullText.slice(0, index));
        lastTick = now;
      }
      if (index < fullText.length) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        typingRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      typingRef.current = false;
    };
  }, [fullText]);

  return { displayText };
}

// ─── Thread Welcome ────────────────────────────────────────────────────────────────

export const ThreadWelcome: FC = () => {
  const profile = useUserProfile();
  const userName = profile?.name?.split(" ")[0] || "there";
  const [isAnimating, setIsAnimating] = useState(false);

  // One greeting per chat open — picked from the current time bucket (with
  // study-aware overrides), typed once, and stays put. No rotation.
  const { displayText } = useStudentGreeting({ name: userName });

  const handleLogoClick = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 1800);
  };

  return (
    <div
      dir="ltr"
      className="fade-in slide-in-from-bottom-1 flex w-full min-w-0 animate-in fill-mode-both duration-200 flex-row items-center justify-center gap-4 select-none"
    >
      {/* Logo Container with Interactive Animation */}
      <div
        className="group relative shrink-0 cursor-pointer size-14 flex items-center justify-center"
        onClick={handleLogoClick}
        title="Click me!"
      >
        <style>{`
          @keyframes logoElasticSpin {
            0%   { transform: rotate(0deg) scale(1); }
            15%  { transform: rotate(-14deg) scale(0.92); }
            35%  { transform: rotate(18deg) scale(1.22); }
            55%  { transform: rotate(-8deg) scale(1.12); }
            75%  { transform: rotate(4deg) scale(1.04); }
            100% { transform: rotate(0deg) scale(1); }
          }
          @keyframes nodePopBounce {
            0%   { transform: scale(0); opacity: 0; }
            50%  { transform: scale(1.35); opacity: 1; }
            75%  { transform: scale(0.85); }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes centerCorePulse {
            0%   { transform: scale(1); opacity: 1; }
            30%  { transform: scale(2.2); opacity: 0.8; }
            60%  { transform: scale(0.8); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes lineFlowIn {
            0%   { stroke-dashoffset: 160; opacity: 0; }
            20%  { opacity: 1; }
            100% { stroke-dashoffset: 0; opacity: 1; }
          }
          @keyframes auraRingPing {
            0%   { r: 10; opacity: 0.9; stroke-width: 3.5; }
            100% { r: 38; opacity: 0;   stroke-width: 0.5; }
          }
          @keyframes sparkleFly {
            0%   { transform: translate(0, 0) scale(1); opacity: 1; }
            100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
          }

          .logo-svg-main {
            transform-origin: center center;
            transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .logo-svg-main:hover {
            transform: scale(1.08) rotate(3deg);
          }
          .logo-svg-main.is-active {
            animation: logoElasticSpin 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          }

          .logo-line-elem {
            stroke-dasharray: 160;
            stroke-dashoffset: 0;
          }
          .logo-line-elem.is-active {
            animation: lineFlowIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          }
          .line-d-1.is-active { animation-delay: 0.02s; }
          .line-d-2.is-active { animation-delay: 0.08s; }
          .line-d-3.is-active { animation-delay: 0.14s; }
          .line-d-4.is-active { animation-delay: 0.20s; }
          .line-d-5.is-active { animation-delay: 0.26s; }

          .node-dot {
            transform-box: fill-box;
            transform-origin: center;
          }
          .node-dot.is-active {
            animation: nodePopBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          }
          .node-d-1.is-active { animation-delay: 0.06s; }
          .node-d-2.is-active { animation-delay: 0.12s; }
          .node-d-3.is-active { animation-delay: 0.18s; }
          .node-d-4.is-active { animation-delay: 0.24s; }
          .node-d-5.is-active { animation-delay: 0.30s; }
          .node-d-6.is-active { animation-delay: 0.36s; }

          .center-core-node.is-active {
            animation: centerCorePulse 0.75s ease-out forwards;
          }

          .sparkle-dot {
            opacity: 0;
            pointer-events: none;
          }
          .sparkle-dot.is-active {
            animation: sparkleFly 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .sp-1.is-active { --dx: -22px; --dy: -22px; animation-delay: 0.08s; }
          .sp-2.is-active { --dx:  22px; --dy: -22px; animation-delay: 0.12s; }
          .sp-3.is-active { --dx:  24px; --dy:  20px; animation-delay: 0.16s; }
          .sp-4.is-active { --dx: -20px; --dy:  24px; animation-delay: 0.20s; }
          .sp-5.is-active { --dx:   0px; --dy: -28px; animation-delay: 0.10s; }
          .sp-6.is-active { --dx:  28px; --dy:   0px; animation-delay: 0.14s; }
          .sp-7.is-active { --dx:   0px; --dy:  28px; animation-delay: 0.18s; }
          .sp-8.is-active { --dx: -28px; --dy:   0px; animation-delay: 0.22s; }
        `}</style>

        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 100 100"
          className={cn("size-14 logo-svg-main", isAnimating && "is-active")}
          aria-hidden="true"
        >
          {/* Sparkle particle burst */}
          {isAnimating && (
            <>
              <circle cx="50" cy="50" r="3" fill="#BE1E2D" className="sparkle-dot sp-1 is-active" />
              <circle cx="50" cy="50" r="2.5" fill="#FF5E6D" className="sparkle-dot sp-2 is-active" />
              <circle cx="50" cy="50" r="3" fill="#BE1E2D" className="sparkle-dot sp-3 is-active" />
              <circle cx="50" cy="50" r="2" fill="#FFA8A8" className="sparkle-dot sp-4 is-active" />
              <circle cx="50" cy="50" r="2.5" fill="#BE1E2D" className="sparkle-dot sp-5 is-active" />
              <circle cx="50" cy="50" r="3" fill="#FF5E6D" className="sparkle-dot sp-6 is-active" />
              <circle cx="50" cy="50" r="2" fill="#BE1E2D" className="sparkle-dot sp-7 is-active" />
              <circle cx="50" cy="50" r="2.5" fill="#FFA8A8" className="sparkle-dot sp-8 is-active" />
            </>
          )}

          {/* Logo Main Structure */}
          <g>
            {/* Connecting Lines with animated draw effect */}
            <line
              x1="50"
              y1="23"
              x2="50"
              y2="77"
              stroke="#BE1E2D"
              strokeWidth="7"
              strokeLinecap="round"
              className={cn("logo-line-elem line-d-1", isAnimating && "is-active")}
            />
            <path
              d="M 50 23 L 26 50 L 50 77"
              stroke="#BE1E2D"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              className={cn("logo-line-elem line-d-2", isAnimating && "is-active")}
            />
            <path
              d="M 50 23 L 74 50 L 50 77"
              stroke="#BE1E2D"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              className={cn("logo-line-elem line-d-3", isAnimating && "is-active")}
            />
            <line
              x1="74"
              y1="50"
              x2="87"
              y2="37"
              stroke="#BE1E2D"
              strokeWidth="7"
              strokeLinecap="round"
              className={cn("logo-line-elem line-d-4", isAnimating && "is-active")}
            />
            <line
              x1="74"
              y1="50"
              x2="87"
              y2="63"
              stroke="#BE1E2D"
              strokeWidth="7"
              strokeLinecap="round"
              className={cn("logo-line-elem line-d-5", isAnimating && "is-active")}
            />

            {/* Outer Nodes with Staggered Elastic Pop */}
            <circle
              cx="50"
              cy="23"
              r="6.5"
              fill="#BE1E2D"
              className={cn("node-dot node-d-1", isAnimating && "is-active")}
            />
            <circle
              cx="50"
              cy="77"
              r="6.5"
              fill="#BE1E2D"
              className={cn("node-dot node-d-2", isAnimating && "is-active")}
            />
            <circle
              cx="26"
              cy="50"
              r="7.5"
              fill="#BE1E2D"
              className={cn("node-dot node-d-3", isAnimating && "is-active")}
            />
            <circle
              cx="74"
              cy="50"
              r="6.5"
              fill="#BE1E2D"
              className={cn("node-dot node-d-4", isAnimating && "is-active")}
            />
            <circle
              cx="87"
              cy="37"
              r="6.5"
              fill="#BE1E2D"
              className={cn("node-dot node-d-5", isAnimating && "is-active")}
            />
            <circle
              cx="87"
              cy="63"
              r="6.5"
              fill="#BE1E2D"
              className={cn("node-dot node-d-6", isAnimating && "is-active")}
            />

            {/* Central Node Core */}
            <circle
              cx="50"
              cy="50"
              r="4"
              fill="#BE1E2D"
              className={cn("node-dot center-core-node", isAnimating && "is-active")}
            />
          </g>
        </svg>
      </div>

      {/* Welcome Text — Dynamic Greeting */}
      <h1
        dir="auto"
        className="font-semibold text-3xl md:text-4xl break-words text-[#2C2825] relative inline-flex items-end"
      >
        {displayText || "\u00a0"}
      </h1>
    </div>
  );
};

// ─── Thread Suggestions ──────────────────────────────────────────────────────────

const ThreadSuggestionItem: FC = () => {
  const { t } = useTranslation("chat");
  // Match the pill language: dialect for Jordanians, English otherwise.
  const inJordan = useIsInJordan();

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const pills = document.querySelectorAll(".aui-thread-welcome-suggestion");
      const current = document.activeElement;
      const idx = Array.from(pills).indexOf(current as Element);
      const next =
        e.key === "ArrowRight"
          ? pills[idx + 1] || pills[0]
          : pills[idx - 1] || pills[pills.length - 1];
      (next as HTMLElement)?.focus();
    }
  };

  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="outline"
          size="sm"
          className="aui-thread-welcome-suggestion h-9 rounded-full border border-[#EBE5DF] bg-white px-4 text-sm text-[#2C2825] shadow-sm hover:bg-[#F9F6F0] hover:text-[#2C2825] transition-colors"
          aria-label={t("suggestion.sendAria", {
            lng: inJordan === true ? "ar" : "en",
          })}
          onKeyDown={handleKeyDown}
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex flex-wrap justify-center gap-2">
      <ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
    </div>
  );
};

// ─── Thread Scroll to Bottom ─────────────────────────────────────────────────────

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

// ─── New Messages Pill ──────────────────────────────────────────────────────────

const NewMessagesPill: FC<{
  count: number;
  onClick: () => void;
}> = ({ count, onClick }) => {
  if (count <= 0) return null;

  return (
    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-200">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={onClick}
            variant="outline"
            size="sm"
            className="aui-new-messages-pill rounded-full border-[#EBE5DF] bg-white/95 px-4 py-2 text-sm font-medium text-[#2C2825] shadow-lg backdrop-blur-sm transition-colors hover:bg-[#F9F6F0]"
            aria-label="Scroll to latest message"
          >
            <ArrowDownIcon className="mr-1.5 size-3.5" />
            New messages ({count})
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Jump to latest message</TooltipContent>
      </Tooltip>
    </div>
  );
};

// ─── Thread (Main Wrapper) ───────────────────────────────────────────────────────

export const Thread: FC<{
  isOnboarded: boolean;
  onCompleteOnboarding: (draftCourses: { course_name: string; credit_hours: number }[]) => Promise<void>;
  onSkipOnboarding?: () => void;
}> = ({ isOnboarded, onCompleteOnboarding, onSkipOnboarding }) => {
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { isLoadingMessages, activeThreadMessages, activeThreadId } = useChatHistory();

  // Show the welcome screen only when we're SURE the thread is empty.
  // The flash happens because:
  //   1. URL changes to ?thread=<id>
  //   2. Component remounts with empty AI SDK chat
  //   3. Render: s.thread.isEmpty=true, isLoadingMessages=false (useEffect hasn't run yet)
  //   4. → welcome flashes for 1 frame
  //   5. useEffect fires, fetch starts, messages load
  // We eliminate it by hiding the welcome whenever the URL points at a
  // thread — that means we have a real thread id, even if its messages
  // haven't arrived in the chat yet.
  const hasContextMessages = activeThreadMessages.length > 0;
  const hasUrlThread = activeThreadId !== null;
  const shouldShowWelcome =
    !hasContextMessages && !isLoadingMessages && !hasUrlThread;

  // Listen for keyboard shortcut events for message navigation
  useEffect(() => {
    const handlePreviousMessage = () => {
      // Scroll to previous message logic
      const messages = document.querySelectorAll('[data-role="assistant"], [data-role="user"]');
      if (messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last) {
          last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    };
    const handleNextMessage = () => {
      // Scroll to next message logic
      const messages = document.querySelectorAll('[data-role="assistant"], [data-role="user"]');
      if (messages.length > 0) {
        const first = messages[0];
        if (first) {
          first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    };

    window.addEventListener("sigma:navigate-previous-message", handlePreviousMessage);
    window.addEventListener("sigma:navigate-next-message", handleNextMessage);

    return () => {
      window.removeEventListener("sigma:navigate-previous-message", handlePreviousMessage);
      window.removeEventListener("sigma:navigate-next-message", handleNextMessage);
    };
  }, []);

  const {
    scrollContainerRef,
    scrollToBottom,
    newMessageCount,
    resetNewMessageCount,
  } = useSmartAutoScroll({
    messageCount,
    isRunning: isRunning,
  });

  return (
    <ThreadPrimitive.Root
      // Force LTR for the chat container so the layout (sidebar/main,
      // messages alignment, composer position) stays consistent regardless
      // of the user's document language. Individual message content can
      // still switch to RTL via `dir="auto"` when the user writes Arabic.
      dir="ltr"
      className="aui-root aui-thread-root flex h-full w-full min-w-0 flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "50rem",
      }}
    >
      {isOnboarded ? (
        <>
          <div className="relative min-h-0 flex-1">
          <ThreadPrimitive.Viewport
            turnAnchor="top"
            autoScroll={false}
            data-slot="aui_thread-viewport"
            dir="ltr"
            ref={scrollContainerRef}
            className="relative flex h-full flex-col overflow-x-auto overflow-y-auto scroll-smooth"
            style={{ direction: "ltr" }}
          >
            <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pt-4 md:px-7">
              <AuiIf condition={(s) => s.thread.isEmpty && shouldShowWelcome}>
                {/* Empty state: logo, greeting, composer and suggestions grouped and centered */}
                <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 pb-24">
                  <ThreadWelcome />
                  <ThreadComposer />
                  <ThreadSuggestions />
                </div>
              </AuiIf>

              <div data-slot="aui_message-group" className="mb-10 flex flex-col gap-y-8 empty:hidden">
                <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
              </div>

              <AuiIf condition={(s) => !s.thread.isEmpty}>
                <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer flex flex-col gap-4 overflow-visible bg-background pb-4">
                  <ThreadScrollToBottom />
                </ThreadPrimitive.ViewportFooter>
              </AuiIf>
            </div>

            <NewMessagesPill
              count={newMessageCount}
              onClick={() => {
                scrollToBottom();
                resetNewMessageCount();
              }}
            />
          </ThreadPrimitive.Viewport>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-background via-background/70 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background via-background/70 to-transparent" />
          </div>

          <AuiIf condition={(s) => !(s.thread.isEmpty && shouldShowWelcome)}>
            {/* Claude pins the composer flush to the window bottom — the
                disclaimer strip is the last thing on screen, so the message
                viewport gets every spare pixel. */}
            <div className="mx-auto w-full max-w-4xl px-4 pb-1 md:px-7 md:pb-1.5 bg-background">
              <ThreadComposer />
            </div>
          </AuiIf>

          <SelectionToolbar />
        </>
      ) : (
        <div className="flex flex-1 overflow-y-auto px-4 py-6">
          <OnboardingFlow
            onComplete={onCompleteOnboarding}
            onSkip={onSkipOnboarding}
          />
        </div>
      )}
    </ThreadPrimitive.Root>
  );
};