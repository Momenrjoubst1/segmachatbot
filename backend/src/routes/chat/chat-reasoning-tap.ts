// Chat reasoning tap: fold reasoning deltas into <think>…</think> content.

/** Providers whose models commonly stream DeepSeek-style reasoning deltas. */
export const REASONING_TAP_DEFAULT_PROVIDERS = new Set<string>([
  "baichat",
  "nvidia",
  "openrouter",
  "bigmodel",
  "novita",
]);

/** Extract the reasoning text from an OpenAI-compatible chat delta, if any. */
function extractDeltaReasoning(delta: Record<string, unknown> | undefined | null): string | null {
  if (!delta || typeof delta !== "object") return null;
  const rc = (delta as { reasoning_content?: unknown }).reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return rc;
  const r = (delta as { reasoning?: unknown }).reasoning;
  if (typeof r === "string" && r.length > 0) return r;
  return null;
}

/** Transform one parsed SSE data payload; returns null when nothing changed. */
function tapChatChunk(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { choices?: Array<{ delta?: Record<string, unknown>; message?: Record<string, unknown> }> };
  const choice = obj.choices?.[0];
  if (!choice) return null;

  if (choice.delta && typeof choice.delta === "object") {
    const reasoning = extractDeltaReasoning(choice.delta);
    if (reasoning == null) return null;
    delete choice.delta.reasoning_content;
    delete choice.delta.reasoning;
    const existing = typeof choice.delta.content === "string" ? choice.delta.content : "";
    choice.delta.content = `<think>${reasoning}</think>${existing}`;
    return JSON.stringify(obj);
  }

  if (choice.message && typeof choice.message === "object") {
    const reasoning = extractDeltaReasoning(choice.message);
    if (reasoning == null) return null;
    delete choice.message.reasoning_content;
    delete choice.message.reasoning;
    const existing = typeof choice.message.content === "string" ? choice.message.content : "";
    choice.message.content = `<think>${reasoning}</think>${existing}`;
    return JSON.stringify(obj);
  }
  return null;
}

/**
 * Wrap a fetch implementation so chat-completions SSE bodies get their
 * reasoning deltas folded into content as <think>…</think>.
 */
export function createReasoningTapFetch(inner: typeof fetch): typeof fetch {
  return async function reasoningTapFetch(input, init) {
    const res = await inner(input, init);
    const contentType = res.headers?.get?.("content-type") ?? "";
    if (!res.body || !contentType.includes("text/event-stream")) return res;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffered = "";

    const processLine = (rawLine: string): string => {
      const line = rawLine.replace(/\r$/, "");
      if (!line.startsWith("data:")) return line;
      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") return line;
      try {
        const parsed: unknown = JSON.parse(payloadText);
        const tapped = tapChatChunk(parsed);
        return tapped != null ? `data: ${tapped}` : line;
      } catch {
        return line;
      }
    };

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        if (lines.length > 0) {
          controller.enqueue(encoder.encode(lines.map(processLine).join("\n") + "\n"));
        }
      },
      flush(controller) {
        buffered += decoder.decode();
        if (buffered.length > 0) controller.enqueue(encoder.encode(processLine(buffered)));
      },
    });

    return new Response(res.body.pipeThrough(transform), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}

/** Remove <think>…</think> blocks from text. */
export function stripThinkTags(text: string): string {
  if (!text || !text.includes("<think>")) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trimStart();
}
