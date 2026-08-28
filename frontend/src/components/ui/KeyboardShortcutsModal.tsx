import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Keyboard, Command } from "lucide-react"
import { cn } from "@/lib/cn"
import { useTranslation } from "react-i18next"

interface ShortcutItem {
  key: string
  description: string
  icon?: React.ReactNode
  category?: string
}

interface KeyboardShortcutsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation("keyboardShortcuts")

  // Helper to format keys nicely for display
  const formatKey = (key: string): React.ReactNode => {
    const parts = key.toLowerCase().split("+")
    return parts.map((part, i) => (
      <React.Fragment key={i}>
        <kbd className={cn(
          "inline-flex items-center justify-center px-2 py-1 text-xs font-mono font-medium bg-muted rounded border border-border",
          i > 0 && "ml-1"
        )}>
          {part === "ctrl" ? (
            <>
              <Command className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">Control</span>
            </>
          ) : part === "shift" ? (
            <span className="capitalize">Shift</span>
          ) : part === "alt" ? (
            <span className="capitalize">Alt</span>
          ) : part === "meta" ? (
            <span className="capitalize">⌘</span>
          ) : part === "escape" ? (
            <span className="uppercase">Esc</span>
          ) : part === "enter" ? (
            <span className="capitalize">Enter</span>
          ) : (
            <span className="uppercase">{part}</span>
          )}
        </kbd>
        {i < parts.length - 1 && <span className="mx-1 text-muted-foreground">+</span>}
      </React.Fragment>
    ))
  }

  // Define all shortcuts organized by category
  const shortcutCategories: { category: string; items: ShortcutItem[] }[] = [
    {
      category: t("categories.general", "General"),
      items: [
        { key: "ctrl+/", description: t("shortcuts.showShortcuts", "Show keyboard shortcuts") },
        { key: "ctrl+shift+o", description: t("shortcuts.newChat", "New chat") },
        { key: "ctrl+n", description: t("shortcuts.newChatAlt", "New chat (alternate)") },
        { key: "ctrl+k", description: t("shortcuts.focusComposer", "Focus composer") },
        { key: "escape", description: t("shortcuts.stopGeneration", "Stop generation / Close modals") },
      ],
    },
    {
      category: t("categories.navigation", "Navigation"),
      items: [
        { key: "ctrl+[", description: t("shortcuts.previousChat", "Previous chat") },
        { key: "ctrl+]", description: t("shortcuts.nextChat", "Next chat") },
        { key: "ctrl+arrowup", description: t("shortcuts.prevMessage", "Previous message") },
        { key: "ctrl+arrowdown", description: t("shortcuts.nextMessage", "Next message") },
      ],
    },
{
        category: t("categories.actions", "Actions"),
        items: [
          { key: "ctrl+shift+c", description: t("shortcuts.copyLastMessage", "Copy last assistant message") },
          { key: "ctrl+shift+e", description: t("shortcuts.toggleSidebar", "Toggle sidebar") },
          { key: "ctrl+shift+m", description: t("shortcuts.toggleEmail", "Toggle email history") },
          { key: "ctrl+shift+k", description: t("shortcuts.toggleCalendar", "Toggle calendar view") },
        ],
      },
    {
      category: t("categories.composer", "Composer"),
      items: [
        { key: "enter", description: t("shortcuts.sendMessage", "Send message") },
        { key: "shift+enter", description: t("shortcuts.newLine", "New line") },
        { key: "ctrl+enter", description: t("shortcuts.sendMessageAlt", "Send message (alternate)") },
      ],
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("title", "Keyboard Shortcuts")}
          </DialogTitle>
          <DialogDescription>
            {t("description", "Boost your productivity with these keyboard shortcuts.")}{" "}
            {t("openHint", "Press")}{" "}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl</kbd>
            {" + "}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">/</kbd>
            {" "}
            {t("openHintSuffix", "anytime to open this dialog.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {shortcutCategories.map(({ category, items }, catIndex) => (
            <div key={catIndex} className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {category}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
                  >
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">
                      {item.description}
                    </span>
                    <span className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                      {formatKey(item.key)}
                    </span>
                  </div>
                ))}
              </div>
              {catIndex < shortcutCategories.length - 1 && (
                <Separator className="my-2" />
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            autoFocus
          >
            {t("close", "Close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}