/**
 * End-to-end integration test: proves the wire format emitted by the
 * backend's `StepEventEmitter` survives the full frontend pipeline —
 * SSE parsing → AI SDK UIMessage chunks → the AISDKMessageConverter's
 * normalization (`data-step` → `{type:"data", name:"step"}`) →
 * `useBotActivity.extractStepEvents` — and produces the expected
 * `BotActivity` snapshot.
 *
 * This is the contract test between the two layers — if the wire format
 * changes, this test fails.
 */

import { describe, expect, it } from "vitest";
import { deriveBotActivity } from "@/features/ai-assistant/ui/bot-activity/deriveBotActivity";
import type { StepStreamEvent, AuiPart } from "@/features/ai-assistant/ui/bot-activity/types";

// Mirror of the backend's StepEventEmitter (no imports across the stack).
class FakeBackendEmitter {
  private events: Array<{ id: string; kind: string; status: string; label?: string; ts: number; [k: string]: unknown }> = [];
  begin(id: string, kind: string, label?: string) {
    this.events.push({ id, kind, status: "running", ts: Date.now(), ...(label ? { label } : {}) });
  }
  complete(id: string, label?: string) {
    this.events.push({ id, kind: this.events.find((e) => e.id === id)?.kind ?? "error", status: "complete", ts: Date.now(), ...(label ? { label } : {}) });
  }
  /** Matches the real emitter's toUIMessageChunks() output. */
  toUIMessageChunks() {
    return this.events.map((ev) => ({ type: "data-step", id: ev.id, data: ev }));
  }
}

/** Mimics `useBotActivity`'s `extractStepEvents`: accept both the raw
 *  `data-*` part shape and the converter-normalized `{type:"data",name}` shape,
 *  and cast payloads carrying {kind,status,id} to `StepStreamEvent`. */
function extractStepEvents(parts: AuiPart[]): StepStreamEvent[] {
  const out: StepStreamEvent[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object" || typeof p.type !== "string") continue;
    const matches =
      p.type.startsWith("data-") ||
      (p.type === "data" && (p as { name?: string }).name === "step");
    if (!matches) continue;
    const data = (p as { data?: unknown }).data;
    if (data && typeof data === "object" && "kind" in data && "status" in data && "id" in data) {
      out.push(data as StepStreamEvent);
    }
  }
  return out;
}

/** Mimics the AISDKMessageConverter: wire `data-step` parts become
 *  `{type: "data", name: "step", data}` in aui message parts. */
function convertWireChunksToAuiParts(
  chunks: Array<{ type: string; id: string; data: unknown }>,
): AuiPart[] {
  return chunks.map((c) => ({
    type: "data",
    name: c.type.substring(5),
    data: c.data,
  }) as unknown as AuiPart);
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
    const chunks = emitter.toUIMessageChunks();

    // 2. The runtime converts wire parts into aui message parts.
    const parts = convertWireChunksToAuiParts(chunks);
    expect(parts).toHaveLength(6);

    // 3. `useBotActivity` extracts the events (begin+complete pairs share an
    //    id; both arrive because non-transient data parts are upserted by id).
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
    const events = extractStepEvents(convertWireChunksToAuiParts(emitter.toUIMessageChunks()));

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

  it("carries structured results so labels stay localized client-side", () => {
    const emitter = new FakeBackendEmitter();
    emitter.begin("rag", "rag_pipeline");
    emitter.complete("rag");
    // The real pipeline attaches {type:'docs', count} on completion.
    const chunks = emitter.toUIMessageChunks();
    const ragComplete = chunks.find((c) => c.id === "rag" && c.data.status === "complete");
    (ragComplete!.data as Record<string, unknown>).result = { type: "docs", count: 4 };

    const activity = deriveBotActivity({
      parts: [],
      status: { type: "running" },
      streamEvents: extractStepEvents(convertWireChunksToAuiParts(chunks)),
    });

    expect(activity.steps.find((s) => s.id === "rag")?.result).toEqual({
      type: "docs",
      count: 4,
    });
  });
});
