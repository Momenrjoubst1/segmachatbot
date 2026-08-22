
import { AssistantChatTransport, useChatRuntime, useAISDKChat } from "@assistant-ui/react-ai-sdk";
import type { UIMessage, UIMessageChunk } from "ai";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { supabase } from "@/lib/supabaseClient";
import type { AcademicCourse } from "../../../hooks/useCourses";
import { useRAGContext } from "../../../context/RAGContext";
import { sendStateBridge } from "../../../context/sendStateBridge";
import { toast } from "sonner";
import {
  dispatchUIAction,
  type AgenticUIAction,
} from "../../../context/AgenticUIBus";
import { getAssistantAuthHeaders } from "@/lib/auth";
import { useGuestMode } from "@/context/GuestModeContext";
import i18n from "@/i18n/i18next";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";
const THREAD_ID_UPDATE_DELAY_MS = Number(import.meta.env.VITE_THREAD_ID_UPDATE_DELAY_MS || "200");

/** Guest quota cookies require credentialed requests across origins. */
export function resolveRequestCredentials(
  isGuestMode: boolean,
  requestedCredentials: RequestCredentials | undefined,
): RequestCredentials | undefined {
  return isGuestMode ? "include" : requestedCredentials;
}

/**
 * The authenticated API still uses the legacy AI SDK text protocol (`0:"…"`).
 * Guest chat has no UI actions, so convert that lightweight protocol into the
 * current UI-message event stream expected by AssistantChatTransport.
 */
export function legacyGuestStreamToUIMessageStream(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<UIMessageChunk> {
  const decoder = new TextDecoder();
  const textPartId = `guest-text-${crypto.randomUUID()}`;
  let buffered = "";
  let textStarted = false;

  const emitTextStart = (controller: ReadableStreamDefaultController<UIMessageChunk>) => {
    if (!textStarted) {
      controller.enqueue({ type: "text-start", id: textPartId });
      textStarted = true;
    }
  };

  const processLine = (
    rawLine: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ) => {
    const line = rawLine.replace(/\r$/, "");
    if (!line) return;
    if (line.startsWith("0:")) {
      try {
        const text = JSON.parse(line.slice(2));
        if (typeof text === "string" && text) {
          emitTextStart(controller);
          controller.enqueue({ type: "text-delta", id: textPartId, delta: text });
        }
      } catch (e) {
        console.warn("[legacyGuestStream] JSON parse error on chunk:", e);
      }
      return;
    }
    if (line.startsWith("3:")) {
      try {
        const error = JSON.parse(line.slice(2));
        const errorMsg = error?.error ?? "Guest chat failed";
        emitTextStart(controller);
        controller.enqueue({ type: "text-delta", id: textPartId, delta: `\n\n⚠️ ${errorMsg}` });
      } catch {
        emitTextStart(controller);
        controller.enqueue({ type: "text-delta", id: textPartId, delta: "\n\n⚠️ Guest chat failed" });
      }
    }
  };

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start" });
      const reader = stream.getReader();
      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            lines.forEach((line) => processLine(line, controller));
          }
          buffered += decoder.decode();
          processLine(buffered, controller);
          if (textStarted) controller.enqueue({ type: "text-end", id: textPartId });
          controller.enqueue({ type: "finish", finishReason: "stop" });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      })();
    },
  });
}

class GuestChatTransport extends AssistantChatTransport<UIMessage> {
  protected processResponseStream(
    stream: ReadableStream<Uint8Array>,
  ): ReadableStream<UIMessageChunk> {
    return legacyGuestStreamToUIMessageStream(stream);
  }
}

// ─── Guest Body Transformation ─────────────────────────────────────────────────
/**
 * Transform AI SDK message format to guest API format.
 * Extracts the last user message and conversation history.
 */
