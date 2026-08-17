
import {
  UserMessageAttachments,
} from "../../../ui/attachment";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { LoadingSpinner } from "@/components/ui/LoadingStates";
import { MarkdownText } from "../../../ui/markdown-text";
import { Perspective } from "@/components/ui/perspective-highlight";
import { MessageTiming } from "../../../ui/message-timing";
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
import { create } from "zustand";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { type FC, useCallback, useMemo, useState } from "react";
import { useChatHistory } from "@/hooks/useChatHistory";
import { type DirectiveChipProps } from "@assistant-ui/react-lexical";
import { WrenchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Assistant Settings Store ────────────────────────────────────────────────────

interface AssistantSettingsState {
  disable3D: boolean;
  toggle3D: () => void;
}

export const useAssistantSettingsStore = create<AssistantSettingsState>((set) => ({
  disable3D: typeof window !== "undefined" ? localStorage.getItem("assistant_disable_3d") === "true" : false,
  toggle3D: () =>
    set((state) => {
      const newValue = !state.disable3D;
      if (typeof window !== "undefined") {
        localStorage.setItem("assistant_disable_3d", String(newValue));
      }
      return { disable3D: newValue };
    }),
}));

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

// ─── Tool Activity Helpers ────────────────────────────────────────────────────────

type ToolActivityStatus = {
  type?: "running" | "complete" | "incomplete" | "requires-action" | string;
};

type ToolActivityResult = {
  status?: string;
  message?: string;
};

const toolActivityLabels: Record<
  string,
  {
    running: string;
    complete: string;
    requiresAction?: string;
    noResults?: string;
    unavailable?: string;
    failed?: string;
  }
> = {
  web_search: {
    running: "Searching the web...",
    complete: "Finished searching the web.",
    noResults: "I could not find useful results on the web.",
    failed: "Web search failed.",
  },
  calculator: {
    running: "Calculating...",
    complete: "Finished calculating.",
    failed: "Calculation failed.",
  },
  get_time: {
    running: "Checking the time...",
    complete: "Finished checking the time.",
    failed: "Time check failed.",
  },
  get_weather: {
    running: "Checking the weather...",
    complete: "Finished checking the weather.",
    failed: "Weather check failed.",
  },
  send_email: {
    running: "Preparing the email...",
    complete: "Email sent.",
    requiresAction: "Waiting for your confirmation to send the email.",
    failed: "Email preparation failed.",
  },
  create_calendar_event: {
    running: "Preparing the calendar event...",
    complete: "Calendar event ready.",
    requiresAction: "Waiting for your confirmation to create the event.",
    failed: "Calendar event setup failed.",
  },
  get_course_info: {
    running: "Looking up course information...",
    complete: "Finished looking up the course information.",
    noResults: "I could not find useful course information.",
    failed: "Course lookup failed.",
  },
  generate_flashcards: {
    running: "Preparing flashcards...",
    complete: "Flashcards are ready.",
    failed: "Flashcards generation failed.",
  },
  code_executor: {
    running: "Running the code...",
    complete: "Code execution finished.",
    failed: "Code execution failed.",
  },
  create_artifact: {
    running: "Creating the content...",
    complete: "Content is ready.",
    failed: "Content creation failed.",
  },
};

const fallbackToolActivity = {
  running: "Using a tool...",
  complete: "Tool step complete.",
  requiresAction: "Waiting for your confirmation to continue.",
  noResults: "No useful results found.",
  unavailable: "This tool is currently unavailable.",
  failed: "Tool step failed.",
};

function parseToolActivityResult(result: unknown): ToolActivityResult | null {
  if (!result) return null;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as ToolActivityResult;
    } catch {
      return null;
    }
  }
  if (typeof result === "object") return result as ToolActivityResult;
  return null;
}

type ActivityState = {
  label: string;
  kind: "thinking" | "writing" | "tool";
};

function getToolActivity(part: any): ActivityState | null {
  if (!part || part.type !== "tool-call" || !part.toolName) return null;

  const labels = toolActivityLabels[part.toolName] ?? fallbackToolActivity;
  const status = (part.status ?? {}) as ToolActivityStatus;
  const statusType = status.type ?? "running";
  const result = parseToolActivityResult(part.result ?? part.output ?? part.toolResult ?? part.response);
  const resultStatus = result?.status;

  const isRequiresAction =
    statusType === "requires-action" ||
    resultStatus === "needs_confirmation" ||
    resultStatus === "manual";
  const isNoResults = resultStatus === "no_results";
  const isUnavailable = resultStatus === "unavailable" || resultStatus === "rate_limited";
  const isFailed =
    statusType === "incomplete" ||
    resultStatus === "error" ||
    resultStatus === "failed";

  const label = statusType === "running"
    ? labels.running
    : isRequiresAction
      ? labels.requiresAction ?? fallbackToolActivity.requiresAction
      : isNoResults
        ? labels.noResults ?? fallbackToolActivity.noResults
        : isUnavailable
          ? labels.unavailable ?? fallbackToolActivity.unavailable
          : isFailed
            ? labels.failed ?? fallbackToolActivity.failed
            : labels.complete;

  return { label, kind: "tool" };
}

