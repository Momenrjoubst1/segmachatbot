
import { useRef, useCallback, useEffect, useState } from "react";

const NEAR_BOTTOM_THRESHOLD = 100;

interface UseSmartAutoScrollOptions {
  /** Number of messages currently in the thread */
  messageCount: number;
  /** Whether the AI is currently streaming */
  isRunning: boolean;
}

interface UseSmartAutoScrollReturn {
  /** Ref to attach to the scrollable container */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the viewport is near the bottom (within threshold) */
  isNearBottom: boolean;
  /** Imperatively scroll to the bottom */
  scrollToBottom: () => void;
  /** Number of new messages that arrived while user was scrolled up */
  newMessageCount: number;
  /** Reset the new message counter (called when user clicks the pill) */
  resetNewMessageCount: () => void;
}

export function useSmartAutoScroll({
  messageCount,
  isRunning,
}: UseSmartAutoScrollOptions): UseSmartAutoScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(messageCount);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  // Refs mirroring the values the streaming follower needs, so the
  // MutationObserver isn't re-created on every render.
  const isNearBottomRef = useRef(true);
  const isRunningRef = useRef(isRunning);

  const checkIfNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const resetNewMessageCount = useCallback(() => {
    setNewMessageCount(0);
  }, []);

  // Track scroll position
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const nearBottom = checkIfNearBottom();
      isNearBottomRef.current = nearBottom;
      setIsNearBottom(nearBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [checkIfNearBottom]);

  // ── Streaming follower ────────────────────────────────────────────────────
  // During streaming the message COUNT doesn't change while a long answer
  // grows — so the messageCount effect below alone would let the text run
  // past the bottom of the viewport. Watch the DOM for content growth and,
  // as long as the user is near the bottom, keep the view pinned there
  // (the same behavior as world-class chat UIs). One rAF-throttled scroll
  // per frame, and it stops following the moment the user scrolls up.
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof MutationObserver === "undefined") return;

    let scrollFrame: number | null = null;

    const observer = new MutationObserver(() => {
      if (!isRunningRef.current || !isNearBottomRef.current) return;
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        const node = scrollContainerRef.current;
        if (!node || !isRunningRef.current || !isNearBottomRef.current) return;
        node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
      });
    });

    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    };
  }, []);

  // Detect new messages and auto-scroll if near bottom
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newMessagesAdded = messageCount - prevCount;

    if (newMessagesAdded > 0) {
      if (isNearBottom && isRunning) {
        // User is near bottom and streaming → auto-scroll
        requestAnimationFrame(() => {
          const el = scrollContainerRef.current;
          if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
          }
        });
      } else if (!isNearBottom) {
        // User scrolled up → increment counter
        setNewMessageCount((prev) => prev + newMessagesAdded);
      }
    }

    prevMessageCountRef.current = messageCount;
  }, [messageCount, isNearBottom, isRunning]);

  // Reset counter when user scrolls to bottom
  useEffect(() => {
    if (isNearBottom) {
      setNewMessageCount(0);
    }
  }, [isNearBottom]);

  return {
    scrollContainerRef,
    isNearBottom,
    scrollToBottom,
    newMessageCount,
    resetNewMessageCount,
  };
}
