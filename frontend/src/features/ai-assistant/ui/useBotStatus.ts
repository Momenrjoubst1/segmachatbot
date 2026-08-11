
import { useAuiState } from "../shims/assistant-ui-compat-shim";

export type BotStatus = "idle" | "thinking" | "searching" | "generating";

type ToolStatusMap = Record<string, { status: BotStatus; label: string }>;

const TOOL_STATUS_MAP: ToolStatusMap = {
  web_search: { status: "searching", label: "Searching the web..." },
  calculator: { status: "thinking", label: "Calculating..." },
  get_time: { status: "thinking", label: "Checking time..." },
  get_weather: { status: "searching", label: "Checking weather..." },
  send_email: { status: "thinking", label: "Composing email..." },
  create_calendar_event: { status: "thinking", label: "Creating event..." },
  get_course_info: { status: "searching", label: "Looking up course info..." },
  generate_flashcards: { status: "thinking", label: "Generating flashcards..." },
  code_executor: { status: "thinking", label: "Running code..." },
  create_artifact: { status: "thinking", label: "Creating content..." },
};

function findRunningTool(
  parts: { type: string; toolName?: string; status?: { type: string } }[]
): { status: BotStatus; label: string } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === "tool-call" && part.toolName && part.status?.type === "running") {
      return TOOL_STATUS_MAP[part.toolName] ?? { status: "thinking", label: "Processing..." };
    }
  }
  return null;
}

export function useBotStatus(): { status: BotStatus; label: string; isStreamingText: boolean } {
  const parts = useAuiState(
    (s) => s.message.parts as unknown as { type: string; toolName?: string; status?: { type: string }; text?: string }[]
  );
  const status = useAuiState((s) => s.message.status);

  const isRunning = status?.type === "running";
  if (!isRunning) return { status: "idle", label: "", isStreamingText: false };

  const toolStatus = findRunningTool(parts);
  if (toolStatus) return { ...toolStatus, isStreamingText: false };

  const hasTextContent = parts.some((p) => p.type === "text");
  if (hasTextContent) return { status: "generating", label: "", isStreamingText: true };

  return { status: "thinking", label: "Thinking...", isStreamingText: false };
}
