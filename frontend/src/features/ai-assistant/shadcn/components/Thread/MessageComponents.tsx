
// React must be imported BEFORE any module-scope lazy() call: when Vite emits
// CJS-interop destructuring for the react dep, the import becomes a const at
// this source position — leaving lazy() above it hits a TDZ ReferenceError
// ("Cannot access 'lazy' before initialization") that crashes the whole app.
import { type FC, lazy, memo, Suspense, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  UserMessageAttachments
} from "../../../ui/attachment";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ui/core/ErrorBoundary";
const MarkdownText = lazy(() =>
  import("../../../ui/markdown-text").then((m) => ({ default: m.MarkdownText })),
);
const MarkdownTextOrNothing: FC = () => (
  <Suspense fallback={null}>
    <MarkdownText />
  </Suspense>
);
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
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
// Markdown (react-markdown + the katex stack, ~420KB) only matters once
// messages actually render — the welcome screen must not pay for it. Both
// renderers below are lazy with plain-text fallbacks.
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

/** "2 hours ago" for recent messages, "Aug 16" for older ones — locale-aware. */
function formatMessageTime(createdAt: unknown, language: string): string | null {
  const date = createdAt instanceof Date ? createdAt : new Date(String(createdAt ?? ""));
  if (Number.isNaN(date.getTime())) return null;
  const diffMinutes = (Date.now() - date.getTime()) / 60_000;
  if (diffMinutes < 1) return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(0, "minute");
  if (diffMinutes < 60) {
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-Math.floor(diffMinutes), "minute");
  }
  if (diffMinutes < 24 * 60) {
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-Math.floor(diffMinutes / 60), "hour");
  }
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(date);
}

const UserActionBar: FC = () => {
  const isCopied = useAuiState((s) => s.message.isCopied);
  const messageId = useAuiState((s) => s.message.id);
  const runtimeCreatedAt = useAuiState((s) => (s.message as Record<string, unknown>).createdAt);
  const isLast = useAuiState((s) => {
    const msgs = s.thread.messages;
    return msgs.length > 0 && msgs[msgs.length - 1]?.id === s.message.id;
  });
  // Hydrated messages don't carry timestamps through the AI SDK runtime —
  // prefer the chat-history record (same source AssistantMessage uses).
  const { activeThreadMessages } = useChatHistory();
  const historyCreatedAt = activeThreadMessages?.find((m) => m.id === messageId)?.created_at;
  const { t, i18n } = useTranslation();
  const timeLabel = useMemo(
    () => formatMessageTime(historyCreatedAt ?? runtimeCreatedAt, i18n.language),
    [historyCreatedAt, runtimeCreatedAt, i18n.language],
  );

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className={cn(
        "message-action-bar aui-user-action-bar-root mt-1 flex items-center justify-end gap-0.5 transition-opacity",
        // Claude-style reveal: always visible on the latest message (also
        // covers touch devices), hover/focus-revealed on older ones.
        isLast
          ? "opacity-100"
          : "invisible opacity-0 group-hover:visible group-hover:opacity-100 focus-within:visible focus-within:opacity-100",
      )}
    >
      {timeLabel && (
        <span
          className="mr-1 select-none text-[11px] text-muted-foreground/70"
          title={
            (() => {
              const d = historyCreatedAt ? new Date(historyCreatedAt) : runtimeCreatedAt instanceof Date ? runtimeCreatedAt : null;
              return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(i18n.language) : undefined;
            })()
          }
        >
          {timeLabel}
        </span>
      )}
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip={t("retry", "Retry")} className="size-7 rounded-md hover:bg-muted">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="size-7 rounded-md hover:bg-muted">
          {isCopied ? <CheckIcon className="size-3.5 text-green-600" /> : <CopyIcon className="size-3.5" />}
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit size-7 rounded-md hover:bg-muted">
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

// ─── User message text — renders inline text-file attachments as
// expandable chips instead of raw <attachment> blocks ────────────────────────

const ATTACHMENT_BLOCK_RE = /<attachment name=([^>\n]+)>\n?([\s\S]*?)<\/attachment>/g;

const InlineAttachmentChip: FC<{ name: string; content: string }> = ({ name, content }) => {
  const [open, setOpen] = useState(false);
  const lineCount = content.split("\n").length;
  return (
    <span className="my-1 block w-fit max-w-full overflow-hidden rounded-xl border border-border/60 bg-muted/60 align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="state-layer flex w-full items-center gap-2 px-3 py-1.5 text-left"
        aria-expanded={open}
      >
        <FileTextIcon className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium" dir="ltr">
          {name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </span>
        <ChevronDownIcon
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <pre
          dir="ltr"
          className="max-h-64 overflow-auto border-t border-border/50 bg-background/60 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
        >
          {content.trimEnd()}
        </pre>
      )}
    </span>
  );
};

