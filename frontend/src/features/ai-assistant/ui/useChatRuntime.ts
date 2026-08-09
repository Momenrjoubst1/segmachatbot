
import { AssistantChatTransport, useChatRuntime, useAISDKChat } from "@assistant-ui/react-ai-sdk";
import { useMemo, useCallback, useRef, useEffect } from "react";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { supabase } from "@/lib/supabaseClient";
import type { AcademicCourse } from "../../../hooks/useCourses";
import { useRAGContext } from "../../../context/RAGContext";
import {
  dispatchUIAction,
  type AgenticUIAction,
} from "../../../context/AgenticUIBus";
import { getAssistantAuthHeaders } from "@/lib/auth";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

// ─── UI Action Stream Parser ─────────────────────────────────────────────────────

const UI_ACTION_TAG = "<ui_action>";
const UI_ACTION_CLOSE = "</ui_action>";

/**
 * Buffer-based streaming parser that detects `<ui_action>...</ui_action>` payloads
 * in SSE chunks, strips them from the visible text, and dispatches to the
 * AgenticUIBus. Handles tags that span across chunk boundaries.
 */
const MAX_BUFFER_SIZE = 64 * 1024; // 64 KB

class UIActionStreamParser {
  private buffer = "";

  /** Feed a new chunk from the SSE stream. Returns cleaned text (no ui_action tags). */
  process(chunk: string): string {
    this.buffer += chunk;

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      console.warn(
        "[UIActionStreamParser] Buffer exceeded max size (" + MAX_BUFFER_SIZE + " bytes). Flushing.",
      );
      const leftover = this.buffer;
      this.buffer = "";
      return leftover;
    }
    let output = "";

    // Extract all complete <ui_action>...</ui_action> blocks
    while (true) {
      const startIdx = this.buffer.indexOf(UI_ACTION_TAG);
      if (startIdx === -1) break;

      const endIdx = this.buffer.indexOf(UI_ACTION_CLOSE, startIdx);
      if (endIdx === -1) break; // closing tag not yet received

      // Text BEFORE the tag is clean output
      output += this.buffer.slice(0, startIdx);

      // Extract JSON between the tags and dispatch
      const jsonStr = this.buffer.slice(
        startIdx + UI_ACTION_TAG.length,
        endIdx,
      );
      try {
        const parsed = JSON.parse(jsonStr) as AgenticUIAction;
        dispatchUIAction(parsed);
      } catch {
        console.warn("[AgenticUI] Failed to parse ui_action payload:", jsonStr);
      }

      // Advance buffer past the full tag
      this.buffer = this.buffer.slice(endIdx + UI_ACTION_CLOSE.length);
    }

    // Flush clean buffered text
    output += this.buffer;

    // Hold back a possible partial opening tag at the tail.
    // "<ui_action>" is 11 chars — if the last ≤10 chars contain "<" it might
    // be the start of a tag that completes in the next chunk.
    const tailSearchStart = Math.max(0, output.length - (UI_ACTION_TAG.length - 1));
    const partialIdx = output.indexOf("<", tailSearchStart);
    if (partialIdx !== -1) {
      const tail = output.slice(partialIdx);
      // Only hold back if it could genuinely be a partial <ui_action> tag
      if (UI_ACTION_TAG.startsWith(tail)) {
        this.buffer = tail;
        output = output.slice(0, partialIdx);
      } else {
        this.buffer = "";
      }
    } else {
      this.buffer = "";
    }

    return output;
  }

  /** Flush remaining buffer content at stream end (strips any orphan tags). */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining.replace(/<ui_action>[\s\S]*?<\/ui_action>/g, "");
  }
}

// ─── Message Syncer ────────────────────────────────────────────────────────────
//
// Bridges the gap between ChatMessagesProvider (async fetch) and the AI SDK
// runtime (initial-mount-only messages). When fetchMessages resolves AFTER
// mount (cache miss), this component imperatively pushes the fetched messages
// into the already-mounted runtime via useAISDKChat().setMessages().
//
// Safety guards:
// 1. Skips if messages reference hasn't changed (avoids redundant calls)
// 2. Skips if the runtime is actively streaming (never overwrites live content)
// 3. Skips the initial mount (initial messages are handled by useChatRuntime)

