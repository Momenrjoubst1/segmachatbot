// StepEventEmitter buffers pipeline step events and serializes them as AI SDK v6 data-step chunks.

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

  // Return a defensive copy of all buffered events.
  getEvents(): readonly StepEvent[] {
    return [...this.events];
  }

  /** Count of events buffered so far (used by tests + debugging). */
  size(): number {
    return this.events.length;
  }

  // Serialize buffered events as AI SDK v6 SSE data chunks, marked transient.
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
