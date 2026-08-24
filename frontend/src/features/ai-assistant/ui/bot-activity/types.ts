/**
 * Bot Activity types — single source of truth for the status indicator system.
 *
 * Two parallel concepts:
 *  - `BotStatus`   → one value describing the *current overall state* of the
 *                    active message (drives the colored dot, the input morph,
 *                    the sidebar dot, the header pulse).
 *  - `BotStep[]`   → the *timeline* of work that has been done / is being done
 *                    (drives the collapsible step list under the message).
 *
 * The status is *derived* from the steps + parts (see `deriveBotActivity.ts`),
 * not stored separately — that way they can never go out of sync.
 */

// ─── Status ───────────────────────────────────────────────────────────────

export type BotStatus =
  | "idle"
  | "queued"
  | "thinking"
  | "tool_running"
  | "moderating"
  | "compacting"
  | "retrieving"
  | "streaming"
  | "interrupted"
  | "retrying"
  | "error";

/** Ordering used to pick the "highest priority" status when several apply. */
export const STATUS_PRIORITY: ReadonlyArray<BotStatus> = [
  "error",
  "interrupted",
  "retrying",
  "moderating",
  "compacting",
  "retrieving",
  "tool_running",
  "streaming",
  "thinking",
  "queued",
  "idle",
];

// ─── Step kinds ───────────────────────────────────────────────────────────

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
  | "tool_call"        // any registered tool
  | "tool_result"
  | "generation"
  | "error";

export type StepStatus = "pending" | "running" | "complete" | "error" | "skipped";

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

export interface BotStep {
  id: string;                   // stable across the run
  kind: StepKind;
  /** Localized display label. May be rewritten after completion (e.g. "Read 5 sources"). */
  label: string;
  detail?: string;
  status: StepStatus;
  startedAt?: number;           // epoch ms
  completedAt?: number;
  durationMs?: number;
  toolName?: string;            // for tool_call / tool_result
  result?: StepResult;
  error?: string;
}

// ─── Activity snapshot ────────────────────────────────────────────────────

export interface BotActivity {
  status: BotStatus;
  steps: BotStep[];
  currentStep: BotStep | null;
  /** Wall-clock duration since the user clicked send. */
  elapsedMs: number;
  /** Rough token count from streamed text deltas (chars/4). */
  tokenCount: number;
  isStreaming: boolean;
  /** Set when `status === "error"`. */
  errorMessage?: string;
}

// ─── Stream event (data-step protocol) ────────────────────────────────────

/**
 * Custom event emitted by the backend via AI SDK's data-* part protocol.
 * The frontend's runtime captures these into a parallel event log so the
 * step list can be reconstructed even though AI SDK doesn't auto-parse them
 * as `parts`.
 */
export interface StepStreamEvent {
  kind: StepKind;
  status: "running" | "complete" | "error" | "skipped";
  id: string;
  label?: string;
  detail?: string;
  toolName?: string;
  result?: StepResult;
  error?: string;
  ts: number;
}

// ─── AUI parts shape (narrowed) ──────────────────────────────────────────

/** Minimal typing for the AUI parts we read. Avoids importing the AUI types
 *  in this leaf module so the pure derivation stays testable in isolation. */
export interface AuiTextPart { type: "text"; text: string }
export interface AuiReasoningPart {
  type: "reasoning";
  text: string;
  /** assistant-ui part status — "running" while the model streams thoughts. */
  status?: { type: "running" | "complete" | string };
}
export interface AuiToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  status?: { type: "running" | "complete" | "incomplete" | "requires-action" };
}
export interface AuiDataPart { type: `data-${string}`; data: unknown; transient?: boolean }
export type AuiPart = AuiTextPart | AuiReasoningPart | AuiToolCallPart | AuiDataPart | { type: string };

export interface AuiMessageStatusLike {
  type: "running" | "complete" | "requires-action" | "errored" | "stopped" | string;
}
