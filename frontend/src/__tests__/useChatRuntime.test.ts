import { describe, expect, it } from "vitest";
import {
  legacyGuestStreamToUIMessageStream,
  resolveRequestCredentials,
} from "@/features/ai-assistant/ui/useChatRuntime";

describe("guest request credentials", () => {
  it("forces credentialed fetches for guest requests", () => {
    expect(resolveRequestCredentials(true, undefined)).toBe("include");
    expect(resolveRequestCredentials(true, "same-origin")).toBe("include");
  });

  it("does not force credentials for authenticated requests", () => {
    expect(resolveRequestCredentials(false, undefined)).toBeUndefined();
    expect(resolveRequestCredentials(false, "same-origin")).toBe("same-origin");
  });
});

describe("guest stream compatibility", () => {
  it("converts legacy text chunks into UI-message chunks", async () => {
    const encoder = new TextEncoder();
    const response = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('0:"Hello "\n0:"guest"\n'));
        controller.close();
      },
    });

    const reader = legacyGuestStreamToUIMessageStream(response).getReader();
    const chunks: Array<{ type: string; delta?: string }> = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text-start" }),
      expect.objectContaining({ type: "text-delta", delta: "Hello " }),
      expect.objectContaining({ type: "text-delta", delta: "guest" }),
      expect.objectContaining({ type: "text-end" }),
      expect.objectContaining({ type: "finish" }),
    ]));
  });
});
