/**
 * UI Action Emitter — Backend utility for the "Octopus" Agentic UI system.
 *
 * Provides helpers to inject `<ui_action>` payloads into the text stream
 * so the frontend's stream parser can intercept and execute UI commands
 * in real-time during streaming.
 *
 * Two injection strategies:
 *   1. Fast-pass (deterministic): Pipeline injects UI actions directly into
 *      the SSE response BEFORE the model starts streaming. Used for heuristic
 *      intents that don't need LLM reasoning (e.g., "open calendar").
 *   2. Model-emitted: The LLM includes `<ui_action>` tags in its response
 *      when instructed via system prompt. Used for contextual UI changes
 *      that require reasoning (e.g., "after scheduling, ask to modify").
 */

import type { Response } from "express";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ui-action-emitter");

// ---------------------------------------------------------------------------
// Types (must match frontend AgenticUIActionMap)
// ---------------------------------------------------------------------------

export interface UIActionPayload {
  target: string;
  action: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core Utilities
// ---------------------------------------------------------------------------

/**
 * Build a `<ui_action>` tag string that the frontend parser will detect.
 * The tag wraps a JSON payload with `target`, `action`, and `payload` fields.
 */
export function buildUIActionTag(
  target: string,
  action: string,
  payload: Record<string, unknown> = {},
): string {
  return `<ui_action>${JSON.stringify({ target, action, payload })}</ui_action>`;
}

/**
 * Build a complete `UIActionPayload` object (useful for type-safe construction).
 */
export function createUIAction(
  target: string,
  action: string,
  payload: Record<string, unknown> = {},
): UIActionPayload {
  return { target, action, payload };
}

// ---------------------------------------------------------------------------
// SSE Stream Injection
// ---------------------------------------------------------------------------

/**
 * Write a UI action directly to the SSE response stream as a text-delta chunk.
 *
 * The AI SDK's streaming protocol uses `0:"..."` for text deltas. By writing
 * in this format BEFORE `pipeUIMessageStreamToResponse()`, the frontend
 * receives the `<ui_action>` tag as part of the assistant's text content,
 * which the `UIActionStreamParser` strips before rendering.
 *
 * IMPORTANT: Call this AFTER setting response headers but BEFORE the
 * AI SDK begins streaming. The pipeline's Step 10 handles this ordering.
 *
 * @returns `true` if the write succeeded, `false` otherwise.
 */
export function injectUIActionToStream(
  res: Response,
  action: UIActionPayload,
): boolean {
  try {
    const tag = buildUIActionTag(action.target, action.action, action.payload);
    // Write as an AI SDK text-delta chunk
    res.write(`0:${JSON.stringify(tag)}\n`);
    log.info("UI action injected to stream", {
      target: action.target,
      action: action.action,
    });
    return true;
  } catch (err) {
    log.error("Failed to inject UI action to stream", {
      error: (err as Error).message,
      target: action.target,
      action: action.action,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pre-built Actions (commonly used by the pipeline)
// ---------------------------------------------------------------------------

/** Focus the composer and inject text as a follow-up prompt. */
export function composerSetText(text: string): UIActionPayload {
  return createUIAction("composer", "SET_TEXT", { text });
}

/** Toggle the RAG (Knowledge Base) on/off. */
export function headerToggleRag(): UIActionPayload {
  return createUIAction("header", "TOGGLE_RAG");
}

/** Switch the main view between chat and calendar. */
export function headerSetView(view: "chat" | "calendar"): UIActionPayload {
  return createUIAction("header", "SET_VIEW", { view });
}

/** Open the calendar panel. */
export function panelOpenCalendar(): UIActionPayload {
  return createUIAction("panel", "OPEN_CALENDAR");
}

/** Open the email history panel. */
export function panelOpenEmail(): UIActionPayload {
  return createUIAction("panel", "OPEN_EMAIL");
}

/** Open the artifacts panel, optionally focusing a specific artifact. */
export function panelOpenArtifacts(artifactId?: string): UIActionPayload {
  return createUIAction("panel", "OPEN_ARTIFACTS", artifactId ? { artifactId } : {});
}

/** Navigate to a specific thread in the sidebar. */
export function sidebarOpenThread(threadId: string): UIActionPayload {
  return createUIAction("sidebar", "OPEN_THREAD", { threadId });
}

// ---------------------------------------------------------------------------
// System Prompt Snippet (for model-emitted UI actions)
// ---------------------------------------------------------------------------

/**
 * System prompt instructions that tell the LLM when and how to emit
 * `<ui_action>` tags. Append this to the system prompt when you want
 * the model to have the ability to trigger UI actions contextually.
 */
export const UI_ACTION_SYSTEM_PROMPT = `
## UI Action Protocol (Octopus System)

You have the ability to trigger UI actions on the user's frontend by emitting
special tags in your response. The frontend will intercept these tags, execute
the action, and hide them from the user.

**Format:**
<ui_action>{"target": "<target>", "action": "<action>", "payload": {<data>}}</ui_action>

**Available actions:**

| Target   | Action        | Payload                    | When to use                          |
|----------|---------------|----------------------------|--------------------------------------|
| composer | SET_TEXT      | { "text": "..." }          | Pre-fill the input with a follow-up  |
| composer | FOCUS         | {}                         | Focus the composer input             |
| header   | TOGGLE_RAG    | {}                         | Toggle Knowledge Base on/off         |
| header   | SET_VIEW      | { "view": "chat"|"calendar"}| Switch between chat and calendar view |
| panel    | OPEN_CALENDAR | {}                         | Open the calendar panel              |
| panel    | OPEN_EMAIL    | {}                         | Open the email history panel         |
| panel    | OPEN_ARTIFACTS| { "artifactId"?: "..." }   | Open the artifacts panel             |

**Rules:**
1. Place the <ui_action> tag at the END of your response, after your text.
2. You may emit at most ONE ui_action per response.
3. Only emit when the action is clearly beneficial to the user.
4. Never explain the tag to the user — it is invisible to them.

**Example:**
If the user just scheduled a meeting via the calendar tool, you could respond:
"Your meeting has been created for tomorrow at 2 PM. Would you like to modify the time?"
<ui_action>{"target": "composer", "action": "SET_TEXT", "payload": {"text": "Can we change the meeting time to 3 PM?"}}</ui_action>
`.trim();
