# Bot Status Indicator System — Implementation Plan

> **Scope**: Full multi-location (inline + input + header + sidebar)
> **Depth**: Collapsible step list (Claude.ai style)
> **Style**: Minimalist (Claude.ai)

---

## 1. Goals & Non-Goals

### Goals
- Give users **real-time visibility** into what the bot is doing (thinking, searching, generating, moderating, etc.)
- Show **per-step progress** that is collapsible into a clean summary when the message arrives
- Surface **non-text work** (RAG, moderation, memory, intent detection) that today is invisible
- Reuse the **existing `useAuiState` parts/status pipeline** instead of building a parallel one
- Stay **deferentially quiet** when idle (Minimalist style)

### Non-Goals (this iteration)
- No audio/voice progress
- No per-token animation (we stream, not typewriter)
- No re-architecture of the SSE/AI-SDK protocol
- No analytics/telemetry on step durations (we'll log locally, can wire later)

---

## 2. State Model

### Top-level `BotStatus` (one per active message)

```ts
// frontend/src/features/ai-assistant/ui/bot-activity/types.ts
export type BotStatus =
  | "idle"
  | "queued"          // waiting to be picked up
  | "thinking"        // model reasoning, no output yet
  | "tool_running"    // a tool is executing (sub-status shows which)
  | "moderating"      // content moderation in flight
  | "compacting"      // context-window compacting
  | "retrieving"      // RAG / memory retrieval
  | "streaming"       // tokens are coming
  | "interrupted"     // user stopped
  | "retrying"        // auto-retry after error
  | "error";          // failed
```

### `BotStep` (timeline of work)

```ts
export type StepKind =
  | "moderation"
  | "intent_detection"
  | "memory_context"
  | "rag_pipeline"
  | "fetch_user_courses"
  | "thread_resolution"
  | "context_window"
  | "ui_fastpass"
  | "tool_call"        // any registered tool (calculator, search, ...)
  | "tool_result"
  | "generation"       // final answer streamed
  | "error";

export type StepStatus = "pending" | "running" | "complete" | "error" | "skipped";

export interface BotStep {
  id: string;                   // stable across the run
  kind: StepKind;
  label: string;                // "Searched 5 sources" (post-hoc, derived from kind+result)
  detail?: string;              // optional longer text
  status: StepStatus;
  startedAt?: number;           // epoch ms
  completedAt?: number;
  durationMs?: number;
  toolName?: string;            // for tool_call/tool_result
  result?: {
    type: "docs" | "pages" | "data" | "text";
    count?: number;
    items?: Array<{ title?: string; url?: string; preview?: string }>;
  };
  error?: string;
}
```

### Status precedence (for the single `BotStatus` field)

```
error > interrupted > retrying > moderating > compacting > retrieving > tool_running > streaming > thinking > queued > idle
```

First non-idle state in this order wins.

---

## 3. Component Tree

```
features/ai-assistant/
├── ui/
│   ├── bot-activity/                          ← NEW MODULE
│   │   ├── types.ts
│   │   ├── deriveBotActivity.ts               ← pure fn: parts+events → {status, steps, ...}
│   │   ├── BotActivityProvider.tsx            ← context, holds derived state per active message
│   │   ├── useBotActivity.ts                  ← hook to read it
│   │   ├── components/
│   │   │   ├── BotStatusInline.tsx            ← inline status (was BotStatusWidget) — collapsible
│   │   │   ├── BotStepList.tsx                ← collapsible list of completed steps
│   │   │   ├── BotStepRow.tsx                 ← one row: icon + label + duration + result
│   │   │   ├── BotStatusInput.tsx             ← input bar stop-button + token counter
│   │   │   ├── BotStatusHeaderDot.tsx         ← header dot, pulses while busy
│   │   │   ├── BotStatusSidebarDot.tsx        ← per-thread dot in thread list
│   │   │   ├── BotStatusEmpty.tsx             ← first-token skeleton in empty thread
│   │   │   ├── BotStatusError.tsx             ← error with retry
│   │   │   ├── BotStatusInterrupted.tsx       ← interrupted notice
│   │   │   └── icons.tsx                      ← consistent line-icon set
│   │   ├── tokens.ts                          ← token counting hook (rough char/4 estimate)
│   │   └── styles.css                         ← shared CSS (or tailwind classes)
│   ├── useBotStatus.ts                        ← DEPRECATED in favor of useBotActivity
│   ├── BotStatusWidget.tsx                    ← THIN WRAPPER re-exporting BotStatusInline
│   └── useChatRuntime.ts                      ← no changes (already exposes parts+status)
├── context/
│   ├── sendStateBridge.ts                     ← keep (used by input morph)
│   └── ...
```

---

## 4. Data Flow

```
[Backend stream]
  ├─ text-delta / tool-call / tool-result      (AI SDK protocol, today)
  └─ data-step:{kind,status,label,result,...}  (NEW — custom data- events)
        ↓
[Frontend AI SDK runtime]
  └─ useAuiState → message.parts
        ↓
[deriveBotActivity(parts, streamEvents)]   (pure)
  → { status, steps, currentStep, elapsedMs, tokenCount, isStreaming }
        ↓
[BotActivityProvider] (React context, per thread)
        ↓
[4 consumers]
  ├─ <BotStatusInline/>        under the active message
  ├─ <BotStatusInput/>         morph input bar to stop + counter
  ├─ <BotStatusHeaderDot/>     top app bar
  └─ <BotStatusSidebarDot/>    per thread row in sidebar
```

### Why a context, not a hook called from 4 places?
- The same derivation runs once per message, not 4x
- Step timings (startedAt/completedAt) need a stable ref across re-renders
- Sidebar dot must update when only the message changes, not the whole thread tree

### Why not extend `useAuiState` directly?
- We need wall-clock durations that only exist client-side
- We need to interpret custom `data-step` events that AI SDK doesn't auto-parse into `parts`
- The custom data events are kept in a parallel `streamEvents: StreamEvent[]` array

---

## 5. Backend Changes (the only invasive part)

### 5.1 New event emitter service

`backend/src/services/chat/step-event-emitter.ts`

```ts
export type StepEvent =
  | { type: "step"; kind: BotStep["kind"]; status: "running" | "complete" | "error" | "skipped"; id: string;
      label?: string; detail?: string; toolName?: string; result?: BotStep["result"]; error?: string;
      ts: number };

export function formatStepAsDataEvent(ev: StepEvent): string {
  // AI SDK v6 data- part: e.g. `a:{"type":"data-step","data":{...}}` or `f:{"name":"step",...}`
  // We'll use the new v6 `data-${name}` part format.
  return JSON.stringify({
    type: "data-step",
    data: ev,
    transient: true,   // not persisted to message history
  });
}
```

### 5.2 Wrap `streamText` in a `createUIMessageStream` so we can interleave

In `response-generator.service.ts`, replace:

```ts
const result = streamText(streamOptions);
result.pipeUIMessageStreamToResponse(res);
```

with:

```ts
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

const stepWriter = createStepEventWriter();  // captures events to write
const result = streamText({
  ...streamOptions,
  // existing onChunk / onError / onFinish stay
});

const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    // Emit pre-pipeline steps (moderation, intent, memory, RAG, etc.)
    writer.write({ type: "data-step", data: stepWriter.flushPending() });
    // Merge AI SDK stream
    writer.merge(result.toUIMessageStream({ onError: ... }));
  },
  onError: ...,
});

return createUIMessageStreamResponse({ stream });
```

### 5.3 Emit steps from the pipeline

Each existing `await`-ed stage in `chat.pipeline.ts` wraps its work in a step:

```ts
const moderationStep = stepWriter.begin({ id: "moderation", kind: "moderation", label: "Checking content" });
await moderateInput(...);
moderationStep.complete({ detail: "Allowed" });

// ...
const ragStep = stepWriter.begin({ id: "rag", kind: "rag_pipeline", label: "Searching knowledge base" });
const ragResult = await runRagPipeline(...);
ragStep.complete({
  label: ragResult.rankedDocs.length > 0
    ? `Read ${ragResult.rankedDocs.length} sources`
    : "No relevant sources",
  result: { type: "docs", count: ragResult.rankedDocs.length,
            items: ragResult.rankedDocs.slice(0,3).map(d => ({ title: d.title, preview: d.snippet })) },
});
```

### 5.4 Persist last-run steps per message

Add a `last_steps: jsonb` column on `chat_messages` (or piggyback on a new `chat_message_steps` table — we prefer the new table for clean history). Migration:

```sql
create table chat_message_steps (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references chat_messages(id) on delete cascade,
  step_index int not null,
  kind text not null,
  status text not null,
  label text,
  detail text,
  tool_name text,
  result jsonb,
  duration_ms int,
  error text,
  created_at timestamptz default now()
);
create index on chat_message_steps (message_id, step_index);
```

This lets the **collapsible step list in past messages** show the same steps — Claude.ai does this on hover/expand of historical messages. Big UX win, almost free if we wire it during the same change.

### 5.5 Graceful degradation

- If the client is on an **older version** that doesn't understand `data-step`, the AI SDK parser will **silently drop** unknown part types (verified behavior of v6). ✅
- Guest route (`legacyGuestStreamToUIMessageStream` on the frontend) will need a small additive branch: if a line is `a:{...data-step...}`, skip it instead of trying to parse as text. ✅

---

## 6. Frontend Details

### 6.1 `deriveBotActivity(parts, streamEvents, messageStartTs)`

Pure function. Inputs:
- `parts` from `useAuiState` (current message parts: text, tool-call, tool-result, reasoning)
- `streamEvents`: client-side buffer of `data-step` events captured by the runtime
- `messageStartTs`: when the user clicked send

Outputs:
- `status: BotStatus`
- `steps: BotStep[]`     ← completed + currently running
- `currentStep: BotStep | null`
- `elapsedMs: number`
- `tokenCount: number`    ← sum of `text-delta` lengths / 4
- `isStreaming: boolean`

This function is **the single source of truth**. Tests live in `__tests__/deriveBotActivity.test.ts` and cover every state transition (no need to mount React for state logic).

### 6.2 `<BotStatusInline>` (the new widget under the message)

Visual: Minimalist Claude style — a quiet single row, collapses to a small chip when done.

```
┌─ while running ────────────────────────────────────────────────┐
│ ● Thinking…                                          ⏱ 2.3s   │
│   └─ ✓ Checked content          120ms                           │
│   └─ ✓ Loaded memory            340ms                           │
│   └─ ● Searching knowledge base 1.1s ◉                          │
│   └─ ⏸ Generating                                           ▸  │
└────────────────────────────────────────────────────────────────┘

┌─ after stream ends ───────────────────────────────────────────┐
│ ✓ 4 steps · 4.2s                                       ▾      │
└────────────────────────────────────────────────────────────────┘
   ▾ expanded:
   ✓ Checked content        120ms
   ✓ Loaded memory          340ms
   ✓ Read 5 sources         1.1s
   ✓ Generated response     2.7s
```

States:
- **Idle**: not rendered (zero DOM)
- **Running**: row + (optionally) expanded steps. Click to toggle.
- **Done**: tiny summary chip. Click to expand.
- **Error**: red dot, error message, "Retry" button.
- **Interrupted**: orange dot, "Stopped" + "Resume" / "Regenerate" buttons.

### 6.3 `<BotStatusInput>` (input bar morph)

Current `sendStateBridge` already exposes `submitting | streaming | idle`. We extend it to expose `tokenCount` and `elapsedMs`.

Visual states:
- `idle`    → normal input, send button
- `submitting` → input disabled, send button → "Stop" button (square icon, red on hover)
- `streaming` → input stays editable, send button → "Stop" button, **right side shows "142 tokens · 1.2s"**
- `interrupted` → input cleared, "Regenerate" button appears

### 6.4 `<BotStatusHeaderDot>`

Top app bar (next to the "Sigma" logo or as a global indicator).

```
Sigma  ●
        ↑
   small pulsing dot while any message in the active thread is running
   matches the inline widget's color
```

### 6.5 `<BotStatusSidebarDot>`

Per-thread row in the left sidebar. Today the thread list shows only the title. We add a tiny dot:
- Gray: idle
- Pulsing primary: running
- Red: last message errored
- Orange: last message interrupted

This requires the thread list to subscribe to per-thread activity. Implementation: a lightweight `useThreadsActivity()` hook that subscribes to the `BotActivityProvider` for the active thread and a `Map<threadId, lastStatus>` for the rest. When a thread switch happens, the previous thread's last status stays cached.

---

## 7. Styling Guidelines (Minimalist / Claude.ai)

- **Color palette** (additions, not replacements):
  - `--status-running`: subtle violet (matches existing `bg-primary/60`)
  - `--status-complete`: muted green
  - `--status-error`: muted red
  - `--status-interrupted`: muted amber
  - All low-saturation, ~40-50% lightness, on light/dark theme-aware tokens
- **Typography**:
  - Status labels: 13px, `font-medium`, `text-muted-foreground`
  - Step labels: 12px, `font-normal`, `text-muted-foreground/80`
  - Counters/durations: 11px, `tabular-nums`, `text-muted-foreground/60`
- **Spacing**: 8px grid. Pill padding `px-3 py-1.5`. Step rows 4px vertical gap.
- **Animation** (all subtle, 200-400ms):
  - Pulsing dot: `2s ease-in-out infinite` opacity 0.4↔1
  - Thinking dots: same `dotPulse` we have today
  - Collapse/expand: 200ms height transition, no bounce
- **No** sparkle, gradient orbs, confetti, glow.

---

## 8. Implementation Order (one PR per milestone)

### M0 — Foundation (½ day)
- Add types + `deriveBotActivity` + unit tests
- Add `BotActivityProvider` skeleton, wire into `AssistantApp`
- Add `useBotActivity()` hook returning `{ status: "idle", steps: [] }`
- Verify: existing chat still works, no UI changes yet

### M1 — Inline widget upgrade (½ day)
- Build `<BotStatusInline>` + `<BotStepList>` + `<BotStepRow>`
- Replace `BotStatusWidget` import sites
- Keep current `useAuiState` derivation (no backend changes yet)
- Verify: each tool call still shows its pill, but now with timing + collapse

### M2 — Backend step events (1 day)
- Implement `step-event-emitter.ts`
- Wrap `streamText` with `createUIMessageStream`
- Emit steps from `chat.pipeline.ts` (moderation, RAG, memory, intent, fetch_user_courses, thread_resolution, context_window, ui_fastpass)
- Persist `chat_message_steps` rows
- Add `data-step` parsing on frontend
- Verify: inline widget now shows internal pipeline steps (not just tools)

### M3 — Input bar morph (½ day)
- Extend `sendStateBridge` with `tokenCount`, `elapsedMs`
- Build `<BotStatusInput>` overlay on the input component
- Wire Stop button to existing `abortRef` in `useChatRuntime`
- Add Regenerate on interrupted
- Verify: clicking send morphs input; clicking stop cancels; counter updates live

### M4 — Header + Sidebar dots (½ day)
- Build `<BotStatusHeaderDot>` and mount in app shell
- Build `<BotStatusSidebarDot>` and add to thread list rows
- `useThreadsActivity()` hook with `Map<threadId, ThreadStatus>` cache
- Verify: header pulses while running; per-thread dot reflects state

### M5 — Polish — ✅ DONE

- **Empty-state skeleton** (`MessageSkeleton`): two-line placeholder that shows inside the assistant message bubble while the bot is working but hasn't produced any text yet. Auto-hides on first token. Honors `prefers-reduced-motion`.
- **`prefers-reduced-motion`**: all inline animations (`IconLoader` spin, `dotPulse`, `animate-pulse` skeleton, `botPulse` halo) now use `motion-reduce:hidden` / `motion-reduce:animate-none`.
- **Keyboard a11y**: `BotStatusInline` is rendered as a `<button>` with `aria-expanded` + `aria-label`, so Space/Enter toggle disclosure natively. `BotStatusPulseDot` has `aria-label="Bot status: <state>"`.
- **Past-message step list**: skipped per user choice (no DB persistence).
- Past-message step list: read from `chat_message_steps` when expanding historical messages
- Keyboard a11y: arrow + space to collapse/expand
- `prefers-reduced-motion`: disable pulsing, use static dot
- Empty-state skeleton: when user sends first message in a fresh thread, show a 2-line skeleton until first token
- Storybook entries for each component (if storybook exists; otherwise just a `demo` route)

### M6 — Observability (optional, ¼ day)
- Local-only: log step durations to console in dev
- Wire to existing Sentry as breadcrumbs (already in deps)

### M2 — Backend step events — ✅ DONE (no DB persistence per user choice)

Implemented:
- `backend/src/services/chat/step-event-emitter.ts` — buffers `running → complete` event pairs, serializes to AI SDK v6 SSE wire format (`data: {"type":"data-step",...}\n\n`, `transient: true`).
- `chat.pipeline.ts` — emitter instance wraps every step (moderation, intent, RAG, memory, fetch_user_courses, thread_resolution, persist_message, context_window, ui_fastpass). Step events are flushed to `res` AFTER headers are set and BEFORE `generateAndStreamResponse()`.
- New `StepKind` value: `persist_message` (added to both backend and frontend types + i18n).
- Backend: 6 unit tests for the emitter; full backend suite **232/234 passing** (2 pre-existing moderation tests fail).
- Frontend: 3 new integration tests that round-trip the wire format end-to-end; full suite **223/223 passing**.
- **Skipped**: chat_message_steps DB persistence, and per-step event emission during streaming (we emit a single burst of completed steps before the LLM stream — this matches Claude.ai's "show the full timeline before generation" UX).

---

## 9. Testing Strategy

| Layer | What to test | How |
|---|---|---|
| `deriveBotActivity` | All state transitions, edge cases (tool errors, interruptions, missing events) | Vitest unit tests, 100% branch coverage |
| `BotActivityProvider` | Updates on parts change, no double-fire | React Testing Library |
| `BotStatusInline` | Renders each state, collapse interaction, a11y | RTL + jest-axe |
| Backend step events | End-to-end: send a message that triggers RAG, verify 4 `data-step` events arrive in order | Supertest + parse SSE |
| Visual regression | Snapshots of each state at 3 themes (light, dark, high-contrast) | Playwright |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| AI SDK v6 silently drops unknown data parts on old clients | Confirmed in v6 docs; the inline widget gracefully falls back to current behavior |
| Adding `chat_message_steps` table blocks on migration | Run as a non-blocking ALTER + backfill in a separate deploy; offline-safe |
| Per-step timing jitter from `Date.now()` on slow devices | Use `performance.now()` everywhere; round durations to nearest 10ms for display |
| Sidebar dot updates cause every row to re-render | Memoize per-row; only re-render rows whose status actually changed |
| Pulsing animations bother users with vestibular disorders | Honor `prefers-reduced-motion` (M5) |
| Step labels leak PII (e.g. search query text in `label`) | `result.items[].preview` is sanitized server-side; only safe snippets go in `detail` |

---

## 11. Open Questions for the User (to lock before M2)

1. **Persistence**: do you want step history visible in **past messages** (M5) or only on the currently-running message? (Recommendation: yes, past messages, since the data is already in the DB.)
2. **PII in step details**: are tool inputs (e.g. the user's email subject, the search query) safe to surface in the step list, or do we want a strict "no raw inputs" rule?
3. **i18n**: step labels are currently hardcoded in English in `useBotStatus.ts`. Do you want them in `ar` + `en` from day 1, or English-only for M1 and i18n in M5?
4. **Step capping**: should we show **all** steps or only the last N (e.g. 6) with a "Show more" link? My recommendation: show all when ≤6, otherwise collapse to top 4 + "Show all".
