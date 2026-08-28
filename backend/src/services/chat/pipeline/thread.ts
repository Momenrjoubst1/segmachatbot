// Resolves the chat thread: verify ownership, reuse idempotent or empty sessions, or create one.

import { Request } from "express";
import { ensureThreadOwnership } from "../../../routes/chat/chat-shared.js";
import { createLogger } from "../../../utils/logger.js";
const log = createLogger("pipeline:thread");
import redis from "../../../config/redis/client.js";
import { AsyncMutex } from "../../../utils/async-mutex.js";

// Simple keyed mutex for thread reuse - one mutex per user
const threadReuseMutexes = new Map<string, AsyncMutex>();

function getThreadReuseMutex(userId: string): AsyncMutex {
  let mutex = threadReuseMutexes.get(userId);
  if (!mutex) {
    mutex = new AsyncMutex();
    threadReuseMutexes.set(userId, mutex);
  }
  return mutex;
}

interface ChatSessionRow {
  id: string;
}

interface ChatMessageRow {
  session_id: string;
}

export type ThreadResolutionFailure =
  | { ok: false; status: 404 | 401 | 500; error: string | undefined };

export interface ThreadResolutionSuccess {
  ok: true;
  activeThreadId: string;
  reused: boolean;
}

export type ThreadResolutionResult =
  | ThreadResolutionSuccess
  | ThreadResolutionFailure;

export async function resolveThread(args: {
  req: Request;
  threadId: string | undefined;
  clientChatGuid: string | undefined;
  courseId: string | undefined;
  userId: string;
}): Promise<ThreadResolutionResult> {
  const { req, threadId, clientChatGuid, courseId, userId } = args;

  // 1) Existing thread â€” verify ownership
  if (threadId) {
    const ownership = await ensureThreadOwnership(req, threadId);
    if ("error" in ownership) {
      const status = ownership.status ?? 404;
      return { ok: false, status, error: ownership.error };
    }
    return { ok: true, activeThreadId: threadId, reused: false };
  }

  const { supabase } = await import("../../rag/rag-supabase-client.js");
  let reusedSessionId: string | undefined;

  // 2) Idempotency GUID â†’ existing session
  if (clientChatGuid) {
    try {
      const cached = await redis.get(`chat:guid:${clientChatGuid}`);
      if (cached) {
        reusedSessionId = cached;
        log.info("Reusing session via idempotency GUID", {
          guid: clientChatGuid,
          sessionId: reusedSessionId,
        });
      }
    } catch (err) {
      log.warn("Redis lookup for chat GUID failed", {
        error: (err as Error)?.message,
      });
    }
  }

  // 3) Defensive: reuse a recent empty session
  if (!reusedSessionId) {
    // Per-user mutex prevents two concurrent requests reusing the same empty session.
    const mutexKey = `thread:reuse:${userId}`;
    const release = await getThreadReuseMutex(userId).acquire(); // 5s timeout
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentEmpties } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("title", "New Chat")
        .gte("created_at", fiveMinAgo)
        .order("created_at", { ascending: false })
        .limit(5);

      if (recentEmpties && recentEmpties.length > 0) {
        const candidateIds = (recentEmpties as ChatSessionRow[]).map((s) => s.id);
        const { data: msgCounts } = await supabase
          .from("chat_messages")
          .select("session_id")
          .in("session_id", candidateIds);

        const sessionsWithMsgs = new Set(
          (msgCounts || []).map((m: ChatMessageRow) => m.session_id),
        );
        const empty = recentEmpties.find(
          (s: ChatSessionRow) => !sessionsWithMsgs.has(s.id),
        );
        if (empty) {
          reusedSessionId = empty.id;
          log.info("Reusing existing empty session", {
            sessionId: reusedSessionId,
            userId,
          });
        }
      }
    } catch (err) {
      log.warn("Empty session reuse check failed", {
        error: (err as Error)?.message,
      });
    } finally {
      release();
    }
  }

  // 4) Reuse or create
  if (reusedSessionId) {
    return { ok: true, activeThreadId: reusedSessionId, reused: true };
  }

  const sessionPayload: Record<string, string> = { title: "New Chat", user_id: userId };
  if (courseId) sessionPayload.course_id = courseId;

  const { data: newSession, error: sessionErr } = await supabase
    .from("chat_sessions")
    .insert([sessionPayload])
    .select()
    .single();

  if (sessionErr || !newSession) {
    log.error("Failed to create new chat session", {
      error: sessionErr?.message,
    });
    return { ok: false, status: 500, error: "Failed to create chat session" };
  }

  const newId = (newSession as ChatSessionRow).id;

  if (clientChatGuid) {
    try {
      await redis.set(
        `chat:guid:${clientChatGuid}`,
        newId,
        "EX",
        300, // 5 min TTL â€” covers token-refresh retry window
      );
    } catch (err) {
      log.warn("Failed to store chat GUID in Redis", {
        error: (err as Error)?.message,
      });
    }
  }

  return { ok: true, activeThreadId: newId, reused: false };
}
