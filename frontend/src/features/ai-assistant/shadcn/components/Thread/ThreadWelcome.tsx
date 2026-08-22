import { useState, useEffect, useCallback, useRef, type FC, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

// ─── Time-Based Greeting System ────────────────────────────────────────────────────

type TimeBucket = "morning" | "afternoon" | "evening" | "lateNight";

// Get the current hour in the user's actual local timezone (IANA)
function getCurrentLocalHour(): number {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hourStr = new Date().toLocaleString("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
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

// ─── Hook: useStudentGreeting ──────────────────────────────────────────────────────

interface UseStudentGreetingOptions {
  name?: string;
  typewriterSpeed?: number; // ms per character
  rotateInterval?: number; // ms between phrase rotations (0 = no rotation)
}

function useStudentGreeting(options: UseStudentGreetingOptions = {}) {
  const { name = "there", typewriterSpeed = 35, rotateInterval = 0 } = options;
  const { t, i18n } = useTranslation("chat");
  const { textbooks, isLoading } = useTextbooks();

  const [displayText, setDisplayText] = useState("");
  const [currentPhrase, setCurrentPhrase] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const lastTimeRef = useRef(0);
  const phraseRef = useRef("");

  // Generate a new phrase (with study-aware logic)
  const generatePhrase = useCallback(() => {
    // Study-aware greetings based on textbook context
    if (!isLoading && textbooks.length > 0) {
      const latestBook = textbooks[0];
      const lastStudied = new Date(latestBook.updated_at);
      const hoursSince = (Date.now() - lastStudied.getTime()) / 3600_000;

      if (hoursSince > 48) {
        // Haven't studied in 2 days
        return t("greeting.welcomeBack");
      }
      if (hoursSince < 2) {
        // Just studied recently (2 hours threshold)
        return t("greeting.stillInZone");
      }
    }

    // Fallback to time-based
    const bucket = getCurrentBucket();
    const phrases = t(`greeting.${bucket}`, { returnObjects: true }) as string[];
    let phrase = phrases[Math.floor(Math.random() * phrases.length)];
    if (name && name !== "there") {
      phrase = phrase.replace("{name}", name);
    }
    return phrase;
  }, [name, t, i18n.language, textbooks, isLoading]);

  // Typewriter animation with requestAnimationFrame
  const typePhrase = useCallback(
    (phrase: string) => {
      setIsTyping(true);
      setCurrentPhrase(phrase);
      phraseRef.current = phrase;
      setDisplayText("");
      indexRef.current = 0;
      lastTimeRef.current = 0;

      const animate = (currentTime: number) => {
        if (lastTimeRef.current === 0) lastTimeRef.current = currentTime;
        const elapsed = currentTime - lastTimeRef.current;

        if (elapsed >= typewriterSpeed) {
          if (indexRef.current < phraseRef.current.length) {
            setDisplayText(phraseRef.current.slice(0, indexRef.current + 1));
            indexRef.current++;
            lastTimeRef.current = currentTime;
            animationFrameRef.current = requestAnimationFrame(animate);
          } else {
            setIsTyping(false);
          }
        } else {
          animationFrameRef.current = requestAnimationFrame(animate);
        }
      };

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    },
    [typewriterSpeed]
  );

  // Initial phrase + optional rotation
  useEffect(() => {
    typePhrase(generatePhrase());

    let rotationTimer: ReturnType<typeof setInterval> | null = null;
    if (rotateInterval > 0) {
      rotationTimer = setInterval(() => {
        typePhrase(generatePhrase());
      }, rotateInterval);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (rotationTimer) clearInterval(rotationTimer);
    };
  }, [generatePhrase, typePhrase, rotateInterval]);

  // Re-type when name changes
  useEffect(() => {
    typePhrase(generatePhrase());
  }, [name, generatePhrase, typePhrase]);

  return { displayText, isTyping, currentPhrase };
}

// ─── Thread Welcome ────────────────────────────────────────────────────────────────

export const ThreadWelcome: FC = () => {
  const profile = useUserProfile();
  const userName = profile?.name?.split(" ")[0] || "there";
  const [isAnimating, setIsAnimating] = useState(false);

  // Get dynamic greeting with typewriter effect
  const { displayText } = useStudentGreeting({
    name: userName,
    typewriterSpeed: 30,
    rotateInterval: 12000, // Enable rotation every 12 seconds
  });

  const handleLogoClick = () => {
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 2500);
  };

  return (
    <div
      dir="ltr"
      className="fade-in slide-in-from-bottom-1 flex w-full min-w-0 animate-in fill-mode-both duration-200 flex-row items-center justify-center gap-4 select-none"
    >
      {/* Logo */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        className="size-14 shrink-0 cursor-pointer transition-all duration-300"
        onClick={handleLogoClick}
        style={{
          color: "#BE1E2D",
          transform: isAnimating ? "scale(1.1)" : "scale(1)",
          filter: isAnimating
            ? "drop-shadow(0 8px 16px rgba(190, 30, 45, 0.4))"
            : "none",
        }}
      >
        <style>{`
          @keyframes drawLine {
            0% {
              stroke-dashoffset: 150;
              opacity: 0;
            }
            15% {
              opacity: 1;
            }
            100% {
              stroke-dashoffset: 0;
              opacity: 1;
            }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
          .logo-line-animated {
            stroke-dasharray: 150;
            animation: drawLine 0.6s ease-out forwards;
          }
          .logo-static {
            animation: fadeIn 0.4s ease-in forwards;
          }
          .logo-center-node {
            animation: ${isAnimating ? "pulse 0.8s ease-in-out infinite" : "none"};
          }
          .logo-line-1 { animation-delay: 0s; }
          .logo-line-2 { animation-delay: 0.1s; }
          .logo-line-3 { animation-delay: 0.2s; }
          .logo-line-4 { animation-delay: 0.3s; }
          .logo-line-5 { animation-delay: 0.4s; }
          .logo-line-6 { animation-delay: 0.5s; }
          .logo-line-7 { animation-delay: 0.6s; }
          .logo-line-8 { animation-delay: 0.7s; }
        `}</style>

        {/* Animated lines from center */}
        <g style={{ opacity: isAnimating ? 1 : 0, transition: "opacity 0.3s" }}>
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="23"
            className="logo-line-animated logo-line-1"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="77"
            className="logo-line-animated logo-line-2"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="50"
            x2="26"
            y2="50"
            className="logo-line-animated logo-line-3"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="50"
            x2="74"
            y2="50"
            className="logo-line-animated logo-line-4"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="74"
            y1="50"
            x2="87"
            y2="37"
            className="logo-line-animated logo-line-5"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="74"
            y1="50"
            x2="87"
            y2="63"
            className="logo-line-animated logo-line-6"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="23"
            x2="26"
            y2="50"
            className="logo-line-animated logo-line-7"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="50"
            y1="77"
            x2="74"
            y2="50"
            className="logo-line-animated logo-line-8"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </g>

        {/* Original static logo */}
        <g style={{ opacity: isAnimating ? 0 : 1, transition: "opacity 0.4s" }}>
          <line
            x1="50"
            y1="23"
            x2="50"
            y2="77"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M 50 23 L 26 50 L 50 77"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M 50 23 L 74 50 L 50 77"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <line
            x1="74"
            y1="50"
            x2="87"
            y2="37"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            x1="74"
            y1="50"
            x2="87"
            y2="63"
            stroke="#BE1E2D"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </g>

        {/* Nodes - always visible */}
        <circle cx="50" cy="50" r="4" fill="#BE1E2D" className="logo-center-node" />
        <circle cx="50" cy="23" r="6.5" fill="#BE1E2D" />
        <circle cx="50" cy="77" r="6.5" fill="#BE1E2D" />
        <circle cx="26" cy="50" r="7.5" fill="#BE1E2D" />
        <circle cx="74" cy="50" r="6.5" fill="#BE1E2D" />
        <circle cx="87" cy="37" r="6.5" fill="#BE1E2D" />
        <circle cx="87" cy="63" r="6.5" fill="#BE1E2D" />
      </svg>

      {/* Welcome Text — Dynamic Greeting */}
      <h1 className="font-semibold text-3xl md:text-4xl break-words text-[#2C2825] relative inline-flex items-end">
        {displayText || "Loading..."}
      </h1>
    </div>
  );
};

// ─── Thread Suggestions ──────────────────────────────────────────────────────────

const ThreadSuggestionItem: FC = () => {
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
          aria-label="Send suggestion"
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
          <ThreadPrimitive.Viewport
            turnAnchor="top"
            autoScroll={false}
            data-slot="aui_thread-viewport"
            dir="ltr"
            ref={scrollContainerRef}
            className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
            style={{ direction: "ltr" }}
          >
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-4">
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

          <AuiIf condition={(s) => !(s.thread.isEmpty && shouldShowWelcome)}>
            <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:pb-6 bg-background">
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