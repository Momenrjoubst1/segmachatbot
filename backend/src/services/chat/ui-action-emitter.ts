// Injects <ui_action> payloads into the SSE stream for the frontend to execute live.

import type { Response } from "express";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ui-action-emitter");

// Action payload types matching the frontend AgenticUIActionMap.

export interface UIActionPayload {
  target: string;
  action: string;
  payload: Record<string, unknown>;
}

// Helpers that build UI action payloads and tags.

// Build a <ui_action> tag string wrapping the JSON payload for the frontend parser.
export function buildUIActionTag(
  target: string,
  action: string,
  payload: Record<string, unknown> = {},
): string {
  return `<ui_action>${JSON.stringify({ target, action, payload })}</ui_action>`;
}

// Build a type-safe UIActionPayload object.
export function createUIAction(
  target: string,
  action: string,
  payload: Record<string, unknown> = {},
): UIActionPayload {
  return { target, action, payload };
}

// Writing UI actions into the SSE response stream.

// Write a UI action to the SSE stream as a text-delta chunk the parser strips before rendering.
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

// Pre-built UI actions commonly used by the pipeline.

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

/** Open the tasks panel (calendar view with the task list). */
export function panelOpenTasks(): UIActionPayload {
  return createUIAction("panel", "OPEN_TASKS");
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

// Study panel actions — let the model open the student's study tools.

export type StudyPanelTab = "curriculum" | "quiz" | "flashcards" | "progress" | "daily";

/** Open the study dialog, optionally on a specific tab. */
export function studyOpenPanel(tab?: StudyPanelTab, courseId?: string): UIActionPayload {
  return createUIAction("study", "OPEN_STUDY", { ...(tab ? { tab } : {}), ...(courseId ? { courseId } : {}) });
}

/** Open the study dialog directly on the flashcards review session. */
export function studyOpenFlashcards(courseId?: string): UIActionPayload {
  return createUIAction("study", "OPEN_FLASHCARDS", courseId ? { courseId } : {});
}

/** Open the study dialog on the daily study plan. */
export function studyOpenDailyPlan(): UIActionPayload {
  return createUIAction("study", "OPEN_DAILY_PLAN");
}

/** Open the Study Map directly on its quiz tab. */
export function studyOpenQuiz(courseId?: string): UIActionPayload {
  return createUIAction("study", "OPEN_QUIZ", courseId ? { courseId } : {});
}

// System prompt snippet enabling model-emitted UI actions.

// Instructions teaching the LLM how to emit <ui_action> tags in its responses.
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
| panel    | OPEN_TASKS    | {}                         | Open the tasks panel                 |
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

// Study actions are taught to every authenticated student even when the generic
// Octopus protocol is disabled — study tools are invisible otherwise (they live
// behind a small book icon in the sidebar).

export const STUDY_UI_ACTIONS_PROMPT = `
## Study Panel Actions

You can open the student's study panels directly in their interface by emitting a
<ui_action> tag (same format and rules as above — at most ONE per response, at the
END of your reply, never mention the tag).

| Target | Action        | Payload                                          | When to use |
|--------|---------------|--------------------------------------------------|-------------|
| study  | OPEN_STUDY    | { "tab"?: "curriculum"\|"quiz"\|"flashcards"\|"progress"\|"daily" } | The student wants their study tools / study map in general |
| study  | OPEN_FLASHCARDS | {}                                             | The student wants to review flashcards, or you just generated cards for them |
| study  | OPEN_DAILY_PLAN | {}                                             | The student asks what to study today / for their plan |
| study  | OPEN_QUIZ     | {}                                               | The student wants to practice questions from the book map |

Rules:
1. Only use these when the student clearly wants to study or review — never open a panel uninvited.
2. After generating flashcards via the generate_flashcards tool, offer the review panel with OPEN_FLASHCARDS.
3. When the student asks "what should I study today?", open OPEN_DAILY_PLAN and summarize the plan in text as well.
`.trim();
