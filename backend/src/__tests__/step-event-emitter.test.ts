import { describe, expect, it } from "vitest";
import { StepEventEmitter } from "../services/chat/step-event-emitter.js";

describe("StepEventEmitter", () => {
  it("starts empty", () => {
    const e = new StepEventEmitter();
    expect(e.size()).toBe(0);
    expect(e.getEvents()).toEqual([]);
    expect(e.toStreamChunks()).toBe("");
  });

  it("records a running → complete pair for a successful step", () => {
    const e = new StepEventEmitter();
    e.begin("moderation", "moderation");
    e.complete("moderation", { label: "Allowed" });

    const events = e.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "moderation",
      kind: "moderation",
      status: "running",
    });
    expect(events[1]).toMatchObject({
      id: "moderation",
      kind: "moderation",
      status: "complete",
      label: "Allowed",
    });
  });

  it("preserves toolName from begin() through to the event", () => {
    const e = new StepEventEmitter();
    e.begin("tool-1", "tool_call", { toolName: "web_search" });
    e.complete("tool-1", { result: { type: "docs", count: 3 } });
    expect(e.getEvents()[0]).toMatchObject({ toolName: "web_search" });
    expect(e.getEvents()[1]).toMatchObject({
      result: { type: "docs", count: 3 },
    });
  });

  it("emits an error event on fail() preserving the original kind", () => {
    const e = new StepEventEmitter();
    e.begin("rag", "rag_pipeline");
    e.fail("rag", "Timed out after 8s");
    const events = e.getEvents();
    expect(events[1]).toMatchObject({
      id: "rag",
      kind: "rag_pipeline",
      status: "error",
      error: "Timed out after 8s",
    });
  });

  it("serializes events to the v6 SSE data-chunk wire format", () => {
    const e = new StepEventEmitter();
    e.begin("moderation", "moderation");
    e.complete("moderation", { label: "Allowed" });
    const out = e.toStreamChunks();

    // Each event is one `data: <json>\n\n` chunk.
    expect(out).toMatch(/^data: \{/);
    expect(out.endsWith("\n\n")).toBe(true);

    const lines = out.split("\n\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const stripped = line.replace(/^data: /, "");
      const parsed = JSON.parse(stripped);
      expect(parsed).toMatchObject({ type: "data-step", transient: true });
      expect(parsed.data).toMatchObject({ id: "moderation" });
    }
  });

  it("uses getEvents() as a defensive copy", () => {
    const e = new StepEventEmitter();
    e.begin("a", "moderation");
    const snap = e.getEvents();
    e.complete("a");
    // mutating the snapshot should not affect internal state
    snap.length = 0;
    expect(e.size()).toBe(2);
  });
});
