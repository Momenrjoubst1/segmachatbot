/**
 * Voice dictation debug bus — shared pipeline telemetry for ?voiceDebug=1.
 *
 * MicButton publishes every lifecycle event here (including its own mount
 * state and hide-reason), and VoiceDebugOverlay renders them from anywhere,
 * so diagnostics stay visible even when the button itself hides.
 */

export interface VoiceDebugEvent {
  t: number;
  kind: string;
  detail?: string;
}

type Listener = (events: VoiceDebugEvent[]) => void;

const events: VoiceDebugEvent[] = [];
const listeners = new Set<Listener>();

export const voiceDebugState: {
  micMounted: boolean;
  status: string;
  hideReason: string;
} = {
  micMounted: false,
  status: "?",
  hideReason: "",
};

function publish(kind: string, detail?: string): void {
  events.push({ t: Date.now() % 100000, kind, detail });
  if (events.length > 40) events.splice(0, events.length - 40);
  listeners.forEach((fn) => fn([...events]));
}

export const voiceDebugBus = {
  event(kind: string, detail?: string): void {
    publish(kind, detail);
  },
  setState(status: string): void {
    voiceDebugState.status = status;
    publish("state", status);
  },
  setMounted(mounted: boolean, hideReason = ""): void {
    voiceDebugState.micMounted = mounted;
    voiceDebugState.hideReason = hideReason;
    publish("mount", mounted ? "yes" : `no (${hideReason})`);
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  snapshot(): VoiceDebugEvent[] {
    return [...events];
  },
};