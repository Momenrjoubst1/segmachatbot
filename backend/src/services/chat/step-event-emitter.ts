/**
 * StepEventEmitter — buffers pipeline step events and serializes them
 * to AI SDK v6 data-step stream chunks.
 *
 * Usage:
 *   const emitter = new StepEventEmitter();
 *   emitter.begin("moderation", "moderation");
 *   await doWork();
 *   emitter.complete("moderation", { result: { type: "text", count: 1 } });
 *   ...
 *   res.write(emitter.toStreamChunks());   // writes `a:{"type":"data-step",...}\n` per event
 *
 * Wire format (AI SDK v6 UI message stream protocol):
 *   a:{"type":"data-step","data":{...event...},"transient":true}\n
 *
 * `transient: true` tells the AI SDK runtime (frontend) NOT to persist these
 * parts in message history. They are only meaningful for the live stream.
 */

export type StepKind =
  | "moderation"
  | "intent_detection"
  | "memory_context"
  | "rag_pipeline"
  | "fetch_user_courses"
  | "thread_resolution"
  | "context_window"
  | "persist_message"
  | "ui_fastpass"
  | "tool_call"
  | "tool_result"
  | "generation"
  | "error";

export type StepStatus = "running" | "complete" | "error" | "skipped";

export interface StepResultItem {
  title?: string;
  url?: string;
  preview?: string;
}

export interface StepResult {
  type: "docs" | "pages" | "data" | "text";
  count?: number;
  items?: StepResultItem[];
}

export interface StepEvent {
  id: string;
  kind: StepKind;
  status: StepStatus;
  label?: string;
  detail?: string;
  toolName?: string;
  result?: StepResult;
  error?: string;
  /** epoch ms when this event was emitted */
  ts: number;
}

export class StepEventEmitter {
  private events: StepEvent[] = [];
  private startTimes = new Map<string, number>();
  private kindById = new Map<string, StepKind>();

  /** Mark a step as started. Captures wall-clock time for duration calc. */
  begin(
    id: string,
    kind: StepKind,
    opts: { label?: string; toolName?: string } = {},
  ): void {
    const ts = Date.now();
    this.startTimes.set(id, ts);
    this.kindById.set(id, kind);
    this.events.push({
      id,
      kind,
      status: "running",
      ts,
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      ...(opts.toolName !== undefined ? { toolName: opts.toolName } : {}),
    });
  }

  /** Mark a step as complete (success). */
  complete(
    id: string,
    opts: { label?: string; detail?: string; result?: StepResult } = {},
  ): void {
    const ts = Date.now();
    const kind = this.kindById.get(id) ?? "error";
    this.events.push({
      id,
      kind,
      status: "complete",
      ts,
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      ...(opts.result !== undefined ? { result: opts.result } : {}),
    });
  }

  /** Mark a step as failed. The kind is preserved from `begin()`. */
  fail(id: string, error: string): void {
    const ts = Date.now();
    const kind = this.kindById.get(id) ?? "error";
    this.events.push({ id, kind, status: "error", error, ts });
  }

  /** Read-only snapshot of all buffered events. Returns a copy so callers
   *  cannot mutate internal state. */
  getEvents(): readonly StepEvent[] {
    return [...this.events];
  }

  /** Count of events buffered so far (used by tests + debugging). */
  size(): number {
    return this.events.length;
  }

  /**
   * Serialize all buffered events as AI SDK v6 SSE data chunks.
   *
   * Wire format (used by the SDK's `JsonToSseTransformStream`):
   *   data: {"type":"data-step","data":{...event...},"transient":true}\n\n
   *
   * Each event becomes exactly one chunk. `transient: true` prevents the
   * frontend from persisting these into message history — they are only
   * meaningful for the live stream.
   */
  toStreamChunks(): string {
    if (this.events.length === 0) return "";
    const lines: string[] = [];
    for (const ev of this.events) {
      lines.push(
        `data: ${JSON.stringify({
          type: "data-step",
          data: ev,
          transient: true,
        })}\n\n`,
      );
    }
    return lines.join("");
  }
}
