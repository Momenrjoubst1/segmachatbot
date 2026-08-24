
import {
  UserMessageAttachments,
} from "../../../ui/attachment";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ui/core/ErrorBoundary";
import { MarkdownText } from "../../../ui/markdown-text";
import { Perspective } from "@/components/ui/perspective-highlight";
import { MessageTiming } from "../../../ui/message-timing";
import { BotStatusInline } from "../../../ui/bot-activity/components/BotStatusInline";
import { MessageSkeleton } from "../../../ui/bot-activity/components/MessageSkeleton";
import { ThinkingBlock } from "../../../ui/bot-activity/components/ThinkingBlock";
import { splitThinkBlocks } from "../../../ui/bot-activity/thinkTags";
import type {
  AuiReasoningPart,
  AuiTextPart,
} from "../../../ui/bot-activity/types";
import { QuoteBlock } from "../../../ui/quote";
import { DirectiveText } from "../../../ui/directive-text";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  useAuiState,
} from "../../../shims/assistant-ui-compat-shim";
import {
  AlertTriangleIcon,
  BoxIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatHistory } from "@/hooks/useChatHistory";
import {
  useMessageFeedback,
  type DislikeMeta,
  type FeedbackValue,
} from "../../../ui/feedback-store";
import { DislikeFeedbackDialog } from "../../../ui/feedback-dislike-dialog";
import { useGuestMode } from "@/context/GuestModeContext";
import { type DirectiveChipProps } from "@assistant-ui/react-lexical";
import { WrenchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAssistantSettings } from "../../../context/AssistantSettingsContext";
import { cn } from "@/lib/cn";

// ─── Directive Chip (shared between Composer and EditComposer) ────────────────────

export function DirectiveChip(props: DirectiveChipProps) {
  const { directiveId, directiveType, label } = props;
  const showWrench = directiveType !== "command";

  return (
    <span
      className="aui-directive-chip"
      data-directive-type={directiveType}
      data-directive-id={directiveId}
    >
      {showWrench && (
        <span className="aui-directive-chip-icon">
          <WrenchIcon className="size-3" />
        </span>
      )}
      <span className="aui-directive-chip-label">{label}</span>
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────────

/**
 * Classify a fetch/transport error into something the user can act on.
 *
 * The raw `TypeError: Failed to fetch` thrown by the browser when the
 * server is unreachable is technically correct but useless to end users.
 * Returns i18n keys for the caller to translate.
 */
function classifyFetchError(raw: string): {
  titleKey: string;
  detailKey: string;
  kind: "network" | "auth" | "rate" | "server" | "generic";
} {
  const lower = (raw || "").toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("network request failed")
  ) {
    return {
      kind: "network",
      titleKey: "serverUnavailable",
      detailKey: "serverUnavailableDetail",
    };
  }

  if (lower.includes("401") || lower.includes("unauthorized")) {
    return {
      kind: "auth",
      titleKey: "sessionExpired",
      detailKey: "sessionExpiredDetail",
    };
  }

  if (lower.includes("429") || lower.includes("rate limit")) {
    return {
      kind: "rate",
      titleKey: "rateLimited",
      detailKey: "rateLimitedDetail",
    };
  }

  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("internal server") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable")
  ) {
    return {
      kind: "server",
      titleKey: "serverError",
      detailKey: "serverErrorDetail",
    };
  }

  return {
    kind: "generic",
    titleKey: "processingError",
    detailKey: "tryAgain",
  };
}

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 flex flex-col gap-1.5 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
        <FriendlyErrorMessage />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const FriendlyErrorMessage: FC = () => {
  const raw = useAuiState((s) => ((s.message.status as Record<string, unknown>)?.error as Record<string, unknown>)?.message ?? "") as string;
  const info = useMemo(() => classifyFetchError(raw), [raw]);
  const { t } = useTranslation("errors");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(console.error);
  }, [raw]);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-medium">{t(info.titleKey)}</span>
        <div className="ml-auto flex items-center gap-1">
          <ActionBarPrimitive.Reload asChild>
            <button
              className="state-layer inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors"
              title={t("retry", "Retry")}
            >
              <RefreshCwIcon className="h-3 w-3" />
              {t("retry", "Retry")}
            </button>
          </ActionBarPrimitive.Reload>
          <button
            onClick={handleCopy}
            className="state-layer inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive transition-colors"
            title={t("copyDetails", "Copy error details")}
          >
            <CopyIcon className="h-3 w-3" />
            {copied ? t("copied", "Copied") : t("copyDetails", "Copy")}
          </button>
        </div>
      </div>
      <div className="text-xs leading-relaxed opacity-90">{t(info.detailKey)}</div>
      <details className="mt-1 text-[11px] opacity-60">
        <summary className="cursor-pointer select-none">{t("technicalDetails", "Technical Details")}</summary>
        <ErrorPrimitive.Message className="aui-message-error-message mt-1 break-words font-mono text-[11px]" />
      </details>
    </>
  );
};

