/**
 * Singleton bridge for sending chat messages from components outside
 * the assistant-ui runtime tree (e.g. DailyPlanPanel in the study dialog).
 */

type SendFn = (text: string) => void;

const noop: SendFn = () => {};

let sendFn: SendFn = noop;

export function registerSendBridge(fn: SendFn) {
  sendFn = fn;
}

export function unregisterSendBridge() {
  sendFn = noop;
}

export function sendChatMessage(text: string) {
  sendFn(text);
}
