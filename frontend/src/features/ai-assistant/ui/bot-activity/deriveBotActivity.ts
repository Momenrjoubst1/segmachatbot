/**
 * Pure derivation from AUI parts + custom step events → `BotActivity`.
 *
 * This is the *single source of truth* for everything the status indicator
 * system displays. It must stay:
 *  - pure (no side effects, no `Date.now()` outside the optional `now` arg)
 *  - synchronous
 *  - deterministic for a given input
 *
 * That makes it trivial to unit-test (see `deriveBotActivity.test.ts`).
 */

import {
  STATUS_PRIORITY,
  type AuiMessageStatusLike,
  type AuiPart,
  type BotActivity,
  type BotStatus,
  type BotStep,
  type StepKind,
  type StepStreamEvent,
} from "./types";

// ─── Tool name → human label (post-hoc derivation) ────────────────────────
//
// Tool steps arrive by *kind* ("tool_call") + a *toolName* string. We want
// the step list to read like:
//   ✓ Searched the web for "calculus limits"
//   ✓ Calculated 5 + 3
//   ✓ Read 3 chapters
//
// `getToolLabel` is a pure lookup; richer templating (with the actual args)
// lives in the i18n layer (see `stepLabel.ts`).

const TOOL_KIND: Record<string, StepKind> = {
  web_search: "tool_call",
  calculator: "tool_call",
  get_time: "tool_call",
  get_weather: "tool_call",
  send_email: "tool_call",
  create_calendar_event: "tool_call",
  get_course_info: "tool_call",
  generate_flashcards: "tool_call",
  code_executor: "tool_call",
  create_artifact: "tool_call",
};

