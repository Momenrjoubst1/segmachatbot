
import {
  ComposerAddAttachment,
  ComposerAttachments,
} from "../../../ui/attachment";
import { Button } from "@/components/ui/button";
import { ComposerTriggerPopover } from "../../../ui/composer-trigger-popover";
import { ComposerQuotePreview, SelectionToolbar } from "../../../ui/quote";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import {
  AuiIf,
  ComposerPrimitive,
  useUnstableMentionAdapter,
  useUnstableSlashCommandAdapter,
  type Unstable_SlashCommand,
} from "../../../shims/assistant-ui-compat-shim";
import {
  ArrowUpIcon,
  FileTextIcon,
  GlobeIcon,
  HelpCircleIcon,
  LanguagesIcon,
  SlashIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { type FC, useEffect, useCallback } from "react";
import { DirectiveChip } from "./MessageComponents";

const slashCommands: readonly Unstable_SlashCommand[] = [
  {
    id: "summarize",
    description: "Summarize the conversation",
    icon: "FileText",
    execute: () => console.log("[shadcn example] /summarize invoked"),
  },
  {
    id: "translate",
    description: "Translate text to another language",
    icon: "Languages",
    execute: () => console.log("[shadcn example] /translate invoked"),
  },
  {
    id: "search",
    description: "Search the web for information",
    icon: "Globe",
    execute: () => console.log("[shadcn example] /search invoked"),
  },
  {
    id: "help",
    description: "List available commands",
    icon: "HelpCircle",
    execute: () => console.log("[shadcn example] /help invoked"),
  },
] as const;

const slashIconMap: Record<string, FC<{ className?: string }>> = {
  FileText: FileTextIcon,
  Languages: LanguagesIcon,
  Globe: GlobeIcon,
  HelpCircle: HelpCircleIcon,
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 min-h-[44px] min-w-[44px] rounded-full"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

export const ThreadComposer: FC = () => {
  const mention = useUnstableMentionAdapter({ fallbackIcon: WrenchIcon });
  const slash = useUnstableSlashCommandAdapter({
    commands: slashCommands,
    iconMap: slashIconMap,
    fallbackIcon: SlashIcon,
  });

  const updateComposerForKeyboard = useCallback(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const offset = window.innerHeight - viewport.height - viewport.offsetTop;
    document.documentElement.style.setProperty(
      "--composer-keyboard-offset",
      `${Math.max(0, offset)}px`
    );
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    viewport.addEventListener("resize", updateComposerForKeyboard);
    viewport.addEventListener("scroll", updateComposerForKeyboard);
    updateComposerForKeyboard();

    return () => {
      viewport.removeEventListener("resize", updateComposerForKeyboard);
      viewport.removeEventListener("scroll", updateComposerForKeyboard);
      document.documentElement.style.removeProperty("--composer-keyboard-offset");
    };
  }, [updateComposerForKeyboard]);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className="flex w-full flex-col gap-2 rounded-3xl border bg-background p-2.5 transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
            style={{ marginBottom: "var(--composer-keyboard-offset, 0px)" }}
          >
            <ComposerQuotePreview />
            <ComposerAttachments />
            <ComposerPrimitive.Unstable_TriggerPopoverRoot>
              <LexicalComposerInput
                directiveChip={DirectiveChip}
                formatter={mention.directive.formatter}
                placeholder="Ask Sigma"
                className="aui-composer-input relative max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none [&_.aui-directive-chip-icon]:self-center [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:text-blue-700 [&_.aui-directive-chip]:leading-none dark:[&_.aui-directive-chip]:bg-blue-900/50 dark:[&_.aui-directive-chip]:text-blue-300 [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:top-0 [&_.aui-lexical-placeholder]:left-0 [&_.aui-lexical-placeholder]:px-1.75 [&_.aui-lexical-placeholder]:py-1 [&_.aui-lexical-placeholder]:text-muted-foreground/80"
              />
              <ComposerTriggerPopover
                char="/"
                action={slash.action}
                iconMap={slash.iconMap}
                fallbackIcon={slash.fallbackIcon}
                emptyItemsLabel="No matching commands"
              />
            </ComposerPrimitive.Unstable_TriggerPopoverRoot>
            <ComposerAction />
            <ComposerTriggerPopover
              char="@"
              directive={mention.directive}
              iconMap={mention.iconMap}
              fallbackIcon={mention.fallbackIcon}
            />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

// Re-export SelectionToolbar for convenience (used in Thread layout)
export { SelectionToolbar };
