import { useEffect, useRef, useState, useCallback } from "react";
import { useChatHistory, type ChatMessage } from "./useChatHistory";
import { getAssistantAuthHeaders } from "@/lib/auth";

// Extended ChatMessage interface for Agentic state
export interface AgentStep {
  id: string;
  status: "running" | "success" | "error";
  title: string;
  logs?: string;
  duration?: number;
}

export interface ApprovalPayload {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AttachmentPayload {
  name: string;
  mimeType: string;
  data: string; // base64 data-URL (e.g. "data:image/png;base64,…")
}

export interface AgentChatMessage extends ChatMessage {
  agent_steps?: AgentStep[];
  task_progress?: {
    percentage: number;
    message?: string;
  };
  require_approval?: ApprovalPayload | null;
  approval_status?: "pending" | "approved" | "denied";
  interrupted?: boolean;
}

export type ConnectionState = "connecting" | "connected" | "disconnected";

interface WebSocketMessage {
  type: string;
  messageId?: string;
  data?: Record<string, unknown>;
}

interface UseAgentWebSocketProps {
  threadId: string | null;
  courseId: string | null;
  ragEnabled: boolean;
  modelId: string;
  onThreadCreated: (threadId: string) => void;
}

export const useAgentWebSocket = ({
  threadId,
  courseId,
  ragEnabled,
  modelId,
  onThreadCreated,
}: UseAgentWebSocketProps) => {
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");

  // Streaming methods from context
  const { activeThreadMessages, upsertMessage, markStreamInterrupted, appendMessage, removeInterruptedMessages, updateApprovalStatus } = useChatHistory();

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const currentDelayRef = useRef(0);
  const isMountedRef = useRef(true);

  const MAX_RETRIES = 10;
  const BASE_DELAY = 1000;
  const MAX_DELAY = 30000;

  // Mutable refs to prevent stale closures inside connection event handlers
  const threadIdRef = useRef(threadId);
  const courseIdRef = useRef(courseId);
  const ragEnabledRef = useRef(ragEnabled);
  const modelIdRef = useRef(modelId);
  const onThreadCreatedRef = useRef(onThreadCreated);

  useEffect(() => { threadIdRef.current = threadId; }, [threadId]);
  useEffect(() => { courseIdRef.current = courseId; }, [courseId]);
  useEffect(() => { ragEnabledRef.current = ragEnabled; }, [ragEnabled]);
  useEffect(() => { modelIdRef.current = modelId; }, [modelId]);
  useEffect(() => { onThreadCreatedRef.current = onThreadCreated; }, [onThreadCreated]);

  // Get active session token
  const getAuthToken = async () => {
    const headers = await getAssistantAuthHeaders();
    return headers.get("Authorization")?.replace("Bearer ", "") ?? null;
  };

  const connect = useCallback(async () => {
    if (socketRef.current) return;

    setConnectionState("connecting");
    const token = await getAuthToken();

    if (!isMountedRef.current) return;

    const backendUrl = import.meta.env.VITE_PYTHON_BACKEND_URL || "http://localhost:8000";
    const wsUrl = backendUrl.replace(/^http/, "ws") + "/api/chat/ws";

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) {
        ws.close();
        return;
      }
      setConnectionState("connected");
      retryCountRef.current = 0;
      currentDelayRef.current = 0;
      // Initial Auth & Context initialization payload
      ws.send(
        JSON.stringify({
          type: "auth_handshake",
          token,
          threadId: threadIdRef.current,
          courseId: courseIdRef.current,
          ragEnabled: ragEnabledRef.current,
          modelId: modelIdRef.current,
        })
      );
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;
      try {
        const payload = JSON.parse(event.data);
        handleIncomingMessage(payload);
      } catch (err) {
        console.error("Failed to parse WebSocket message", err);
      }
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      setConnectionState("disconnected");
      socketRef.current = null;
      // If a stream was in-flight, mark it interrupted so the user can retry
      onStreamInterrupted();

      // Exponential backoff with jitter: start at 1s, double each attempt, max 30s
      retryCountRef.current++;
      if (retryCountRef.current > MAX_RETRIES) {
        console.error(`[WebSocket] Connection lost after ${MAX_RETRIES} retries. Giving up.`);
        return;
      }

      if (currentDelayRef.current === 0) {
        currentDelayRef.current = BASE_DELAY;
      } else {
        currentDelayRef.current = Math.min(currentDelayRef.current * 2, MAX_DELAY);
      }

      const jitter = currentDelayRef.current * (0.5 + Math.random() * 0.5);
      console.warn(`[WebSocket] Reconnecting in ${Math.round(jitter)}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
      reconnectTimeoutRef.current = setTimeout(connect, jitter);
    };

    ws.onerror = (err) => {
      console.error("WebSocket connection error:", err);
      ws.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures connection lifecycle function is stable

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    retryCountRef.current = 0;
    currentDelayRef.current = 0;
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.onmessage = null;
      socketRef.current.onopen = null;
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnectionState("disconnected");
  }, []);

  // Sync context changes dynamically without dropping/restarting the channel
  useEffect(() => {
    if (socketRef.current && connectionState === "connected") {
      socketRef.current.send(
        JSON.stringify({
          type: "update_context",
          courseId,
          ragEnabled,
          modelId,
        })
      );
    }
  }, [courseId, ragEnabled, modelId, connectionState]);

  // Handle incoming server payload
  const handleIncomingMessage = (payload: WebSocketMessage) => {
    const { type, messageId, data } = payload;

    if (type === "ping") {
      return;
    }

    if (type === "thread_created" && data?.threadId) {
      onThreadCreatedRef.current(data.threadId as string);
      return;
    }

    const msgId = messageId ?? `msg-${Date.now()}`;

    upsertMessage(msgId, (existing) => {
      const target = { ...existing } as AgentChatMessage;

      // Initialize agent fields if not present
      if (!target.agent_steps) target.agent_steps = [];
      if (!target.task_progress) target.task_progress = { percentage: 0 };
      if (target.require_approval === undefined) target.require_approval = null;
      if (!target.approval_status) target.approval_status = "pending";

      switch (type) {
        case "text_chunk":
          target.content += (data?.text as string) ?? "";
          break;

        case "agent_step": {
          const steps = [...target.agent_steps!];
          const stepIndex = steps.findIndex((s) => s.id === data?.stepId);
          if (stepIndex > -1) {
            steps[stepIndex] = { ...steps[stepIndex], ...(data as Partial<AgentStep>) };
          } else {
            steps.push({
              id: (data?.stepId as string) ?? `step-${Date.now()}`,
              status: (data?.status as AgentStep["status"]) || "running",
              title: (data?.title as string) ?? "",
              logs: data?.logs as string | undefined,
            });
          }
          target.agent_steps = steps;
          break;
        }

        case "task_progress":
          target.task_progress = {
            percentage: (data?.percentage as number) ?? 0,
            message: data?.message as string | undefined,
          };
          break;

        case "require_approval":
          target.require_approval = {
            toolCallId: (data?.toolCallId as string) ?? "",
            toolName: (data?.toolName as string) ?? "",
            args: (data?.args as Record<string, unknown>) ?? {},
          };
          target.approval_status = "pending";
          break;

        case "error":
          target.role = "system";
          target.content = `${(data?.title as string) || "Error"}: ${(data?.logs as string) || "An error occurred"}`;
          break;

        default:
          break;
      }

      return target;
    });
  };

  // Mark any in-flight assistant message as interrupted on WS drop
  const onStreamInterrupted = () => {
    markStreamInterrupted();
  };

  // Send message with text + optional attachments (Optimistic UI)
  const sendMessageContent = useCallback(
    (text: string, attachments?: AttachmentPayload[]) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        console.error("Cannot send message: WebSocket is not open");
        return;
      }

      const userMessage: AgentChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        is_pinned: false,
        created_at: new Date().toISOString(),
      };

      // Optimistically update the UI messages store
      appendMessage(userMessage);

      socketRef.current.send(
        JSON.stringify({
          type: "user_message",
          content: text,
          attachments: attachments ?? [],
        })
      );
    },
    [appendMessage]
  );

  // Retry: resend the text of the last user message that preceded an interrupted response
  const retryMessage = useCallback(() => {
    // Find user text before the interrupted message
    const msgs = activeThreadMessages;
    const interruptedIdx = msgs.findIndex((m) => (m as any).interrupted);
    if (interruptedIdx === -1) return;

    let userText = "";
    for (let i = interruptedIdx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userText = msgs[i].content;
        break;
      }
    }

    // Remove interrupted messages
    removeInterruptedMessages();

    // Re-send if we found text
    if (userText && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type: "user_message", content: userText, attachments: [] })
      );
    }
  }, [activeThreadMessages, removeInterruptedMessages]);

  const sendApprovalDecision = useCallback((toolCallId: string, approved: boolean, feedback?: string) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: "user_approval",
        toolCallId,
        status: approved ? "approved" : "denied",
        feedback,
      })
    );

    updateApprovalStatus(toolCallId, approved ? "approved" : "denied");
  }, [updateApprovalStatus]);

  // Establish connection on mount and disconnect on unmount
  useEffect(() => {
    isMountedRef.current = true;
    connect();
    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connectionState,
    sendUserMessage: sendMessageContent,
    sendApprovalDecision,
    retryMessage,
  };
};