function getAssistantActivity(
  parts: { type: string; toolName?: string; status?: { type?: string } }[],
  messageStatus: { type?: string } | undefined,
): ActivityState | null {
  if (messageStatus?.type !== "running") return null;

  for (let i = parts.length - 1; i >= 0; i--) {
    const activity = getToolActivity(parts[i]);
    if (activity) return activity;
  }

  const hasTextContent = parts.some((part) => part.type === "text");
  if (hasTextContent) return { label: "Writing response...", kind: "writing" };

  return { label: "Thinking...", kind: "thinking" };
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
  const raw = useAuiState((s) => (s.message.status as any)?.error?.message ?? "") as string;
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

const AssistantStatusLine: FC = () => {
  const parts = useAuiState(
    (s) => s.message.parts as unknown as { type: string; toolName?: string; status?: { type?: string } }[]
  );
  const messageStatus = useAuiState((s) => s.message.status);
  const activity = getAssistantActivity(parts, messageStatus);

  if (!activity) return null;

  if (activity.kind === "thinking") {
    return (
      <div className="flex items-center gap-2 mt-2">
        <SimpleThinkingLoader />
        <span className="text-sm text-muted-foreground/80 animate-pulse">
          {activity.label}
        </span>
      </div>
    );
  }

  if (activity.kind === "tool") {
    return (
      <div className="flex items-center gap-2 mt-2 mb-1">
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
        <span className="text-sm text-muted-foreground/80">
          {activity.label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <LoadingSpinner size="sm" />
      <span className="text-sm text-muted-foreground/80">
        {activity.label}
      </span>
    </div>
  );
};

const SimpleThinkingLoader: FC = () => {
  return (
    <div className="flex gap-1.5">
      <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-pulse [animation-delay:0ms]" />
      <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-pulse [animation-delay:200ms]" />
      <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-pulse [animation-delay:400ms]" />
    </div>
  );
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
  const { disable3D, toggle3D } = useAssistantSettingsStore();
  const { t } = useTranslation();
  const isCopied = useAuiState((s) => s.message.isCopied);
  const isPositive = useAuiState((s) => Boolean((s.message as { feedback?: { isPositive?: boolean } }).feedback?.isPositive));
  const isNegative = useAuiState((s) => Boolean((s.message as { feedback?: { isNegative?: boolean } }).feedback?.isNegative));

  return (
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
      <ActionBarPrimitive.FeedbackPositive asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ThumbsUpIcon className={cn("size-4", isPositive && "fill-current")} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Helpful</TooltipContent>
        </Tooltip>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ThumbsDownIcon className={cn("size-4", isNegative && "fill-current")} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Not helpful</TooltipContent>
        </Tooltip>
      </ActionBarPrimitive.FeedbackNegative>
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
  const hasError = (status as any)?.type === "error" || (status as any)?.type === "failed";
  const branchCount = useAuiState(
    (s) => (s.message as any).branchCount as number | undefined,
  );
  const isForked = (branchCount ?? 1) > 1;
  const { t } = useTranslation();

  return (
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
  );
};

export const AssistantMessage: FC = () => {
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;
  const disable3D = useAssistantSettingsStore((s) => s.disable3D);
  const messageId = useAuiState((s) => s.message.id);
  const { activeThreadMessages } = useChatHistory();
  const chatMessage = activeThreadMessages?.find((m: any) => m.id === messageId) as { interrupted?: boolean } | undefined;

  const handleRetryInterrupted = useCallback(() => {
    const root = document.querySelector('[data-slot="aui_assistant-message-root"]');
    const reloadBtn = root?.querySelector('[aria-label="Retry"]') as HTMLButtonElement | undefined;
    reloadBtn?.click();
  }, []);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative mx-auto w-full min-w-0 max-w-3xl animate-in duration-150"
    >
      <div className="message-hover-wrapper px-1 py-0.5 -mx-1 -my-0.5">
        <div
          data-slot="aui_assistant-message-content"
          className="wrap-break-word px-2 text-[15.5px] leading-8 text-foreground md:text-base"
          dir="auto"
        >
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") {
                if (disable3D) {
                  return <MarkdownText />;
                }
                return (
                  <div style={{ position: "relative", isolation: "isolate" }}>
                    <Perspective 
                      maxRotateX={1} 
                      maxRotateY={5} 
                      smoothing={0.1}
                      cardClassName="max-w-none p-0 bg-transparent shadow-none"
                    >
                      <MarkdownText />
                    </Perspective>
                  </div>
                );
              }
              return null;
            }}
          </MessagePrimitive.Parts>
          <AssistantStatusLine />
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
  );
};

export const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};
