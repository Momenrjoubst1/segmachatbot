
import { useRef, useCallback, useEffect, useState } from "react";

const NEAR_BOTTOM_THRESHOLD = 100;

interface UseSmartAutoScrollOptions {
  /** Number of messages currently in the thread */
  messageCount: number;
  /** Whether the AI is currently streaming */
  isStreaming: boolean;
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
  isStreaming,
}: UseSmartAutoScrollOptions): UseSmartAutoScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(messageCount);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

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
      setIsNearBottom(nearBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [checkIfNearBottom]);

  // Detect new messages and auto-scroll if near bottom
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newMessagesAdded = messageCount - prevCount;

    if (newMessagesAdded > 0) {
      if (isNearBottom && isStreaming) {
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
  }, [messageCount, isNearBottom, isStreaming]);

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
