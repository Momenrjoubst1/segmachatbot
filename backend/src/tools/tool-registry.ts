import type { ToolDefinition } from "./shared/types.js";

const tools: Record<string, ToolDefinition> = {};

export function registerTool(name: string, def: ToolDefinition): void {
  tools[name] = def;
}

// Schema-driven system (2026-08-30): the model learns its environment from the
// tool schemas themselves — no prose system prompt. Critical usage rules live
// here, attached to each tool's description at delivery time, mirroring how
// Claude/GPT/Gemini ship tool awareness (name + concise description + schema).

const GENERAL_TOOL_DISCIPLINE =
  "Tool calls are intermediate work: after ANY tool result, always continue and produce a direct user-facing answer; never end the turn silently; if a tool fails, explain what happened and continue.";

const TOOL_USAGE_NOTES: Record<string, string> = {
  send_email:
    "Plain text by default (html only if explicitly requested). First create ONE draft for all recipients; when the user clearly confirms (e.g. 'yes', 'send it') call again with confirm=true — do not re-draft or re-ask. Max 5 emails/minute: if more are requested, warn BEFORE doing anything else.",
  create_event:
    "Full calendar control: create immediately when asked — no confirmation. Ask one brief clarifying question only if the event or time is truly ambiguous.",
  calendar_query:
    "Update/reschedule events; needs the event ID from upcoming_events. Act immediately, no confirmation.",
  upcoming_events:
    "Show the user's schedule; use it to find event IDs before update/delete.",
  find_free_slots:
    "Check availability before proposing a time.",
  delete_calendar_event:
    "Delete immediately when asked — no confirmation.",
  email_to_meeting:
    "Convert an email thread into a calendar event when requested.",
  tasks:
    "Full task control: create/complete/update/delete immediately — no confirmation. Look up existing tasks first when the user refers to one so you reuse its ID.",
  find_materials:
    "Include EVERY line from result.cards EXACTLY as provided, each on its own line; NEVER modify or invent material:// URLs; if 0 matches, briefly suggest uploading the material.",
  create_artifact:
    "Create interactive content (html/chart/svg/mermaid/quiz/code/ide). Prefer update_artifact for changes to existing artifacts. For Arabic or mixed content choose an Arabic font (Cairo/Tajawal/Almarai), mono for code; never inject fonts into code/markdown/mermaid/chart/quiz artifacts.",
  update_artifact:
    "Use for ANY change to an existing artifact: content for full replace, find_replace for surgical edits (find must match existing text literally).",
  fonts:
    "Resolve/apply Google fonts; Arabic content → Arabic font; skip code/markdown artifacts.",
  ide_manager:
    "Use type 'ide' only for full IDE requests; produce an organized, runnable project tree.",
};

export function getToolSchemas(): Record<string, ToolDefinition> {
  const schemas: Record<string, ToolDefinition> = {};
  for (const [name, def] of Object.entries(tools)) {
    const note = TOOL_USAGE_NOTES[name];
    schemas[name] = {
      description: `${def.description}${note ? `\nUsage: ${note}` : ""}\n${GENERAL_TOOL_DISCIPLINE}`,
      inputSchema: def.inputSchema,
      execute: def.execute,
    };
  }
  return schemas;
}
