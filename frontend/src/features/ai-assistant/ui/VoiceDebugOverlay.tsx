/**
 * Always-on diagnostic overlay for voice dictation (?voiceDebug=1).
 *
 * Rendered from ThreadComposer so it exists whenever a composer exists,
 * even when MicButton hides itself — the overlay then displays the hide
 * reason, making silent failures impossible to miss.
 */

import { useEffect, useState } from "react";
import {
  voiceDebugBus,
  voiceDebugState,
  type VoiceDebugEvent,
} from "@/lib/stt/voice-debug-bus";

/** Parsed once per page load. */
export const VOICE_DEBUG_PARAM = {
  enabled: new URLSearchParams(window.location.search).has("voiceDebug"),
};

export function VoiceDebugOverlay() {
  const [events, setEvents] = useState<VoiceDebugEvent[]>(
    voiceDebugBus.snapshot(),
  );
  const [, forceTick] = useState(0);

  useEffect(() => {
    const unsub = voiceDebugBus.subscribe((next) => setEvents(next));
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  return (
    <div
      data-testid="voice-debug"
      dir="ltr"
      className="fixed bottom-24 left-4 z-[99999] max-h-64 w-96 overflow-y-auto rounded-lg border border-white/20 bg-black/90 p-2 font-mono text-[10px] leading-relaxed text-lime-300 shadow-2xl"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold text-white">VOICE DEBUG</span>
        <span className="text-[9px] text-white/70">
          micMounted={String(voiceDebugState.micMounted)}
          {voiceDebugState.hideReason && !voiceDebugState.micMounted
            ? ` (hidden: ${voiceDebugState.hideReason})`
            : ""}
        </span>
      </div>
      <div className="mb-1 text-white/60">status={voiceDebugState.status}</div>
      {events.length === 0 && (
        <div className="opacity-50">
          no events yet — press the mic and speak…
        </div>
      )}
      {events.map((e, i) => (
        <div key={i}>
          [{e.t}] {e.kind}
          {e.detail !== undefined && e.detail !== ""
            ? ` :: ${String(e.detail).substring(0, 70)}`
            : ""}
        </div>
      ))}
    </div>
  );
}