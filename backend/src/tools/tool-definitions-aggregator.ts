import { getToolSchemas } from "./tool-registry.js";

export async function initTools(): Promise<void> {
  await import("./calculator/index.js");
  await import("./utils/time/index.js");
  await import("./utils/weather/index.js");
  await import("./web/search/index.js");
  await import("./email/send/index.js");
  await import("./email/history/index.js");
  await import("./email/contacts/index.js");
  await import("./calendar/create-event/index.js");
  await import("./education/course-info/index.js");
  await import("./education/flashcards/index.js");
  await import("./code/executor/index.js");
  await import("./files/create-artifact/index.js");
  await import("./utils/fonts/index.js");
  await import("./code/ide-manager/index.js");
  await import("./calendar/query/index.js");
  await import("./calendar/query/get-upcoming-events.js");
  await import("./calendar/query/find-free-slots.js");
  await import("./calendar/query/calendar-insights.js");
  await import("./calendar/query/delete-calendar-event.js");
  await import("./calendar/scheduler/index.js");
  await import("./calendar/scheduler/find-optimal-time.js");
  await import("./calendar/scheduler/email-to-meeting.js");
}

await initTools();

export const TOOL_DEFINITIONS = getToolSchemas();

export type ToolName = keyof typeof TOOL_DEFINITIONS;
export type ToolDefinitions = typeof TOOL_DEFINITIONS;
