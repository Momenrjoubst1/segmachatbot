/**
 * Singleton bridge between the React send-state context and the
 * runtime layer (which lives outside the component tree). The runtime
 * imports `sendStateBridge` and calls its setters directly; the
 * context provider updates the ref on mount.
 */

interface Bridge {
  setSubmitting: () => void;
  setStreaming: () => void;
  setIdle: () => void;
}

const noop = () => {};

export const sendStateBridge: Bridge = {
  setSubmitting: noop,
  setStreaming: noop,
  setIdle: noop,
};

export function registerSendStateBridge(b: Bridge) {
  sendStateBridge.setSubmitting = b.setSubmitting;
  sendStateBridge.setStreaming = b.setStreaming;
  sendStateBridge.setIdle = b.setIdle;
}
