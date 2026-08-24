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
  /**
   * Optional override. Default: Ctrl+Shift+V (Cmd+Shift+V on macOS).
   * Pass an object like { key: " ", ctrl: false, shift: false, alt: false }
   * to bind Space (or any other combo).
   */
  combo?: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
  /**
   * When true, the hotkey fires even when a text input is focused.
   * Default false (suppressed in inputs) so it doesn't hijack typing.
   */
  fireInInputs?: boolean;
}

function isTextEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useVoiceHotkey({
  onToggle,
  combo,
  fireInInputs = false,
}: UseVoiceHotkeyOptions): void {
  const ref = useRef(onToggle);
  ref.current = onToggle;
  const comboRef = useRef(combo);
  comboRef.current = combo;
  const fireInInputsRef = useRef(fireInInputs);
  fireInInputsRef.current = fireInInputs;

  useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
    const handler = (e: KeyboardEvent) => {
      const c = comboRef.current ?? {
        key: "v",
        ctrl: !isMac,
        meta: isMac,
        shift: true,
      };
      if (e.key.toLowerCase() !== c.key.toLowerCase()) return;
      if (Boolean(c.ctrl) !== (e.ctrlKey || (isMac && e.metaKey))) {
        // Either user wants Ctrl OR user wants Cmd (Mac).
        // Allow Ctrl on non-Mac or Meta on Mac. If the combo wants meta only,
        // accept either meta or ctrl on Mac to be permissive.
        if (!(isMac && c.meta && (e.metaKey || e.ctrlKey))) return;
      }
      if (Boolean(c.shift) !== e.shiftKey) return;
      if (Boolean(c.alt) !== e.altKey) return;
      if (!fireInInputsRef.current && isTextEditable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true } as EventListenerOptions);
  }, []);
}
