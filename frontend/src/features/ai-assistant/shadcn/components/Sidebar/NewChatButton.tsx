import type { FC } from "react";
import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Single source of truth so both variants always show the same label/shortcut.
// Keep in sync with the binding registered in AssistantLayout.tsx.
const NEW_CHAT_LABEL = "New Chat";
const NEW_CHAT_SHORTCUT = "Ctrl+Shift+O";

/**
 * Expanded-sidebar variant: icon + label + keyboard shortcut, each part in its
 * own element. The icon lives inside an `icon-wrapper` span so it can carry a
 * hover animation independent of the rest of the button. No tooltip here —
 * the label is already visible.
 */
export const NewChatButtonFull: FC<{
  onClick?: () => void;
  className?: string;
}> = ({ onClick, className }) => (
  <Button
    variant="outline"
    onClick={onClick}
    aria-label={NEW_CHAT_LABEL}
    data-testid="new-chat-button-full"
    className={cn(
      "aui-thread-list-new group h-9 justify-between gap-2 rounded-full border-border bg-card px-3 text-xs text-foreground shadow-none disabled:opacity-50",
      className,
    )}
  >
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="icon-wrapper inline-flex size-3.5 shrink-0 items-center justify-center transition-transform duration-200 ease-out group-hover:rotate-90">
        <PlusIcon className="size-3.5" />
      </span>
      <span className="truncate text-start">{NEW_CHAT_LABEL}</span>
    </span>
    <kbd className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
      {NEW_CHAT_SHORTCUT}
    </kbd>
  </Button>
);

/**
 * Collapsed-sidebar variant: icon-only circular button. A tooltip showing the
 * action name + keyboard shortcut appears on hover only in this state.
 * `onClick` calls stopPropagation because the collapsed rail toggles sidebar
 * expansion on background clicks.
 */
export const NewChatButtonIcon: FC<{
  onClick?: () => void;
  className?: string;
}> = ({ onClick, className }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        aria-label={NEW_CHAT_LABEL}
        data-testid="new-chat-button-icon"
        className={cn(
          "group state-layer inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <span className="icon-wrapper inline-flex size-4 items-center justify-center transition-transform duration-200 ease-out group-hover:rotate-90">
          <PlusIcon className="size-4" />
        </span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="right">
      <span className="flex items-center gap-2">
        {NEW_CHAT_LABEL}
        <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{NEW_CHAT_SHORTCUT}</kbd>
      </span>
    </TooltipContent>
  </Tooltip>
);
