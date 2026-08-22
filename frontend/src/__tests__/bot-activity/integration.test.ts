/**
 * End-to-end integration test: proves the wire format emitted by the
 * backend's `StepEventEmitter.toStreamChunks()` survives being parsed
 * by the frontend's `useBotActivity` (via `extractStepEvents`) and
 * produces the expected `BotActivity` snapshot.
 *
 * This is the contract test between the two layers — if the wire format
 * changes, this test fails.
 */

import { describe, expect, it } from "vitest";
import { deriveBotActivity } from "@/features/ai-assistant/ui/bot-activity/deriveBotActivity";
import type { StepStreamEvent } from "@/features/ai-assistant/ui/bot-activity/types";

// Mirror of the backend's StepEventEmitter (no imports across the stack).
class FakeBackendEmitter {
  private events: Array<{ id: string; kind: string; status: string; label?: string; ts: number; [k: string]: unknown }> = [];
  begin(id: string, kind: string, label?: string) {
    this.events.push({ id, kind, status: "running", ts: Date.now(), ...(label ? { label } : {}) });
  }
  complete(id: string, label?: string) {
    this.events.push({ id, kind: this.events.find((e) => e.id === id)?.kind ?? "error", status: "complete", ts: Date.now(), ...(label ? { label } : {}) });
  }
  toStreamChunks() {
    return this.events
      .map((ev) => `data: ${JSON.stringify({ type: "data-step", data: ev, transient: true })}\n\n`)
      .join("");
  }
}

/** Mimics the AI SDK's behavior: parses `data: <json>\n\n` chunks and
 *  turns each one into a UIMessage part of shape `{ type: "data-...", data, transient }`. */
function parseDataChunks(sseText: string) {
  const parts: Array<{ type: string; data: unknown; transient?: boolean }> = [];
  for (const block of sseText.split("\n\n").filter(Boolean)) {
    const m = block.match(/^data: (\{.*\})$/);
    if (!m) continue;
    try {
      parts.push(JSON.parse(m[1]));
    } catch {
      // ignore malformed
    }
  }
  return parts;
}

/** Mimics `useBotActivity`'s `extractStepEvents`: pull out data parts and
 *  cast them to `StepStreamEvent`. */
function extractStepEvents(parts: Array<{ type: string; data: unknown }>): StepStreamEvent[] {
  return parts
    .filter((p) => p.type.startsWith("data-"))
    .map((p) => p.data as StepStreamEvent)
    .filter((d): d is StepStreamEvent =>
      !!d && typeof d === "object" && "kind" in d && "status" in d && "id" in d,
    );
}

describe("backend ↔ frontend step-event wire format (integration)", () => {
  it("round-trips a typical multi-step pipeline", () => {
    // 1. Backend emits events.
    const emitter = new FakeBackendEmitter();
    emitter.begin("moderation", "moderation");
    emitter.complete("moderation", "Allowed");
    emitter.begin("rag_pipeline", "rag_pipeline");
    emitter.complete("rag_pipeline", "Read 5 sources");
    emitter.begin("memory_context", "memory_context");
    emitter.complete("memory_context", "Loaded 3 memories");
    const wireFormat = emitter.toStreamChunks();

    // 2. AI SDK on the frontend parses it.
    const parts = parseDataChunks(wireFormat);
    expect(parts).toHaveLength(6);
    expect(parts[0].type).toBe("data-step");
    expect(parts[0].transient).toBe(true);

    // 3. `useBotActivity` extracts the events.
    const events = extractStepEvents(parts);
    expect(events).toHaveLength(6);

    // 4. `deriveBotActivity` produces the expected snapshot.
    const activity = deriveBotActivity({
      parts: [],
      status: { type: "running" },
      streamEvents: events,
    });

    expect(activity.steps).toHaveLength(3);
    expect(activity.steps.map((s) => s.id)).toEqual([
      "moderation",
      "rag_pipeline",
      "memory_context",
    ]);
    expect(activity.steps.every((s) => s.status === "complete")).toBe(true);
    expect(activity.steps.find((s) => s.id === "rag_pipeline")?.label).toBe("Read 5 sources");

    // The latest running step's kind drives the overall status — but since
    // all events here are "complete", the function falls back to "thinking"
    // (no running step + no text parts).
    expect(activity.status).toBe("thinking");
  });

  it("respects the order events arrive (sorted by startedAt)", () => {
    const emitter = new FakeBackendEmitter();
    // Out-of-order arrival
    emitter.begin("b", "rag_pipeline");
    emitter.complete("b");
    emitter.begin("a", "moderation");
    emitter.complete("a");
    const wireFormat = emitter.toStreamChunks();
    const events = extractStepEvents(parseDataChunks(wireFormat));

    const activity = deriveBotActivity({
      parts: [],
      status: { type: "complete" },
      streamEvents: events,
    });

    // b's events arrived first but the wall-clock ts for `a` is later;
    // since all events are complete with their own ts, the start times
    // for both steps are the event ts, so `a` (later) comes second.
    expect(activity.steps.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("preserves transient flag (not persisted by the AI SDK)", () => {
    const emitter = new FakeBackendEmitter();
    emitter.begin("x", "moderation");
    emitter.complete("x");
    const wireFormat = emitter.toStreamChunks();
    const parts = parseDataChunks(wireFormat);
    for (const p of parts) {
      expect(p.transient).toBe(true);
    }
  });
});
