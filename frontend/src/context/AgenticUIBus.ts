/**
 * AgenticUIBus — The "Octopus" event bus for real-time UI execution.
 *
 * Architecture:
 *   Backend "Head" emits <ui_action> payloads in the text stream →
 *   Frontend stream parser extracts them →
 *   dispatchUIAction() pushes to this Zustand store →
 *   Sub-components ("Tentacles") subscribe via useAgenticAction() and execute.
 *
 * Each action has a `target` (which component) and an `action` (what to do),
 * plus an optional typed `payload`.
 */

import { create } from "zustand";
import { useEffect, useRef } from "react";

// ─── Action Type Map ──────────────────────────────────────────────────────────────

export interface AgenticUIActionMap {
  "sidebar": {
    OPEN_THREAD: { threadId: string };
  };
  "composer": {
    SET_TEXT: { text: string };
    FOCUS: {};
  };
  "header": {
    TOGGLE_RAG: {};
    SET_VIEW: { view: "chat" | "calendar" };
  };
  "panel": {
    OPEN_CALENDAR: {};
    OPEN_TASKS: {};
    OPEN_EMAIL: {};
    OPEN_ARTIFACTS: { artifactId?: string };
  };
  "study": {
    /** Open the study dialog on a specific tab (defaults to the daily plan). */
    OPEN_STUDY: {
      tab?: "curriculum" | "quiz" | "flashcards" | "progress" | "daily";
      courseId?: string;
    };
    OPEN_FLASHCARDS: { courseId?: string };
    OPEN_DAILY_PLAN: {};
    /** Open the Study Map directly on its quiz tab. */
    OPEN_QUIZ: { courseId?: string };
  };
}

// ─── Generic Action Type ──────────────────────────────────────────────────────────

export type AgenticUIAction = {
  [T in keyof AgenticUIActionMap]: {
    [A in keyof AgenticUIActionMap[T]]: {
      target: T;
      action: A;
      payload: AgenticUIActionMap[T][A];
    };
  }[keyof AgenticUIActionMap[T]];
}[keyof AgenticUIActionMap];

// ─── Store State ──────────────────────────────────────────────────────────────────

interface AgenticUIBusState {
  /** The most recently dispatched action (null until first dispatch). */
  lastAction: AgenticUIAction | null;
  /** Monotonically increasing counter — forces re-render on every dispatch. */
  _actionTick: number;
  /** Dispatch a new UI action to all subscribed tentacles. */
  dispatch: (action: AgenticUIAction) => void;
}

// ─── Zustand Store ────────────────────────────────────────────────────────────────

export const useAgenticUIBus = create<AgenticUIBusState>((set) => ({
  lastAction: null,
  _actionTick: 0,
  dispatch: (action: AgenticUIAction) =>
    set((state) => ({
      lastAction: action,
      _actionTick: state._actionTick + 1,
    })),
}));

// ─── Imperative dispatch (for use outside React components) ───────────────────────

/**
 * Dispatch a UI action to the Octopus bus from anywhere (stream parser, etc.).
 * Safe to call before any component mounts — the store is a module singleton.
 */
export function dispatchUIAction(action: AgenticUIAction): void {
  useAgenticUIBus.getState().dispatch(action);
}

// ─── React Hook: Subscribe to actions for a specific target ───────────────────────

/**
 * Subscribe to AgenticUI actions for a specific target component.
 *
 * @param target  The component target (e.g. "sidebar", "composer", "header", "panel")
 * @param handler Callback invoked when a matching action arrives
 *
 * @example
 * ```tsx
 * useAgenticAction("header", (action) => {
 *   if (action.action === "TOGGLE_RAG") toggleRag();
 *   if (action.action === "SET_VIEW")   setActiveView(action.payload.view);
 * });
 * ```
 */
export function useAgenticAction<T extends keyof AgenticUIActionMap>(
  target: T,
  handler: (
    action: Extract<AgenticUIAction, { target: T }>,
  ) => void,
): void {
  const tick = useAgenticUIBus((s) => s._actionTick);
  const lastAction = useAgenticUIBus((s) => s.lastAction);
  const processedRef = useRef(0);

  useEffect(() => {
    // Only fire if this is a new action we haven't processed yet
    if (tick > processedRef.current && lastAction?.target === target) {
      processedRef.current = tick;
      try {
        handler(lastAction as Extract<AgenticUIAction, { target: T }>);
      } catch (err) {
        console.warn(
          `[AgenticUIBus] Handler error for ${target}/${String((lastAction as { action: string }).action)}:`,
          err,
        );
      }
    }
  }, [tick, lastAction, target, handler]);
}
