/**
 * useVoiceHotkey — keyboard activation for live voice mode.
 *
 * Bind once at the composer level. The default activation is Ctrl+Shift+V
 * (Grok-style; also works as Cmd+Shift+V on macOS). When the user is
 * focused in a text input, the hotkey is suppressed so it doesn't
 * hijack the V keystroke for "paste" or other browser shortcuts.
 *
 * Activation contract: the consumer's `onToggle` decides what to do —
 * typically start the live voice session if not running, or stop it if
 * it is.
 */

import { useEffect, useRef } from "react";

interface UseVoiceHotkeyOptions {
  /** Called when the activation shortcut is pressed in a valid context. */
  onToggle: () => void;
}

function isTextEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useVoiceHotkey({ onToggle }: UseVoiceHotkeyOptions): void {
  const ref = useRef(onToggle);
  ref.current = onToggle;

  useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "v") return;
      if (!(isMac ? e.metaKey || e.ctrlKey : e.ctrlKey)) return;
      if (!e.shiftKey || e.altKey) return;
      if (isTextEditable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true } as EventListenerOptions);
  }, []);
}
