import { useEffect, useCallback } from "react";

interface ShortcutMap {
  [key: string]: () => void;
}

const MODIFIER_KEY = "ctrlKey";

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      for (const [combo, handler] of Object.entries(shortcuts)) {
        const parts = combo.toLowerCase().split("+");
        const ctrl = parts.includes("ctrl");
        const shift = parts.includes("shift");
        const alt = parts.includes("alt");
        const key = parts[parts.length - 1];

        if (
          event[MODIFIER_KEY] === ctrl &&
          event.shiftKey === shift &&
          event.altKey === alt &&
          event.key.toLowerCase() === key &&
          !(ctrl && isInput) // Block Ctrl+ shortcuts in inputs to avoid conflicts with browser/app shortcuts
        ) {
          event.preventDefault();
          handler();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