// Claude's rose-tinted inline code + modest headings for user messages.
const MarkdownLazy = lazy(async () => {
  const [{ default: Markdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  const WithGfm: FC<any> = (props) => (
    <Markdown {...props} remarkPlugins={[remarkGfm]} />
  );
  return { default: WithGfm };
});

const UserMarkdown: FC<{ text: string }> = memo(({ text }) => (
  <Suspense fallback={<div className="whitespace-pre-wrap">{text}</div>}>
  <MarkdownLazy
    components={{
      p: ({ children }: any) => <p className="m-0">{children}</p>,
      h1: ({ children }: any) => <h3 className="mt-3 mb-1 text-[15px] font-semibold first:mt-0">{children}</h3>,
      h2: ({ children }: any) => <h3 className="mt-3 mb-1 text-[15px] font-semibold first:mt-0">{children}</h3>,
      h3: ({ children }: any) => <h4 className="mt-2.5 mb-1 text-[15px] font-semibold first:mt-0">{children}</h4>,
      h4: ({ children }: any) => <h5 className="mt-2 mb-0.5 text-[14px] font-semibold first:mt-0">{children}</h5>,
      h5: ({ children }: any) => <h6 className="mt-2 mb-0.5 text-[14px] font-semibold first:mt-0">{children}</h6>,
      h6: ({ children }: any) => <h6 className="mt-2 mb-0.5 text-[14px] font-semibold first:mt-0">{children}</h6>,
      strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
      a: ({ children, href }: any) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {children}
        </a>
      ),
      code: ({ children }: any) => (
        <code
          dir="ltr"
          className="rounded-md bg-rose-500/10 px-1.5 py-0.5 font-mono text-[12.5px] text-rose-700 dark:bg-rose-400/15 dark:text-rose-300"
        >
          {children}
        </code>
      ),
      pre: ({ children }: any) => (
        <div
          dir="ltr"
          className="my-1.5 overflow-x-auto rounded-xl border border-border/50 bg-muted/70 p-3 text-left [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[12.5px] [&_code]:text-foreground dark:bg-muted/40"
        >
          <pre className="m-0 font-mono text-[12.5px] leading-relaxed">{children}</pre>
        </div>
      ),
      ul: ({ children }: any) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
      ol: ({ children }: any) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
      li: ({ children }: any) => <li className="m-0">{children}</li>,
      blockquote: ({ children }: any) => (
        <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
      ),
      hr: () => <hr className="my-2 border-border/60" />,
      table: ({ children }: any) => (
        <div dir="ltr" className="my-1.5 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">{children}</table>
        </div>
      ),
      th: ({ children }: any) => (
        <th className="border border-border/60 bg-muted/50 px-2 py-1 text-start font-semibold">{children}</th>
      ),
      td: ({ children }: any) => <td className="border border-border/60 px-2 py-1 align-top">{children}</td>,
    }}
  >
    {text}
  </MarkdownLazy>
  </Suspense>
));
UserMarkdown.displayName = "UserMarkdown";

/** Text renderer for user messages — Claude-style: attachment blocks → chips,
 * @directives → chips, everything else → rendered markdown. */
const DIRECTIVE_TOKEN_RE = /:([\w-]{1,64})\[/;

const UserTextPart: FC<{ text?: string }> = ({ text }) => {
  const value = text ?? "";
  ATTACHMENT_BLOCK_RE.lastIndex = 0;
  const matches = [...value.matchAll(ATTACHMENT_BLOCK_RE)];

  // Messages containing @directive tokens keep the chip-aware renderer;
  // everything else renders as markdown.
  const renderTextSegment = (segment: string, key?: string) => {
    if (segment.length === 0) return null;
    const node = DIRECTIVE_TOKEN_RE.test(segment) ? (
      <DirectiveText
        {...({ type: "text", text: segment, status: { type: "complete" } } as const)}
      />
    ) : (
      <UserMarkdown text={segment} />
    );
    return key ? <span key={key}>{node}</span> : node;
  };

  if (matches.length === 0) return renderTextSegment(value);

  const pieces: Array<{ key: string; node: ReactNode }> = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    if (start > cursor) {
      pieces.push({ key: `t${i}`, node: renderTextSegment(value.slice(cursor, start)) });
    }
    pieces.push({
      key: `a${i}`,
      node: <InlineAttachmentChip name={(m[1] || "").trim()} content={m[2] ?? ""} />,
    });
    cursor = start + m[0].length;
  });
  if (cursor < value.length) {
    pieces.push({ key: "tail", node: renderTextSegment(value.slice(cursor)) });
  }

  return <>{pieces.map((p) => <span key={p.key}>{p.node}</span>)}</>;
};