export const MessageSyncer = () => {
  const chat = useAISDKChat();
  const { activeThreadMessages } = useChatHistory();
  const lastSyncedRef = useRef<typeof activeThreadMessages | null>(null);

  useEffect(() => {
    if (!chat) return;

    // Skip initial mount — messages were already passed to useChatRuntime
    if (lastSyncedRef.current === null) {
      lastSyncedRef.current = activeThreadMessages;
      return;
    }

    // Skip if reference hasn't changed (same array = no new data)
    if (lastSyncedRef.current === activeThreadMessages) return;

    // NEVER overwrite while streaming or submitting
    if (chat.status === "streaming" || chat.status === "submitted") {
      console.warn("[MessageSyncer] Skipping sync — runtime is", chat.status);
      return;
    }

    lastSyncedRef.current = activeThreadMessages;

    const mapped = activeThreadMessages.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant" | "system",
      parts: [{ type: "text" as const, text: msg.content }],
    }));
    chat.setMessages(mapped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadMessages]);

  return null;
};

// ─── Runtime Hook ─────────────────────────────────────────────────────────────────

export const useRuntime = (activeCourse: AcademicCourse | null) => {
  // Because AssistantChatInner is mounted with key=chatKey (from URL),
  // this hook is fully recreated on every thread switch / new chat.
  const { activeThreadId, activeThreadMessages, setActiveThreadId, refreshThreads, saveDraft: _saveDraft, getDraft, clearDraft, setActiveThreadMessages } = useChatHistory();
  const { ragEnabled } = useRAGContext();
  const threadCreatedRef = useRef(false);

  // Key: use the URL thread ID, or a composite key for new chats (new-courseId or new-general)
  const chatKey = activeThreadId
    ? activeThreadId
    : activeCourse
    ? `new-${activeCourse.id}`
    : "new-general";

  // Idempotency key: generated once per new-chat mount so that the original
  // request AND any 401 token-refresh retry carry the SAME GUID.
  // This prevents the backend from creating duplicate sessions on retry.
  const guidRef = useRef<string | null>(
    !activeThreadId ? crypto.randomUUID() : null,
  );

  // Reset threadCreatedRef when the active thread changes (e.g. navigating
  // between existing threads). On a fresh mount this ref is already false,
  // but if the component somehow receives a new activeThreadId without
  // remounting, we still want to reset it.
  useEffect(() => {
    threadCreatedRef.current = false;
  }, [activeThreadId]);

  // Clear the draft for this thread on mount if there are already messages.
  // A draft is only meaningful for an empty thread — once a message has been
  // sent, any leftover draft text is stale regardless of its content.
  // We intentionally run this only on mount (empty deps) so it doesn't
  // fire on every background refresh that appends new messages.
  useEffect(() => {
    if (activeThreadMessages.length > 0) {
      const draft = getDraft(chatKey);
      if (draft) {
        clearDraft(chatKey);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const customFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      abortRef.current?.();
      const controller = new AbortController();
      abortRef.current = () => controller.abort();

      const headers = await getAssistantAuthHeaders(init.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

      let body = init.body;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          if (activeThreadId) {
            // Continuing an existing thread
            parsed.threadId = activeThreadId;
          } else {
            // New thread — attach idempotency GUID (same GUID survives 401 retry
            // because this customFetch closure captures guidRef once per mount)
            if (activeCourse) {
              parsed.courseId = activeCourse.id;
            }
            if (guidRef.current) {
              parsed.clientChatGuid = guidRef.current;
            }
          }
          // else: no threadId/courseId → backend creates a new session
          parsed.ragEnabled = ragEnabled;
          body = JSON.stringify(parsed);
        } catch { /* keep original body */ }
      }

      const { signal } = controller;
      let res = await fetch(input, { ...init, headers, body, signal });

      // Auto-retry on 401
      if (res.status === 401 && !signal.aborted) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session?.access_token) {
          headers.set("Authorization", `Bearer ${data.session.access_token}`);
          res = await fetch(input, { ...init, headers, body, signal });
        } else {
          // Refresh failed — notify the app so a modal can prompt re-login
          window.dispatchEvent(new CustomEvent("auth:session-expired"));
          throw new Error("Session expired: unable to refresh authentication token");
        }
      }

      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Capture new thread ID from backend after stream completes
      const serverThreadId = res.headers.get("X-Thread-Id");

      const isNewThread = !!serverThreadId && serverThreadId !== activeThreadId && !threadCreatedRef.current;

      // Always wrap the response body to intercept <ui_action> tags.
      // If this is a new thread, also handle URL update + sidebar refresh on stream end.
      const originalBody = res.body;
      if (originalBody) {
        const reader = originalBody.getReader();
        const parser = new UIActionStreamParser();
        let hasEnqueuedData = false;
        let streamClosed = false;
        const stream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                if (signal.aborted) {
                  reader.cancel();
                  if (!streamClosed) { try { controller.close(); } catch {} }
                  streamClosed = true;
                  return;
                }
                const { done, value } = await reader.read();
                if (done) {
                  // Flush any remaining buffered content
                  const remaining = parser.flush();
                  if (remaining && !streamClosed) {
                    try { controller.enqueue(new TextEncoder().encode(remaining)); } catch {}
                  }
                  if (!streamClosed) { try { controller.close(); } catch {} }
                  streamClosed = true;

                  // Post-stream: update URL for new threads
                  // Delay the URL update to let the streamed content render first.
                  // Changing activeThreadId changes the component key, which remounts
                  // the component and would lose the streamed response if done immediately.
                  if (isNewThread && serverThreadId) {
                    threadCreatedRef.current = true;
                    clearDraft(chatKey);
                    refreshThreads();
                    setTimeout(() => {
                      setActiveThreadId(serverThreadId);
                    }, 200);
                  }
                  break;
                }

                // Decode chunk → parse UI actions → enqueue clean text
                const text = new TextDecoder().decode(value, { stream: true });
                const cleanText = parser.process(text);
                if (cleanText && !streamClosed) {
                  try { controller.enqueue(new TextEncoder().encode(cleanText)); } catch { streamClosed = true; }
                  hasEnqueuedData = true;
                }
              }
            } catch (err) {
              if (hasEnqueuedData) {
                // Stream interrupted mid-way: preserve partial text by closing
                // the stream gracefully instead of propagating the error. The
                // library already received the enqueued chunks, so the partial
                // response stays visible. Mark the message as interrupted so
                // the UI can show a "retry" banner.
                console.warn("[Runtime] Stream interrupted (partial response preserved):", err);
                if (!streamClosed) { try { controller.close(); } catch {} }
                streamClosed = true;

                // Find the last assistant message that doesn't already have
                // content — this is the one that was being streamed.
                setActiveThreadMessages((prev) => {
                  for (let i = prev.length - 1; i >= 0; i--) {
                    const msg = prev[i];
                    if (msg.role === "assistant" && !(msg as any).interrupted) {
                      const updated = [...prev];
                      updated[i] = { ...msg, interrupted: true } as typeof msg;
                      return updated;
                    }
                  }
                  return prev;
                });
              } else {
                // Request failed before any data arrived — propagate so the
                // library surfaces a full error banner.
                console.error("[Runtime] Request failed before streaming started:", err);
                if (!streamClosed) { try { controller.error(err); } catch {} }
                streamClosed = true;
              }
            }
          },
        });
        res = new Response(stream, {
          headers: res.headers,
          status: res.status,
          statusText: res.statusText,
        });
      } else if (isNewThread && serverThreadId) {
        // No body to wrap — still update thread state
        threadCreatedRef.current = true;
        clearDraft(chatKey);
        refreshThreads();
        setTimeout(() => {
          setActiveThreadId(serverThreadId);
        }, 200);
      }
      // NOTE: for an existing thread (serverThreadId === activeThreadId or null),
      // we intentionally do NOT call refreshThreads() here.
      // The Supabase Realtime channel in ChatHistoryProvider already receives
      // UPDATE events on chat_sessions and updates thread titles in real-time
      // without any extra round-trip to the backend.

      return res;
    },
    [activeThreadId, activeCourse, chatKey, setActiveThreadId, refreshThreads, ragEnabled, clearDraft, setActiveThreadMessages],
  );

  const transport = useMemo(
    () => new AssistantChatTransport({ api: `${BACKEND_URL}/api/chat`, fetch: customFetch }),
    [customFetch],
  );

  // Because this component remounts on every key change, activeThreadMessages
  // always contains the correct messages for this thread at mount time.
  const mappedMessages = activeThreadMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system",
    parts: [{ type: "text" as const, text: msg.content }],
  }));
  return useChatRuntime({
    transport,
    messages: mappedMessages,
  });
};