const AssistantStatusLine: FC<{ onRetry: () => void }> = ({ onRetry }) => {
  return <BotStatusInline onRetry={onRetry} />;
};

export const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous version">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        Version <BranchPickerPrimitive.Number /> of <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next version">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const ActionBarButton: FC<{ tooltip: string; className?: string; onClick?: () => void; children: React.ReactNode }> = ({ tooltip, className, onClick, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button className={cn("state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors", className)} onClick={onClick}>
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{tooltip}</TooltipContent>
  </Tooltip>
);

const AssistantActionBar: FC = () => {
  const { disable3D, toggle3D } = useAssistantSettings();
  const { t } = useTranslation();
  const { isGuestMode } = useGuestMode();
  const isCopied = useAuiState((s) => s.message.isCopied);
  const messageId = useAuiState((s) => s.message.id);
  const { activeThreadMessages, upsertMessage } = useChatHistory();
  const overrides = useMessageFeedback((s) => s.overrides);
  const submitFeedback = useMessageFeedback((s) => s.submitFeedback);
  const [dislikeOpen, setDislikeOpen] = useState(false);

  // Displayed value = optimistic override (if any), else the DB rating that
  // arrived with the loaded messages. `none` in the map means explicitly removed.
  const chatMessage = activeThreadMessages?.find((m) => m.id === messageId);
  const dbValue: FeedbackValue =
    chatMessage?.feedback === 1 ? "like" : chatMessage?.feedback === -1 ? "dislike" : "none";
  const current: FeedbackValue = (messageId && overrides[messageId]) || dbValue;
  const isPositive = current === "like";
  const isNegative = current === "dislike";

  // Mirror confirmed ratings into the messages cache so thread switches
  // and reloads keep the icons consistent.
  const syncToCache = useCallback(
    (value: number | null) => {
      if (!messageId || !activeThreadMessages?.some((m) => m.id === messageId)) return;
      upsertMessage(messageId, (m) => ({ ...m, feedback: value }));
    },
    [activeThreadMessages, messageId, upsertMessage],
  );

  const handlePositive = useCallback(() => {
    if (!messageId) return;
    void submitFeedback({
      messageId,
      current,
      next: isPositive ? "none" : "like",
      onSynced: syncToCache,
    });
  }, [submitFeedback, messageId, current, isPositive, syncToCache]);

  const handleNegative = useCallback(() => {
    if (!messageId) return;
    // Already disliked → same-type click toggles it off; otherwise ask why.
    if (isNegative) {
      void submitFeedback({ messageId, current, next: "none", onSynced: syncToCache });
      return;
    }
    setDislikeOpen(true);
  }, [submitFeedback, messageId, current, isNegative, syncToCache]);

  const handleDislikeConfirm = useCallback(
    (meta: DislikeMeta) => {
      setDislikeOpen(false);
      void submitFeedback({ messageId, current, next: "dislike", meta, onSynced: syncToCache });
    },
    [submitFeedback, messageId, current, syncToCache],
  );

  return (
    <>
    <ActionBarPrimitive.Root
      hideWhenRunning
      className="message-action-bar aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarButton
        tooltip={disable3D ? t("chat.enable3D", "Enable 3D effect") : t("chat.disable3D", "Disable 3D effect")}
        onClick={toggle3D}
        className={!disable3D ? "text-primary" : undefined}
      >
        <BoxIcon className="size-4" />
      </ActionBarButton>

      <ActionBarPrimitive.Copy asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors">
              {isCopied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy</TooltipContent>
        </Tooltip>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCwIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Retry</TooltipContent>
        </Tooltip>
      </ActionBarPrimitive.Reload>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handlePositive}
            disabled={isGuestMode || !messageId}
            aria-pressed={isPositive}
            className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <ThumbsUpIcon className={cn("size-4", isPositive && "fill-current")} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("chat:feedback.helpful")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleNegative}
            disabled={isGuestMode || !messageId}
            aria-pressed={isNegative}
            className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <ThumbsDownIcon className={cn("size-4", isNegative && "fill-current")} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("chat:feedback.notHelpful")}</TooltipContent>
      </Tooltip>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <ActionBarButton tooltip="More" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon className="size-4" />
          </ActionBarButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming />
    </ActionBarPrimitive.Root>
      {/* Rendered outside ActionBarPrimitive.Root — the bar unmounts while a
          run is active, and the dialog must not. */}
      <DislikeFeedbackDialog
        open={dislikeOpen}
        messageId={messageId}
        onConfirm={handleDislikeConfirm}
        onOpenChange={setDislikeOpen}
      />
    </>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="message-action-bar aui-user-action-bar-root absolute top-1 right-1 z-10 flex items-center"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit size-7 rounded-full bg-background/80 hover:bg-background border shadow-sm">
          <PencilIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-3xl flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <LexicalComposerInput
          directiveChip={DirectiveChip}
          autoFocus
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none [&_.aui-directive-chip-icon]:self-center [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:text-blue-700 [&_.aui-directive-chip]:leading-none [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none"
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

// ─── Exported Message Components ──────────────────────────────────────────────────

export const UserMessage: FC = () => {
  const status = useAuiState((s) => s.message.status);
  const hasError = (status as Record<string, unknown>)?.type === "error" || (status as Record<string, unknown>)?.type === "failed";
  const branchCount = useAuiState(
    (s) => (s.message as Record<string, unknown>).branchCount as number | undefined,
  );
  const isForked = (branchCount ?? 1) > 1;
  const { t } = useTranslation();

  return (
    <ErrorBoundary fallback={<div className="text-destructive text-sm p-2">Failed to render user message</div>}>
      <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 mx-auto grid w-full min-w-0 max-w-3xl animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 group">
        <div
          className={cn(
            "message-hover-wrapper",
            "aui-user-message-content wrap-break-word peer rounded-2xl bg-primary/10 border px-4 py-2.5 text-foreground empty:hidden shadow-sm",
            hasError
              ? "border-destructive bg-destructive/5"
              : isForked
                ? "border-l-2 border-l-blue-400 border-primary/20"
                : "border-primary/20",
          )}
          dir="auto"
        >
          <MessagePrimitive.Quote>{(quote) => <QuoteBlock {...quote} />}</MessagePrimitive.Quote>
          <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
          <UserActionBar />
        </div>
        {isForked && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <span>This created a new branch. Use ← → to navigate between versions.</span>
          </div>
        )}
      </div>

      {hasError && (
        <div className="col-start-2 mt-1 flex items-center gap-1.5 text-xs text-destructive">
          <span>{t("failedToSend", "Failed to send")}</span>
          <ActionBarPrimitive.Reload asChild>
            <button
              className="state-layer inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-destructive transition-colors"
              title={t("retry", "Retry")}
            >
              <RefreshCwIcon className="h-3 w-3" />
              {t("retry", "Retry")}
            </button>
          </ActionBarPrimitive.Reload>
        </div>
      )}

<BranchPicker
          data-slot="aui_user-branch-picker"
          className="col-span-full col-start-1 row-start-3 -mr-1 justify-end"
        />
      </MessagePrimitive.Root>
    </ErrorBoundary>
  );
};

export const AssistantMessage: FC = () => {
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;
  const { disable3D } = useAssistantSettings();
  const messageId = useAuiState((s) => s.message.id);
  const { activeThreadMessages } = useChatHistory();
  const chatMessage = activeThreadMessages?.find((m) => m.id === messageId) as { interrupted?: boolean } | undefined;

  const handleRetryInterrupted = useCallback(() => {
    reloadBtnRef.current?.click();
  }, []);

  const handleRetryFromStatus = useCallback(() => {
    reloadBtnRef.current?.click();
  }, []);

  const reloadBtnRef = useRef<HTMLButtonElement | null>(null);

  // Code-block "Regenerate" dispatches this event (see markdown-text.tsx);
  // clicking the hidden Reload button re-runs generation for THIS message.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ messageId?: string }>).detail;
      if (detail?.messageId === messageId) {
        reloadBtnRef.current?.click();
      }
    };
    window.addEventListener("sigma:reload-message", handler);
    return () => window.removeEventListener("sigma:reload-message", handler);
  }, [messageId]);

  return (
    <ErrorBoundary fallback={<div className="text-destructive text-sm p-2">Failed to render assistant message</div>}>
      <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative mx-auto w-full min-w-0 max-w-3xl animate-in duration-150"
    >
      {/* Hidden reload trigger — programmatic regeneration for this message
          (code-block Regenerate button + interrupted-retry path). */}
      <ActionBarPrimitive.Reload asChild>
        <button ref={reloadBtnRef} className="hidden" aria-label="Retry" data-testid="assistant-reload" />
      </ActionBarPrimitive.Reload>
      <div className="message-hover-wrapper px-1 py-0.5 -mx-1 -my-0.5">
        <div
          data-slot="aui_assistant-message-content"
          className="wrap-break-word px-2 text-[15.5px] leading-8 text-foreground md:text-base"
          dir="auto"
        >
          {/* Status indicator anchored at the TOP of the message bubble so
              it doesn't get pushed down by streaming text — Claude.ai style.
              Idle state renders null, so no extra space when the message is done. */}
          <AssistantStatusLine onRetry={handleRetryFromStatus} />
          <MessagePrimitive.Parts>
            {({ part }) => {
              // Native reasoning parts (e.g. Gemini thoughts streamed via
              // the AI SDK) → collapsible thinking block.
              if (part.type === "reasoning") {
                const r = part as AuiReasoningPart;
                return (
                  <ThinkingBlock
                    text={r.text}
                    running={r.status?.type === "running"}
                  />
                );
              }
              if (part.type === "text") {
                // OpenAI-compat reasoning arrives folded into the text as
                // <think>…</think> — split it out before rendering. The
                // markdown layer strips the tags itself (see markdown-text
                // preprocess), so the answer body renders clean regardless.
                const textPart = part as AuiTextPart;
                const split = splitThinkBlocks(textPart.text ?? "");
                const thinking = (
                  <ThinkingBlock text={split.thinking} running={split.open} />
                );
                const answer = (
                  <>
                    {split.thinking && thinking}
                    <MarkdownText />
                  </>
                );
                if (disable3D) {
                  return answer;
                }
                return (
                  <div style={{ position: "relative", isolation: "isolate" }}>
                    <Perspective
                      maxRotateX={1}
                      maxRotateY={5}
                      smoothing={0.1}
                      cardClassName="max-w-none p-0 bg-transparent shadow-none"
                    >
                      {answer}
                    </Perspective>
                  </div>
                );
              }
              return null;
            }}
          </MessagePrimitive.Parts>
          {/* Empty-state skeleton — shows two placeholder lines while the
              bot is working but hasn't produced any text yet. Renders null
              once text arrives, so it auto-disappears on first token. */}
          <MessageSkeleton />
          <MessageError />

          {chatMessage?.interrupted && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
              <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500">
                <AlertTriangleIcon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <span className="font-medium text-amber-600">Generation interrupted</span>
                <span className="ml-1 text-xs text-muted-foreground">— network error. Partial response preserved above.</span>
              </div>
              <button
                onClick={handleRetryInterrupted}
                className="state-layer flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors"
              >
                <RefreshCwIcon className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}
        </div>

        <div
          data-slot="aui_assistant-message-footer"
          className={cn("ml-2 flex items-center relative z-10", ACTION_BAR_HEIGHT)}
        >
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  </ErrorBoundary>
  );
};

export const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};
