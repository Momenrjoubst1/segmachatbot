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
    variant="ghost"
    onClick={onClick}
    aria-label={NEW_CHAT_LABEL}
    data-testid="new-chat-button-full"
    className={cn(
      "aui-thread-list-new group h-[34px] w-[calc(100%-8px)] justify-between gap-1.5 rounded-lg -ms-1 px-2 text-sm text-foreground shadow-none disabled:opacity-50 hover:bg-accent transition-colors",
      className,
    )}
  >
    <span className="flex min-w-0 items-center gap-2">
      <span className="icon-wrapper inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-[#EBE5DF]/70 transition-transform duration-200 ease-out group-hover:rotate-90 group-hover:bg-[#EBE5DF]">
        <PlusIcon className="size-4 text-[#7A736E]" />
      </span>
      <span className="truncate text-start font-medium">{NEW_CHAT_LABEL}</span>
    </span>
    <kbd className="inline-flex shrink-0 items-center gap-0.5 rounded text-[11px] text-muted-foreground">
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