interface GuestBodyMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
  parts?: Array<{ text?: string }>;
}
function transformToGuestBody(body: { messages?: GuestBodyMessage[] }): { message: string; conversationHistory: Array<{ role: string; content: string }> } {
  const messages = body.messages ?? [];
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");

  // AI SDK: content can be string OR array of parts; assistant-ui: parts[0].text
  const userText = (() => {
    if (!lastUserMsg) return "";
    if (lastUserMsg.parts?.[0]?.text) return lastUserMsg.parts[0].text;
    if (typeof lastUserMsg.content === "string") return lastUserMsg.content;
    if (Array.isArray(lastUserMsg.content)) {
      const textPart = lastUserMsg.content.find((p) => p.type === "text");
      return textPart?.text ?? "";
    }
    return "";
  })();

  const historyWithoutLastUser = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .slice(-10)
    .map((m) => {
      let text = "";
      if (m.parts?.[0]?.text) text = m.parts[0].text;
      else if (typeof m.content === "string") text = m.content;
      else if (Array.isArray(m.content)) {
        const tp = m.content.find((p) => p.type === "text");
        text = tp?.text ?? "";
      }
      return { role: m.role, content: text };
    });

  return {
    message: userText,
    conversationHistory: historyWithoutLastUser,
  };
}

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
// runtime (initial-mount-only messages). For authenticated sessions only.
// Guest sessions are fully in-memory and must not be overwritten.

const AuthenticatedMessageSyncer = () => {
  const chat = useAISDKChat();
  const { activeThreadMessages, activeThreadId, appendMessage, upsertMessage } = useChatHistory();
  const lastSyncedRef = useRef<typeof activeThreadMessages | null>(null);
  const lastAiCountRef = useRef(0);

  useEffect(() => {
    if (!chat) return;

    // On initial mount, push messages if we have any.
    if (lastSyncedRef.current === null) {
      lastSyncedRef.current = activeThreadMessages;
      if (activeThreadMessages.length > 0) {
        const mapped = activeThreadMessages.map((msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant" | "system",
          parts: [{ type: "text" as const, text: msg.content }],
        }));
        chat.setMessages(mapped);
      }
      lastAiCountRef.current = chat.messages?.length ?? 0;
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
    lastAiCountRef.current = mapped.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadMessages]);

  // ─── Reverse sync: AI SDK chat → context ────────────────────────────────────
  // Mirror completed AI SDK messages into context only once streaming is done.
  const aiMessages = chat?.messages;
  const chatStatus = chat?.status;
  useEffect(() => {
    if (!aiMessages || aiMessages.length === 0) return;
    if (chatStatus === "streaming" || chatStatus === "submitted") return;

    const existingMap = new Map(activeThreadMessages.map((m) => [m.id, m]));
    for (const m of aiMessages) {
      const textPart = m.parts?.find((p: { type: string }) => p.type === "text");
      const content = textPart && "text" in textPart ? textPart.text : "";
      const existing = existingMap.get(m.id);
      if (!existing) {
        appendMessage({
          id: m.id,
          role: m.role as "user" | "assistant" | "system" | "data",
          content,
          is_pinned: false,
          created_at: new Date().toISOString(),
        });
      } else if (existing.content !== content && content) {
        upsertMessage(m.id, (msg) => ({ ...msg, content }));
      }
    }
    lastAiCountRef.current = aiMessages.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMessages, chatStatus, activeThreadId]);

  // ─── Tab visibility / focus: re-push messages to the AI SDK chat ───────────
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const resync = () => {
      if (chat && chat.status !== "streaming" && chat.status !== "submitted" && activeThreadMessages.length > 0) {
        const mapped = activeThreadMessages.map((msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant" | "system",
          parts: [{ type: "text" as const, text: msg.content }],
        }));
        chat.setMessages(mapped);
        lastSyncedRef.current = activeThreadMessages;
      }
      setTimeout(() => {
        flushSync(() => {
          forceRender((t) => t + 1);
        });
      }, 0);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    const handleFocus = () => resync();
    const handlePageShow = () => resync();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, activeThreadMessages]);

  return null;
};

export const MessageSyncer = () => {
  const { isGuestMode } = useGuestMode();
  if (isGuestMode) {
    return null;
  }
  return React.createElement(AuthenticatedMessageSyncer);
};

// ─── Runtime Hook ─────────────────────────────────────────────────────────────────

