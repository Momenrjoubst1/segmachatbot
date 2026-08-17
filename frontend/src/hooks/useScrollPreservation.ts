
import { useRef, useCallback, useLayoutEffect, useEffect } from "react";

/**
 * Preserves scroll position per thread across remounts.
 *
 * Because `@assistant-ui/react`'s `useChatRuntime` requires a fresh transport
 * per thread, we intentionally keep the `key={chatKey}` pattern on
 * `AssistantChatInner`. This hook works **around** the remount by:
 *
 * 1. Saving the current viewport scroll position on every scroll event
 *    (stored in a ref Map keyed by threadId — survives across remounts
 *    because the ref lives in the parent component).
 * 2. After each mount / thread change, restoring the saved position
 *    via `useLayoutEffect` (synchronous, so no visual jank).
 *
 * Usage in the parent (does NOT remount):
 * ```tsx
 * const { scrollRef, onThreadChange } = useScrollPreservation(activeThreadId);
 * // When activeThreadId changes, call onThreadChange(previousId, newId)
 * ```
 */

const VIEWPORT_SELECTOR = '[data-slot="aui_thread-viewport"]';
const SCROLL_STORAGE_PREFIX = "chat_scroll_";
const SCROLL_STORAGE_THROTTLE_MS = 300;

/**
 * Reads a scroll position that survives a full page refresh (sessionStorage),
 * keyed per thread. Returns undefined when nothing was persisted.
 */
function readPersistedScroll(key: string): number | undefined {
  try {
    const raw = sessionStorage.getItem(SCROLL_STORAGE_PREFIX + key);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writePersistedScroll(key: string, scrollTop: number): void {
  try {
    sessionStorage.setItem(SCROLL_STORAGE_PREFIX + key, String(scrollTop));
  } catch {
    // sessionStorage full/unavailable — in-memory preservation still works
  }
}

export function useScrollPreservation(activeThreadId: string | null) {
  /** Map<threadId | "__new__", scrollTop> — persists across child remounts */
  const scrollPositions = useRef<Map<string, number>>(new Map());
  /** The DOM element currently acting as the scroll viewport */
  const viewportEl = useRef<HTMLElement | null>(null);
  /** Last sessionStorage write timestamp — writes are throttled */
  const lastPersistRef = useRef(0);

  // ── Save scroll on every scroll event ────────────────────────────
  const handleScroll = useCallback(() => {
    const el = viewportEl.current;
    if (!el) return;
    const key = activeThreadId ?? "__new__";
    scrollPositions.current.set(key, el.scrollTop);
    const now = Date.now();
    if (now - lastPersistRef.current >= SCROLL_STORAGE_THROTTLE_MS) {
      lastPersistRef.current = now;
      writePersistedScroll(key, el.scrollTop);
    }
  }, [activeThreadId]);

  // ── Callback ref to attach to the viewport element ───────────────
  // Instead of a traditional ref, we use a callback ref so we can
  // attach the scroll listener as soon as the element mounts.
  const scrollRef = useCallback(
    (node: HTMLElement | null) => {
      // Detach from previous element
      if (viewportEl.current) {
        viewportEl.current.removeEventListener("scroll", handleScroll as EventListener);
      }

      viewportEl.current = node;

      if (node) {
        node.addEventListener("scroll", handleScroll as EventListener, { passive: true } as AddEventListenerOptions);
      }
    },
    [handleScroll],
  );

  // ── Imperative save / restore helpers ────────────────────────────
  const saveCurrentPosition = useCallback(() => {
    const el = viewportEl.current;
    if (!el) return;
    const key = activeThreadId ?? "__new__";
    scrollPositions.current.set(key, el.scrollTop);
  }, [activeThreadId]);

  const restorePosition = useCallback(
    (threadId: string | null) => {
      const key = threadId ?? "__new__";
      // In-memory first (exact), then sessionStorage (survives F5)
      const saved = scrollPositions.current.get(key) ?? readPersistedScroll(key);

      // Try the captured ref first, then fall back to DOM query
      const el = viewportEl.current ?? document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
      if (!el) return;

      if (saved !== undefined) {
        el.scrollTop = saved;
      } else {
        // No saved position for this thread → scroll to bottom
        el.scrollTop = el.scrollHeight;
      }
    },
    [],
  );

  // ── Auto-restore after mount ─────────────────────────────────────
  // Because the child component remounts on thread switch, the viewport
  // DOM element is recreated. We use useLayoutEffect (synchronous) to
  // find and restore the scroll position before the browser paints.
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (el && !viewportEl.current) {
      viewportEl.current = el;
      el.addEventListener("scroll", handleScroll as EventListener, { passive: true } as AddEventListenerOptions);
    }
    if (el) {
      restorePosition(activeThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleScroll is derived from activeThreadId, already in deps
  }, [activeThreadId]);

  // ── Cleanup ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (viewportEl.current) {
        viewportEl.current.removeEventListener("scroll", handleScroll as EventListener);
      }
    };
  }, [handleScroll]);

  /**
   * Call this when the active thread is about to change.
   * It saves the current thread's scroll position so it can be restored later.
   */
  const onThreadChange = useCallback(
    (previousThreadId: string | null, _nextThreadId: string | null) => {
      // Save current position under the previous thread's key
      const el = viewportEl.current ?? document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
      if (el) {
        const key = previousThreadId ?? "__new__";
        const top = el.scrollTop;
        scrollPositions.current.set(key, top);
        writePersistedScroll(key, top);
      }
    },
    [],
  );

  return {
    /** Callback ref to attach to the scroll viewport element */
    scrollRef,
    /** Call when switching threads to save the outgoing thread's position */
    onThreadChange,
    /** Imperatively save the current scroll position */
    saveCurrentPosition,
    /** Imperatively restore scroll position for a given thread */
    restorePosition,
  };
}
