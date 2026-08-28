/**
 * Cache Hit Persistence — persists cached responses to the database.
 * حفظ الاستجابة المخزنة مؤقتاً — يحفظ الاستجابات المخزنة مؤقتاً في قاعدة البيانات
 */

import type { Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "../../../../utils/logger.js";
import { triggerChatTitlingAsync } from "../../../chat-title-generator.service.js";
import type { CoreMessage } from "../types.js";

const ragLog = createLogger("pipeline:rag-retrieval");

export interface PersistCacheHitArgs {
  supabase: SupabaseClient;
  userId: string;
  threadId: string | undefined;
  coreMessages: CoreMessage[];
  cachedResponse: string;
  res: Response;
}

/**
 * Persist a cache hit response to the database and stream it to the client.
 */
export async function persistCacheHit(args: PersistCacheHitArgs): Promise<{ threadId: string | undefined }> {
  const { supabase, userId, threadId, coreMessages, cachedResponse, res } = args;
  let activeThreadId: string | undefined = undefined;

  // 1. Verify ownership if threadId is provided
  if (threadId) {
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();

    if (session) {
      activeThreadId = session.id;
    } else {
      ragLog.warn("persistCacheHit: threadId does not belong to user or does not exist", {
        threadId,
        userId,
      });
    }
  }

  // 2. Fallback: create a new session if no valid thread is found
  if (!activeThreadId) {
    const { data: newSession, error: sessionErr } = await supabase
      .from("chat_sessions")
      .insert([{ title: "New Chat", user_id: userId }])
      .select("id")
      .single();

    if (newSession && !sessionErr) {
      activeThreadId = newSession.id;
    }
  }

  if (activeThreadId) {
    if (!res.headersSent) {
      res.setHeader("X-Thread-Id", activeThreadId);
    }
    const lastUser = [...coreMessages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      await supabase.from("chat_messages").insert([{
        session_id: activeThreadId,
        role: "user",
        content: typeof lastUser.content === "string"
          ? lastUser.content
          : JSON.stringify(lastUser.content),
      }]);
    }
    await supabase.from("chat_messages").insert([{
      session_id: activeThreadId,
      role: "assistant",
      content: cachedResponse,
    }]);
    triggerChatTitlingAsync(activeThreadId);
  }

  if (!res.headersSent) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Cache-Hit", "true");
  }
  res.write(cachedResponse);
  res.end();

  return { threadId: activeThreadId };
}