/** Default sub-label for a tool when the i18n layer hasn't provided one. */
export function getToolSubLabel(toolName: string): string {
  // snake_case → "Snake case"
  return toolName
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// ─── Derivation ───────────────────────────────────────────────────────────

export interface DeriveInput {
  parts: AuiPart[] | undefined | null;
  status: AuiMessageStatusLike | undefined | null;
  /** Custom data-step events captured from the SSE stream. */
  streamEvents?: StepStreamEvent[];
  /** When the user clicked send. */
  messageStartTs?: number | null;
  /** "Now" — passed in for testability. */
  now?: number;
}

const IDLE: BotActivity = {
  status: "idle",
  steps: [],
  currentStep: null,
  elapsedMs: 0,
  tokenCount: 0,
  isStreaming: false,
};

export function deriveBotActivity(input: DeriveInput): BotActivity {
  const now = input.now ?? Date.now();
  const parts = input.parts ?? [];
  const status = input.status;
  const events = input.streamEvents ?? [];

  // 1. Build steps from explicit stream events (preferred — has labels + results).
  const steps = buildStepsFromEvents(events, now);

  // 2. Augment with AUI parts (tool-call, reasoning, text) that the SDK
  //    auto-tracks. We merge by id so an event-emitted step and an AUI part
  //    describing the same work are deduped, with the event winning on
  //    labels and results.
  mergeFromParts(steps, parts, now);

  // Start-of-run timestamp: explicit when the caller tracks it, otherwise
  // inferred from the earliest step so the elapsed timer still works
  // (`useBotActivity` doesn't track messageStartTs today).
  const startTs = input.messageStartTs ?? steps[0]?.startedAt ?? null;

  if (!status) return { ...IDLE, steps, elapsedMs: startTs ? Math.max(0, now - startTs) : 0 };

  // 3. Token count = sum of text-delta lengths / 4 (rough GPT-style).
  const tokenCount = sumTokenEstimate(parts);

  // 4. Resolve overall status.
  const isRunning = status.type === "running";
  const isErrored = status.type === "errored";
  const isStopped = status.type === "stopped";

  let resolved: BotStatus;
  let errorMessage: string | undefined;

  if (isErrored) {
    resolved = "error";
    const errStep = [...steps].reverse().find((s) => s.status === "error");
    errorMessage = errStep?.error ?? "Stream failed";
  } else if (isStopped) {
    resolved = "interrupted";
  } else if (!isRunning) {
    // Not running, not errored, not stopped. Could be "complete" — if any
    // step is still "running", leave it as "thinking" (rare: late complete
    // after an event lost its 'complete' signal).
    const stillRunning = steps.some((s) => s.status === "running");
    if (stillRunning) {
      resolved = "thinking";
    } else {
      resolved = "idle";
    }
  } else {
    // Running. Pick the highest-priority status that applies.
    resolved = pickRunningStatus(steps, parts);
  }

  // 5. Clamp resolved to highest priority if steps suggest something else.
  //    (Helps when e.g. error is set on a step but overall status is "running".)
  if (resolved !== "error") {
    const hasError = steps.some((s) => s.status === "error");
    if (hasError && !isErrored) {
      // Don't override running with error mid-flight; the step itself is error-styled.
    }
  }

  const currentStep = [...steps].reverse().find((s) => s.status === "running") ?? null;
  const isStreaming = resolved === "streaming";

  return {
    status: resolved,
    steps,
    currentStep,
    elapsedMs: startTs ? Math.max(0, now - startTs) : 0,
    tokenCount,
    isStreaming,
    errorMessage,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildStepsFromEvents(events: StepStreamEvent[], now: number): BotStep[] {
  const map = new Map<string, BotStep>();

  for (const ev of events) {
    const existing = map.get(ev.id);
    if (!existing) {
      // If we only ever see a "complete" event (no prior "running"),
      // use the event's ts as both startedAt and completedAt — the backend
      // emits "running" → "complete" pairs, so missing "running" is rare,
      // and we need *some* timestamp for ordering.
      const inferredStart = ev.status === "running" ? ev.ts : ev.ts;
      map.set(ev.id, {
        id: ev.id,
        kind: ev.kind,
        label: ev.label ?? defaultLabelForKind(ev.kind),
        detail: ev.detail,
        status: ev.status === "running" ? "running" : ev.status === "error" ? "error" : ev.status === "skipped" ? "skipped" : "complete",
        startedAt: inferredStart,
        completedAt: ev.status !== "running" ? ev.ts : undefined,
        toolName: ev.toolName,
        result: ev.result,
        error: ev.error,
      });
    } else {
      // Update on the same id.
      existing.status =
        ev.status === "running" ? "running" :
        ev.status === "error" ? "error" :
        ev.status === "skipped" ? "skipped" : "complete";
      if (ev.label) existing.label = ev.label;
      if (ev.detail !== undefined) existing.detail = ev.detail;
      if (ev.result) existing.result = ev.result;
      if (ev.error) existing.error = ev.error;
      if (ev.status !== "running") {
        existing.completedAt = ev.ts;
        existing.durationMs = ev.ts - (existing.startedAt ?? ev.ts);
      } else {
        existing.startedAt = ev.ts;
      }
    }
  }

  // Re-time durations for running steps against `now`.
  for (const s of map.values()) {
    if (s.status === "running" && s.startedAt !== undefined) {
      s.durationMs = Math.max(0, now - s.startedAt);
    }
  }

  // Sort by startedAt (unknowns last).
  return [...map.values()].sort((a, b) => {
    const at = a.startedAt ?? Number.POSITIVE_INFINITY;
    const bt = b.startedAt ?? Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

function mergeFromParts(steps: BotStep[], parts: AuiPart[], now: number): void {
  for (const part of parts) {
    if (part.type === "tool-call") {
      const t = part as Extract<AuiPart, { type: "tool-call" }>;
      const id = `tool-${t.toolCallId}`;
      const existing = steps.find((s) => s.id === id);
      const kind: StepKind = TOOL_KIND[t.toolName] ?? "tool_call";
      const status =
        t.status?.type === "complete" ? "complete" :
        t.status?.type === "incomplete" ? "error" :
        t.status?.type === "requires-action" ? "pending" :
        "running";
      if (!existing) {
        steps.push({
          id,
          kind,
          label: getToolSubLabel(t.toolName),
          status,
          toolName: t.toolName,
        });
      } else {
        // Don't override event-provided labels.
        existing.status = status;
        if (status === "complete" && existing.startedAt !== undefined && !existing.completedAt) {
          existing.completedAt = now;
          existing.durationMs = now - existing.startedAt;
        }
      }
    } else if (part.type === "data-step") {
      // The data step was already converted by the runtime into an event
      // before reaching this function (via the streamEvents arg). Nothing to do.
    }
  }
}

function sumTokenEstimate(parts: AuiPart[]): number {
  let chars = 0;
  for (const p of parts) {
    if (p.type === "text") {
      const t = p as Extract<AuiPart, { type: "text" }>;
      chars += t.text?.length ?? 0;
    }
  }
  return Math.round(chars / 4);
}

function pickRunningStatus(steps: BotStep[], parts: AuiPart[]): BotStatus {
  // Precedence: any running step with a high-priority kind wins first.
  const running = steps.filter((s) => s.status === "running");
  if (running.length > 0) {
    // Latest running step wins.
    const last = running[running.length - 1];
    return statusForKind(last.kind);
  }

  // No running step but status says we're running — check parts directly.
  const hasText = parts.some((p) => p.type === "text" && (p as Extract<AuiPart, { type: "text" }>).text.length > 0);
  if (hasText) return "streaming";

  const hasTool = parts.some((p) => p.type === "tool-call");
  if (hasTool) return "tool_running";

  const hasReasoning = parts.some((p) => p.type === "reasoning");
  if (hasReasoning) return "thinking";

  return "thinking";
}

function statusForKind(kind: StepKind): BotStatus {
  switch (kind) {
    case "moderation":       return "moderating";
    case "rag_pipeline":     return "retrieving";
    case "memory_context":   return "retrieving";
    case "fetch_user_courses": return "retrieving";
    case "context_window":   return "compacting";
    case "persist_message":  return "thinking";
    case "intent_detection": return "thinking";
    case "ui_fastpass":      return "thinking";
    case "thread_resolution":return "thinking";
    case "tool_call":        return "tool_running";
    case "tool_result":      return "tool_running";
    case "generation":       return "streaming";
    case "error":            return "error";
    default:                 return "thinking";
  }
}

function defaultLabelForKind(kind: StepKind): string {
  // Keys here intentionally match the i18n namespace `botStatus.steps.<kind>`
  // — the i18n layer maps these to localized labels.
  return kind;
}

// ─── Utilities ────────────────────────────────────────────────────────────

/** Format an elapsed-ms value for display: `340ms`, `1.2s`, `1m 04s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 10) * 10)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

/** Pick the highest-priority status from a list. */
export function highestPriority(statuses: BotStatus[]): BotStatus {
  for (const candidate of STATUS_PRIORITY) {
    if (statuses.includes(candidate)) return candidate;
  }
  return "idle";
}
