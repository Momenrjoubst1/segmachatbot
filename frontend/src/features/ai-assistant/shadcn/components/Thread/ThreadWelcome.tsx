
import { useState, type FC } from "react";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
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

// ─── Thread Welcome ──────────────────────────────────────────────────────────────

export const ThreadWelcome: FC = () => {
  const profile = useUserProfile();
  const userName = profile?.name?.split(" ")[0] || "there";
  const [isAnimating, setIsAnimating] = useState(false);

  const handleLogoClick = () => {
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 2500);
  };

  return (
    <div
      dir="ltr"
      className="flex w-full min-w-0 items-center justify-center gap-4 select-none"
    >
      {/* Logo */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        className="size-12 text-primary shrink-0 cursor-pointer transition-all duration-300"
        fill="currentColor"
        onClick={handleLogoClick}
        style={{
          transform: isAnimating ? 'scale(1.1)' : 'scale(1)',
          filter: isAnimating ? 'drop-shadow(0 8px 16px rgba(139, 92, 246, 0.4))' : 'none',
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
            animation: ${isAnimating ? 'pulse 0.8s ease-in-out infinite' : 'none'};
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
        <g style={{ opacity: isAnimating ? 1 : 0, transition: 'opacity 0.3s' }}>
          <line x1="50" y1="50" x2="50" y2="23" className="logo-line-animated logo-line-1" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="50" y1="50" x2="50" y2="77" className="logo-line-animated logo-line-2" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="50" y1="50" x2="26" y2="50" className="logo-line-animated logo-line-3" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="50" y1="50" x2="74" y2="50" className="logo-line-animated logo-line-4" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="74" y1="50" x2="87" y2="37" className="logo-line-animated logo-line-5" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="74" y1="50" x2="87" y2="63" className="logo-line-animated logo-line-6" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="50" y1="23" x2="26" y2="50" className="logo-line-animated logo-line-7" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="50" y1="77" x2="74" y2="50" className="logo-line-animated logo-line-8" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </g>
        
        {/* Original static logo */}
        <g style={{ opacity: isAnimating ? 0 : 1, transition: 'opacity 0.4s' }}>
          <line x1="50" y1="23" x2="50" y2="77" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <path d="M 50 23 L 26 50 L 50 77" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M 50 23 L 74 50 L 50 77" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="74" y1="50" x2="87" y2="37" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="74" y1="50" x2="87" y2="63" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </g>
        
        {/* Nodes - always visible */}
        <circle cx="50" cy="50" r="4" fill="currentColor" className="logo-center-node" />
        <circle cx="50" cy="23" r="6.5" fill="currentColor" />
        <circle cx="50" cy="77" r="6.5" fill="currentColor" />
        <circle cx="26" cy="50" r="7.5" fill="currentColor" />
        <circle cx="74" cy="50" r="6.5" fill="currentColor" />
        <circle cx="87" cy="37" r="6.5" fill="currentColor" />
        <circle cx="87" cy="63" r="6.5" fill="currentColor" />
      </svg>
      
      {/* Welcome Text */}
      <div className="fade-in slide-in-from-bottom-1 min-w-0 flex-1 animate-in fill-mode-both duration-200">
        <h1 className="font-semibold text-3xl md:text-4xl lg:text-5xl break-words">
          Hello {userName}
        </h1>
        <p className="mt-2 text-base md:text-lg text-muted-foreground break-words">
          How can I help you today?
        </p>
      </div>
    </div>
  );
};

// ─── Thread Suggestions ──────────────────────────────────────────────────────────

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="outline"
          size="sm"
          className="aui-thread-welcome-suggestion h-9 rounded-full border-white/10 bg-white/[0.03] px-4 text-sm text-white/80 hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex flex-wrap justify-center gap-2 mt-4">
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
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
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
      <Button
        onClick={onClick}
        variant="outline"
        size="sm"
        className="aui-new-messages-pill rounded-full border-white/10 bg-background/95 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm transition-colors hover:bg-accent"
      >
        <ArrowDownIcon className="mr-1.5 size-3.5" />
        New messages ({count})
      </Button>
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

  const {
    scrollContainerRef,
    scrollToBottom,
    newMessageCount,
    resetNewMessageCount,
  } = useSmartAutoScroll({
    messageCount,
    isStreaming: isRunning,
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
              <AuiIf condition={(s) => s.thread.isEmpty}>
                <div className="flex w-full flex-col items-center gap-6 pt-4">
                  <ThreadWelcome />
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
          
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:pb-6 bg-background">
            <ThreadComposer />
          </div>
          
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
