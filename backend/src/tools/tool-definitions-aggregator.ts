import { getToolSchemas } from "./tool-registry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("tools");

const TOOL_IMPORTS: Array<{ name: string; importFn: () => Promise<unknown> }> = [
  { name: "calculator", importFn: () => import("./calculator/index.js") },
  { name: "time", importFn: () => import("./utils/time/index.js") },
  { name: "weather", importFn: () => import("./utils/weather/index.js") },
  { name: "web_search", importFn: () => import("./web/search/index.js") },
  { name: "send_email", importFn: () => import("./email/send/index.js") },
  { name: "email_history", importFn: () => import("./email/history/index.js") },
  { name: "email_contacts", importFn: () => import("./email/contacts/index.js") },
  { name: "create_event", importFn: () => import("./calendar/create-event/index.js") },
  { name: "course_info", importFn: () => import("./education/course-info/index.js") },
  { name: "flashcards", importFn: () => import("./education/flashcards/index.js") },
  { name: "quiz_tracker", importFn: () => import("./education/quiz-tracker/index.js") },
  { name: "generate_image", importFn: () => import("./media/generate-image/index.js") },
  { name: "code_executor", importFn: () => import("./code/executor/index.js") },
  { name: "create_artifact", importFn: () => import("./files/create-artifact/index.js") },
  { name: "fonts", importFn: () => import("./utils/fonts/index.js") },
  { name: "ide_manager", importFn: () => import("./code/ide-manager/index.js") },
  { name: "calendar_query", importFn: () => import("./calendar/query/index.js") },
  { name: "upcoming_events", importFn: () => import("./calendar/query/get-upcoming-events.js") },
  { name: "find_free_slots", importFn: () => import("./calendar/query/find-free-slots.js") },
  { name: "calendar_insights", importFn: () => import("./calendar/query/calendar-insights.js") },
  { name: "delete_calendar_event", importFn: () => import("./calendar/query/delete-calendar-event.js") },
  { name: "scheduler", importFn: () => import("./calendar/scheduler/index.js") },
  { name: "find_optimal_time", importFn: () => import("./calendar/scheduler/find-optimal-time.js") },
  { name: "email_to_meeting", importFn: () => import("./calendar/scheduler/email-to-meeting.js") },
  { name: "tasks", importFn: () => import("./tasks/index.js") },
];

let toolsInitialized = false;

/**
 * Initialize all tool modules. Call this explicitly from the server entry
 * point AFTER environment validation — do NOT call at import time.
 * Individual tool failures are caught and logged; they don't crash the process.
 */
export async function initTools(): Promise<void> {
  if (toolsInitialized) return;

  const loaded: string[] = [];
  const failed: string[] = [];

  const results = await Promise.allSettled(
    TOOL_IMPORTS.map(async ({ name, importFn }) => {
      try {
        await importFn();
        loaded.push(name);
      } catch (err) {
        failed.push(name);
        log.warn(`Tool "${name}" failed to load`, {
          error: (err as Error)?.message,
        });
      }
    })
  );

  toolsInitialized = true;

  const rejectedCount = results.filter(r => r.status === 'rejected').length;
  if (rejectedCount > 0) {
    log.warn(`${rejectedCount} tool(s) failed to load`, { failed });
  }

  log.info("Tool initialization complete", {
    loaded: loaded.length,
    failed: failed.length,
  });
}

export function isToolsInitialized(): boolean {
  return toolsInitialized;
}

/**
 * Lazy getter — returns the current tool schemas. Unlike a const snapshot,
 * this reflects tools registered AFTER module load (i.e. after initTools()).
 */
export function getToolDefinitions(): Record<string, ReturnType<typeof getToolSchemas>[string]> {
  return getToolSchemas();
}

// Backwards-compatible const — will be empty until initTools() runs and
// consumers re-import. Prefer getToolDefinitions() for runtime access.
export const TOOL_DEFINITIONS = getToolSchemas();

export type ToolName = string;
export type ToolDefinitions = ReturnType<typeof getToolSchemas>;
