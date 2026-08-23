import { create } from "zustand";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth";
import i18n from "@/i18n/i18next";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

/** Tri-state rating for a message; `none` = explicitly removed. */
export type FeedbackValue = "like" | "dislike" | "none";

export type FeedbackReasonCategory =
  | "inaccurate"
  | "harmful"
  | "not_helpful"
  | "off_topic"
  | "other";

export interface DislikeMeta {
  reasonCategory?: FeedbackReasonCategory;
  comment?: string;
}

interface SubmitFeedbackArgs {
  messageId: string;
  /** What the UI currently shows — used to build a same-type toggle-off request. */
  current: FeedbackValue;
  next: FeedbackValue;
  meta?: DislikeMeta;
  /**
   * Called after a confirmed save so callers can mirror the value into their
   * own caches (e.g. ChatHistoryContext message rows).
   */
  onSynced?: (value: number | null) => void;
}

interface MessageFeedbackState {
  /**
   * Optimistic overrides keyed by message id. An absent key means "fall back
   * to the DB value"; an explicit `none` means the user removed their rating.
   */
  overrides: Record<string, FeedbackValue>;
  submitFeedback: (args: SubmitFeedbackArgs) => Promise<void>;
}

/**
 * Server contract (POST /api/feedback/message): submitting the same type that
 * is already stored toggles the rating OFF; a different type upserts.
 */
export const useMessageFeedback = create<MessageFeedbackState>((set, get) => ({
  overrides: {},

  submitFeedback: async ({ messageId, current, next, meta, onSynced }) => {
    const previous = get().overrides[messageId];
    const isPositive = next === "like" ? true : next === "dislike" ? false : current === "like";

    // Optimistic update — icons reflect the click immediately.
    set((s) => ({ overrides: { ...s.overrides, [messageId]: next } }));

    try {
      // authFetch (not getAssistantAuthHeaders): retries once with a refreshed
      // token on 401, matching every other authenticated call in the app.
      const res = await authFetch(`${BACKEND_URL}/api/feedback/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          isPositive,
          ...(next === "dislike" && meta?.reasonCategory
            ? { reasonCategory: meta.reasonCategory }
            : {}),
          ...(next === "dislike" && meta?.comment ? { comment: meta.comment } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSynced?.(
        next === "none" ? null : isPositive ? 1 : -1,
      );
    } catch (err) {
      // Revert the optimistic update so the icon reflects reality again.
      set((s) => {
        const overrides = { ...s.overrides };
        if (previous === undefined) delete overrides[messageId];
        else overrides[messageId] = previous;
        return { overrides };
      });
      console.warn("[feedback] failed to save message feedback", err);
      toast.error(i18n.t("chat:feedback.saveFailed"));
    }
  },
}));
