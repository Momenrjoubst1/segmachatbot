import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { FeedbackReasonCategory } from "./feedback-store";

const REASON_CATEGORIES: FeedbackReasonCategory[] = [
  "inaccurate",
  "not_helpful",
  "off_topic",
  "harmful",
  "other",
];

const COMMENT_MAX_LENGTH = 2000;

interface DislikeFeedbackDialogProps {
  open: boolean;
  messageId: string;
  onConfirm: (meta: { reasonCategory?: FeedbackReasonCategory; comment?: string }) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shown when a user thumbs-downs a response. Reason category and comment are
 * both optional — confirming without either still records the dislike.
 */
export const DislikeFeedbackDialog: FC<DislikeFeedbackDialogProps> = ({
  open,
  messageId,
  onConfirm,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState<FeedbackReasonCategory | null>(null);
  const [comment, setComment] = useState("");

  // Fresh state per message + per open so a stale draft never leaks across messages.
  useEffect(() => {
    if (open) {
      setReason(null);
      setComment("");
    }
  }, [open, messageId]);

  const handleConfirm = () => {
    onConfirm({
      ...(reason ? { reasonCategory: reason } : {}),
      ...(comment.trim() ? { comment: comment.trim().slice(0, COMMENT_MAX_LENGTH) } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" dir="auto">
        <DialogHeader>
          <DialogTitle>{t("chat:feedback.dislikeTitle")}</DialogTitle>
          <DialogDescription>{t("chat:feedback.dislikeDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" role="group" aria-label={t("chat:feedback.dislikeTitle")}>
          {REASON_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setReason((prev) => (prev === category ? null : category))}
              className={cn(
                "state-layer rounded-full border border-border/60 px-3 py-1.5 text-sm transition-colors",
                "hover:border-primary/40 hover:text-foreground",
                reason === category
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground",
              )}
              data-selected={reason === category || undefined}
            >
              {t(`chat:feedback.reason.${category}`)}
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={COMMENT_MAX_LENGTH}
          rows={3}
          placeholder={t("chat:feedback.commentPlaceholder")}
          className="w-full resize-none rounded-lg border border-border/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary/50"
        />

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("chat:feedback.cancel")}
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            {t("chat:feedback.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
