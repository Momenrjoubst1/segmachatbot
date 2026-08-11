
import { type FC, useState, useCallback } from "react";
import {
  MessagePrimitive,
  ActionBarPrimitive,
  ActionBarMorePrimitive,
  BranchPickerPrimitive,
  AuiIf,
  useAuiState,
} from "../../shims/assistant-ui-compat-shim";
import {
  CheckIcon,
  CopyIcon,
  RefreshCwIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  MoreHorizontalIcon,
  DownloadIcon,
  XIcon,
  AlertTriangleIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "../../ui/markdown-text";
import { MessageTiming } from "../../ui/message-timing";
import { TooltipIconButton } from "../../ui/tooltip-icon-button";
import { useChatHistory } from "@/hooks/useChatHistory";
import type { AgentChatMessage } from "@/hooks/useAgentWebSocket";
import { useConnectionContext } from "@/context/ConnectionContext";

export const AssistantMessage: FC = () => {
  const messageId = useAuiState((s) => s.message.id);
  const { activeThreadMessages } = useChatHistory() as any;
  const { retryMessage, sendApprovalDecision } = useConnectionContext();
  const chatMessage = activeThreadMessages?.find((m: any) => m.id === messageId) as AgentChatMessage | undefined;


  const [feedbackText, setFeedbackText] = useState("");
  const [showDenyInput, setShowDenyInput] = useState(false);
  // Double-click race-condition protection: once submitted, lock all buttons
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const handleApprove = useCallback(() => {
    if (hasSubmitted || !chatMessage?.require_approval) return;
    setHasSubmitted(true);
    sendApprovalDecision?.(chatMessage.require_approval.toolCallId, true);
  }, [hasSubmitted, chatMessage, sendApprovalDecision]);

  const handleDeny = useCallback(() => {
    if (hasSubmitted || !chatMessage?.require_approval) return;
    setHasSubmitted(true);
    sendApprovalDecision?.(chatMessage.require_approval.toolCallId, false, feedbackText);
    setShowDenyInput(false);
    setFeedbackText("");
  }, [hasSubmitted, chatMessage, feedbackText, sendApprovalDecision]);


  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative mx-auto w-full min-w-0 max-w-3xl animate-in duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="wrap-break-word px-2 text-[15.5px] leading-8 text-foreground md:text-base"
        dir="auto"
      >
        {/* Dynamic task progress bar */}
        {chatMessage?.task_progress && chatMessage.task_progress.percentage > 0 && chatMessage.task_progress.percentage < 100 && (
          <div className="mb-3 w-full rounded-full bg-muted/40 p-0.5 border border-border/40 backdrop-blur-sm">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300 ease-out"
              style={{ width: `${chatMessage.task_progress.percentage}%` }}
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground px-1">
              <span>{chatMessage.task_progress.message || "Executing task..."}</span>
              <span>{chatMessage.task_progress.percentage}%</span>
            </div>
          </div>
        )}

        {/* Dynamic agent execution logs/steps */}
        {chatMessage?.agent_steps && chatMessage.agent_steps.length > 0 && (
          <div className="mb-4 space-y-1.5 rounded-xl bg-muted/30 border border-border/30 p-3 text-sm">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Agent Execution Steps</div>
            {chatMessage.agent_steps.map((step: any) => (
              <div key={step.id} className="flex items-center gap-2 text-muted-foreground">
                {step.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />}
                {step.status === "success" && <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />}
                {step.status === "error" && <AlertTriangleIcon className="h-3.5 w-3.5 text-rose-400" />}
                <span className={cn(
                  "font-medium transition-colors",
                  step.status === "running" && "text-blue-400 dark:text-blue-300",
                  step.status === "success" && "text-emerald-500/90 dark:text-emerald-400/90",
                  step.status === "error" && "text-rose-500/90 dark:text-rose-400/90"
                )}>
                  {step.title}
                </span>
                {step.logs && <span className="text-xs opacity-60">({step.logs})</span>}
              </div>
            ))}
          </div>
        )}

        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === "text") return <MarkdownText />;
            return null;
          }}
        </MessagePrimitive.Parts>

        {/* Stream interrupted error banner */}
        {chatMessage?.interrupted && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-500">
              <AlertTriangleIcon className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <span className="font-medium text-rose-500/90">Response interrupted</span>
              <span className="ml-1 text-xs text-muted-foreground">— the connection was lost during streaming.</span>
            </div>
            <button
              onClick={() => retryMessage()}
              className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <RefreshCwIcon className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}

        {/* Human-in-the-Loop Approval Card */}
        {chatMessage?.require_approval && chatMessage.approval_status === "pending" && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500">
                <AlertTriangleIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-1">
                <h4 className="text-sm font-semibold text-foreground">Action Approval Required</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The agent requires authorization to execute tool: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground font-mono">{chatMessage.require_approval.toolName}</code>
                </p>
                {chatMessage.require_approval.args && (
                  <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-muted/60 p-2 text-xs font-mono border border-border/40">
                    {JSON.stringify(chatMessage.require_approval.args, null, 2)}
                  </pre>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {showDenyInput ? (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-150">
                  <textarea
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground outline-none focus:border-ring disabled:opacity-50"
                    placeholder="Provide feedback / changes required..."
                    rows={2}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    disabled={hasSubmitted}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDenyInput(false)}
                      disabled={hasSubmitted}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeny}
                      disabled={hasSubmitted || !feedbackText.trim()}
                      className="min-w-[140px]"
                    >
                      {hasSubmitted ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Submitting...
                        </span>
                      ) : "Submit Feedback & Deny"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDenyInput(true)}
                    disabled={hasSubmitted}
                  >
                    Modify / Deny
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    disabled={hasSubmitted}
                    className="min-w-[130px] bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                  >
                    {hasSubmitted ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Approving...
                      </span>
                    ) : "Approve Action"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Display approval result state */}
        {chatMessage?.require_approval && chatMessage.approval_status !== "pending" && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium px-1.5 py-1 rounded bg-muted/20 w-fit border border-border/20">
            {chatMessage.approval_status === "approved" ? (
              <>
                <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400/90">Action approved and executed</span>
              </>
            ) : (
              <>
                <XIcon className="h-3.5 w-3.5 text-rose-400" />
                <span className="text-rose-400/90">Action denied by user</span>
              </>
            )}
          </div>
        )}
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ml-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Retry">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.FeedbackPositive asChild>
        <TooltipIconButton tooltip="Helpful">
          <AuiIf condition={(s) => Boolean((s.message as { feedback?: { isPositive?: boolean } }).feedback?.isPositive)}>
            <ThumbsUpIcon className="fill-current" />
          </AuiIf>
          <AuiIf condition={(s) => !(s.message as { feedback?: { isPositive?: boolean } }).feedback?.isPositive}>
            <ThumbsUpIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <TooltipIconButton tooltip="Not helpful">
          <AuiIf condition={(s) => Boolean((s.message as { feedback?: { isNegative?: boolean } }).feedback?.isNegative)}>
            <ThumbsDownIcon className="fill-current" />
          </AuiIf>
          <AuiIf condition={(s) => !(s.message as { feedback?: { isNegative?: boolean } }).feedback?.isNegative}>
            <ThumbsDownIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackNegative>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
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

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
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
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-span">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const ChevronLeftIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const ChevronRightIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);