export const useRuntime = (activeCourse: AcademicCourse | null, draftKey?: string) => {
  // Because AssistantChatInner is mounted with key=chatKey (from URL),
  // this hook is fully recreated on every thread switch / new chat.
  const navigate = useNavigate();
  const { activeThreadId, activeThreadMessages, setActiveThreadId, refreshThreads, saveDraft: _saveDraft, getDraft, clearDraft, markLastAssistantInterrupted } = useChatHistory();
  const { ragEnabled } = useRAGContext();
  const { isGuestMode, refreshGuestStatus, setGuestQuota } = useGuestMode();
  const threadCreatedRef = useRef(false);

  // Key: use the caller-supplied chatKey (which includes the new-chat counter)
  // when available so drafts are saved/cleared under the SAME key AssistantApp
  // uses. Fallback kept for callers that only pass the course.
  const chatKey = draftKey
    ?? (activeThreadId
      ? activeThreadId
      : activeCourse
      ? `new-${activeCourse.id}`
      : "new-general");

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
  const threadUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.();
      if (threadUpdateTimeoutRef.current) {
        clearTimeout(threadUpdateTimeoutRef.current);
      }
    };
  }, []);

  const customFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      abortRef.current?.();
      const controller = new AbortController();
      abortRef.current = () => controller.abort();

      // Dispatch submitting state — user clicked send
      sendStateBridge.setSubmitting();

      let headers: Headers;
      let body = init.body;

      if (isGuestMode) {
        // Guest: no auth headers, simple JSON body with message + conversationHistory
        headers = new Headers(init.headers);
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

        // Check for image content - model doesn't support images in guest mode.
        // Only flag REAL embedded images (data URLs / <img> markup) — a plain
        // text mention like "image/logo.png" is not an image attachment.
        const bodyHasImage = (parsed: { message?: string; conversationHistory?: Array<{ content?: string }> }): boolean => {
          const allText = [
            parsed.message,
            ...(parsed.conversationHistory?.map((m) => m.content) ?? []),
          ].join(" ");
          return allText.includes("<img") || allText.includes("data:image/");
        };
        let hasImage = false;
        if (typeof body === "string") {
          try {
            const parsed = JSON.parse(body);
            hasImage = bodyHasImage(parsed);
          } catch (e) {
            console.error("[guest customFetch] Failed to parse body:", e);
          }
        } else if (body && typeof body === "object") {
          try {
            hasImage = bodyHasImage(body as { message?: string; conversationHistory?: Array<{ content?: string }> });
          } catch (e) {
            console.error("[guest customFetch] Failed to parse object body:", e);
          }
        }

        if (hasImage) {
          toast.error("Images not supported in guest mode. Please sign in to send images.", {
            description: "Guest mode only supports text messages. Sign in to unlock image sending.",
            action: {
              label: "Sign in",
              onClick: () => {
                navigate("/login", { state: { from: `` } });
              }
            }
          });
          sendStateBridge.setIdle();
          throw new Error("Images are not supported in guest mode");
        }

        if (typeof body === "string") {
          try {
            const parsed: unknown = JSON.parse(body);
            const transformed = transformToGuestBody(parsed as { messages?: GuestBodyMessage[] });
            body = JSON.stringify(transformed);
          } catch (e) {
            console.error("[guest customFetch] Failed to transform body:", e);
          }
        } else if (body && typeof body === "object") {
          try {
            const transformed = transformToGuestBody(body as { messages?: GuestBodyMessage[] });
            body = JSON.stringify(transformed);
          } catch (e) {
            console.error("[guest customFetch] Failed to transform object body:", e);
          }
        }
      } else {
        // Authenticated: full auth headers, thread ID, course ID, etc.
        headers = await getAssistantAuthHeaders(init.headers);
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

        if (typeof body === "string") {
          try {
            const parsed = JSON.parse(body);
            if (activeThreadId) {
              parsed.threadId = activeThreadId;
            } else {
              if (activeCourse) {
                parsed.courseId = activeCourse.id;
              }
              if (guidRef.current) {
                parsed.clientChatGuid = guidRef.current;
              }
            }
            parsed.ragEnabled = ragEnabled;

            // Downscale photo attachments + enforce per-message image cap
            // (client-side, so oversized phone photos never hit the wire).
            const isChatSend = typeof input === "string" && input.includes("/api/chat");
            if (isChatSend) {
              const { downscaleUIMessageImages } = await import("@/lib/image-downscale");
              const { body: transformed, droppedCount } = await downscaleUIMessageImages(parsed);
              Object.assign(parsed, transformed as Record<string, unknown>);
              if (droppedCount > 0) {
                toast.warning(i18n.t("chat.photo.limitReached", { max: 3 }));
              }
            }

            body = JSON.stringify(parsed);
          } catch { /* keep original body */ }
        }
      }

      const { signal } = controller;
      // For guest mode, include credentials to ensure cookies are sent cross-origin
      const credentials = resolveRequestCredentials(isGuestMode, init.credentials);
      let res = await fetch(input, { ...init, headers, body, signal, credentials });

      // Auto-retry on 401 (authenticated only)
      if (!isGuestMode && res.status === 401 && !signal.aborted) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session?.access_token) {
          headers.set("Authorization", `Bearer ${data.session.access_token}`);
          res = await fetch(input, { ...init, headers, body, signal, credentials });
        } else {
          window.dispatchEvent(new CustomEvent("auth:session-expired"));
          sendStateBridge.setIdle();
          throw new Error("Session expired: unable to refresh authentication token");
        }
      }

      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Handle 429 rate limit for guests
      if (isGuestMode && res.status === 429) {
        try {
          const data = await res.clone().json();
          const count = Number(data.count);
          const limit = Number(data.limit);
          if (Number.isFinite(count) && Number.isFinite(limit) && limit > 0) {
            setGuestQuota({
              count,
              limit,
              retryAfterSeconds: Number.isFinite(Number(data.retryAfterSeconds))
                ? Number(data.retryAfterSeconds)
                : undefined,
            });
          } else {
            // The IP limiter also returns 429 but has no guest quota payload.
            // Keep the last known quota instead of incorrectly resetting it to 0.
            await refreshGuestStatus();
          }
        } catch { /* ignore */ }
      }

      // Read quota headers from successful guest responses
      if (isGuestMode && res.ok) {
        const count = res.headers.get("X-Guest-Message-Count");
        const limit = res.headers.get("X-Guest-Message-Limit");
        const retryAfter = res.headers.get("X-Guest-Retry-After");
        const parsedCount = Number(count);
        const parsedLimit = Number(limit);
        const parsedRetryAfter = Number(retryAfter);
        if (Number.isFinite(parsedCount) && Number.isFinite(parsedLimit) && parsedLimit > 0) {
          setGuestQuota({
            count: parsedCount,
            limit: parsedLimit,
            retryAfterSeconds: retryAfter && Number.isFinite(parsedRetryAfter)
              ? parsedRetryAfter
              : undefined,
          });
        }
      }

      // Capture new thread ID from backend after stream completes
      const serverThreadId = res.headers.get("X-Thread-Id");

      const isNewThread = !!serverThreadId && serverThreadId !== activeThreadId && !threadCreatedRef.current;

      // Guests: return response as-is (no UI actions, no thread creation)
      if (isGuestMode) {
        return res;
      }

      // Authenticated: wrap response body to intercept <ui_action> tags.
      const originalBody = res.body;
      if (originalBody) {
        const reader = originalBody.getReader();
        const parser = new UIActionStreamParser();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let hasEnqueuedData = false;
        let streamClosed = false;
        let hasDispatchedStreaming = false;
        const stream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                if (signal.aborted) {
                  reader.cancel();
                  if (!streamClosed) { try { controller.close(); } catch {} }
                  streamClosed = true;
                  // User cancelled — back to idle
                  sendStateBridge.setIdle();
                  return;
                }
                const { done, value } = await reader.read();
                if (done) {
                  const remaining = parser.flush();
                  if (remaining && !streamClosed) {
                    try { controller.enqueue(encoder.encode(remaining)); } catch {}
                  }
                  if (!streamClosed) { try { controller.close(); } catch {} }
                  streamClosed = true;

                  // Stream complete — back to idle
                  sendStateBridge.setIdle();

                  // Post-stream: update URL for new threads (authenticated only)
                  if (!isGuestMode && isNewThread && serverThreadId) {
                    threadCreatedRef.current = true;
                    clearDraft(chatKey);
                    refreshThreads();
                    if (threadUpdateTimeoutRef.current) {
                      clearTimeout(threadUpdateTimeoutRef.current);
                    }
                    threadUpdateTimeoutRef.current = setTimeout(() => {
                      setActiveThreadId(serverThreadId);
                    }, THREAD_ID_UPDATE_DELAY_MS);
                  }
                  break;
                }

                const text = decoder.decode(value, { stream: true });
                const cleanText = parser.process(text);
                if (cleanText && !streamClosed) {
                  try { controller.enqueue(encoder.encode(cleanText)); } catch { streamClosed = true; }
                  hasEnqueuedData = true;
                  // First real chunk received — switch to streaming state
                  if (!hasDispatchedStreaming) {
                    hasDispatchedStreaming = true;
                    sendStateBridge.setStreaming();
                  }
                }
              }
            } catch (err) {
              // Stream failed — back to idle
              sendStateBridge.setIdle();
              if (hasEnqueuedData) {
                console.warn("[Runtime] Stream interrupted (partial response preserved):", err);
                if (!streamClosed) { try { controller.close(); } catch {} }
                streamClosed = true;
                markLastAssistantInterrupted();
              } else {
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
      } else if (!isGuestMode && isNewThread && serverThreadId) {
        threadCreatedRef.current = true;
        clearDraft(chatKey);
        refreshThreads();
        if (threadUpdateTimeoutRef.current) {
          clearTimeout(threadUpdateTimeoutRef.current);
        }
        threadUpdateTimeoutRef.current = setTimeout(() => {
          setActiveThreadId(serverThreadId);
        }, THREAD_ID_UPDATE_DELAY_MS);
      }

      return res;
    },
    [isGuestMode, activeThreadId, activeCourse, chatKey, setActiveThreadId, refreshThreads, ragEnabled, clearDraft, markLastAssistantInterrupted, navigate, setGuestQuota],
  );

  const transport = useMemo(
    () => (isGuestMode ? new GuestChatTransport({
      api: `${BACKEND_URL}/api/guest/chat`,
      fetch: customFetch,
    }) : new AssistantChatTransport({
      api: isGuestMode ? `${BACKEND_URL}/api/guest/chat` : `${BACKEND_URL}/api/chat`,
      fetch: customFetch,
    })),
    [customFetch, isGuestMode],
  );

  // Because this component remounts on every key change, activeThreadMessages
  // always contains the correct messages for this thread at mount time.
  const mappedMessages = activeThreadMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system",
    parts: [{ type: "text" as const, text: msg.content }],
  }));

  // Thumbs up/down on assistant messages → POST /api/feedback/message.
  // Fire-and-forget: the optimistic icon fill comes from the runtime; a
  // failed save is surfaced as a toast without reverting the icon.
  const feedbackAdapter = useMemo(() => ({
    submit: ({ message, type }: { message: { id: string; role: string }; type: "positive" | "negative" }) => {
      if (message.role !== "assistant") return;
      if (isGuestMode) return; // Feedback requires authentication
      void (async () => {
        try {
          const headers = await getAssistantAuthHeaders();
          const res = await fetch(`${BACKEND_URL}/api/feedback/message`, {
            method: "POST",
            headers,
            body: JSON.stringify({ messageId: message.id, isPositive: type === "positive" }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
          console.warn("[feedback] failed to save message feedback", err);
          toast.error("Failed to save feedback. Please try again.");
        }
      })();
    },
  }), [isGuestMode]);

  return useChatRuntime({
    transport,
    messages: mappedMessages,
    adapters: { feedback: feedbackAdapter },
  });
};