// ─── Exported Message Components ──────────────────────────────────────────────────

/** Collapsed height for long user messages — ≈9 text lines, Claude-style. */
const USER_TEXT_COLLAPSED_PX = 208;

/**
 * Long user messages clamp to ~8 lines with a fade gradient + "Show more" —
 * expanding replaces the gradient with "Show less". Measures real content
 * height, so short messages never see the toggle.
 */
const UserTextCollapsible: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => setIsClamped(el.scrollHeight > USER_TEXT_COLLAPSED_PX + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsed = isClamped && !expanded;

  return (
    <div>
      <div
        ref={contentRef}
        className={cn("relative", collapsed && "max-h-52 overflow-hidden")}
      >
        {children}
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted via-muted/90 to-transparent" />
        )}
      </div>
      {isClamped && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="state-layer mt-1 rounded px-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? t("showLess", "Show less") : t("showMore", "Show more")}
        </button>
      )}
    </div>
  );
};

export const UserMessage: FC = () => {
  const status = useAuiState((s) => s.message.status);
  const hasError = (status as Record<string, unknown>)?.type === "error" || (status as Record<string, unknown>)?.type === "failed";
  const branchCount = useAuiState(
    (s) => (s.message as Record<string, unknown>).branchCount as number | undefined,
  );
  const isForked = (branchCount ?? 1) > 1;
  const { t } = useTranslation();
  // Only wrap text in the collapsible when there IS text — an unconditional
  // wrapper div would defeat the bubble's empty:hidden for attachment-only
  // messages.
  const hasTextContent = useAuiState((s) => {
    const content = s.message.content;
    return (
      Array.isArray(content) &&
      content.some(
        (p) =>
          (p as { type?: string; text?: string }).type === "text" &&
          ((p as { text?: string }).text ?? "").trim().length > 0,
      )
    );
  });
  const textParts = (
    <MessagePrimitive.Parts components={{ Text: UserTextPart }} />
  );

  return (
    <ErrorBoundary fallback={<div className="text-destructive text-sm p-2">Failed to render user message</div>}>
      <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 mx-auto grid w-full min-w-0 max-w-3xl animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_minmax(0,88%)] content-start gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 justify-self-end group">
        <div
          className={cn(
            "message-hover-wrapper",
            "aui-user-message-content wrap-break-word whitespace-pre-wrap peer rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-[1.6] text-foreground empty:hidden shadow-sm border",
            hasError
              ? "border-destructive bg-destructive/5"
              : isForked
                ? "border-l-2 border-l-blue-400 border-primary/20"
                : "border-transparent",
          )}
          dir="auto"
        >
          <MessagePrimitive.Quote>{(quote) => <QuoteBlock {...quote} />}</MessagePrimitive.Quote>
          {hasTextContent ? <UserTextCollapsible>{textParts}</UserTextCollapsible> : textParts}
        </div>
        <UserActionBar />
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
                    <MarkdownTextOrNothing />
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
