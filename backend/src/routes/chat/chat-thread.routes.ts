import { Router } from "express";
import { asyncHandler } from "../../utils/express-async-wrapper.js";
import { ensureThreadOwnership } from "./chat-shared.js";

const router = Router();

// NOTE: POST /threads endpoint removed — threads are now created lazily
// by the chat pipeline (chat.pipeline.ts Step 7) when the first message is sent.
// The deprecated frontend `createNewThread` was already a no-op, and leaving
// this endpoint exposed allowed unauthenticated creation of orphaned sessions.

// Get all threads (optional courseId query param to filter)
// Supports defensive pagination: ?limit=50&cursor=<ISO-timestamp>
router.get("/threads", asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { supabase } = await import("../../services/rag/rag-supabase-client.js");
  const courseId = req.query.courseId as string | undefined;

  const rawLimit = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100;

  const cursor = req.query.cursor as string | undefined;

  let query = supabase
    .from('chat_sessions_with_messages')
    .select('id, title, updated_at, course_id')
    .eq("user_id", userId);

  if (courseId) {
    query = query.eq("course_id", courseId);
  }

  if (cursor) {
    query = query.lt('updated_at', cursor);
  }

  const { data: sessions, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  res.json(sessions);
}));

// Get messages for a specific thread
// Defensive limit: returns the last 100 messages in ascending (chronological) order.
// For conversations with >100 messages, the oldest messages are omitted from
// the initial load.  A future "load older messages" endpoint can paginate backwards.
router.get("/threads/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ownership = await ensureThreadOwnership(req, id);
  if ("error" in ownership) {
    const status = ownership.status ?? 404;
    res.status(status).json({ error: ownership.error });
    return;
  }

  const { supabase } = ownership;

  const rawLimit = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100;

  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, is_pinned, parent_message_id, feedback, sources, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const chronological = (messages || []).reverse();

  // Hydrate attachment metadata so the client can restore attachments
  // after reload. Ownership is guaranteed by ensureThreadOwnership above.
  let attachmentsByMessage = new Map<string, unknown[]>();
  const messageIds = chronological.map((m: { id: string }) => m.id);
  if (messageIds.length > 0) {
    try {
      const { getAttachmentsByMessageIds } = await import(
        "../../services/chat/attachments-store.js"
      );
      attachmentsByMessage = await getAttachmentsByMessageIds(messageIds) as Map<string, unknown[]>;
    } catch { /* non-fatal — messages still load without attachments */ }
  }

  res.json(chronological.map((msg: Record<string, unknown>) => {
    const attachments = attachmentsByMessage.get(String(msg.id));
    return attachments?.length ? { ...msg, attachments } : msg;
  }));
}));

// ==========================================
// Phase 2.4: Conversation Branching
// ==========================================
// Branch from a specific message - creates a new thread with history up to that point
router.post("/threads/:id/branch", asyncHandler(async (req, res) => {
  const { id: sourceThreadId } = req.params;
  const { branchFromMessageId } = req.body ?? {};
  const userId = req.user?.id;
  
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  
  if (!branchFromMessageId) {
    res.status(400).json({ error: "branchFromMessageId is required" });
    return;
  }
  
  const ownership = await ensureThreadOwnership(req, sourceThreadId);
  if ("error" in ownership) {
    const status = ownership.status ?? 404;
    res.status(status).json({ error: ownership.error });
    return;
  }
  
  const { supabase } = ownership;
  
  const { data: allMessages, error: msgError } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sourceThreadId)
    .order('created_at', { ascending: true });
  
  if (msgError) throw msgError;
  if (!allMessages || allMessages.length === 0) {
    res.status(404).json({ error: "No messages found in source thread" });
    return;
  }
  
  const branchIndex = allMessages.findIndex((m: { id: string }) => m.id === branchFromMessageId);
  if (branchIndex === -1) {
    res.status(404).json({ error: "Branch point message not found in this thread" });
    return;
  }
  
  const branchMessages = allMessages.slice(0, branchIndex + 1);
  
  const { data: newThread, error: threadError } = await supabase
    .from('chat_sessions')
    .insert([{
      title: 'Branched Conversation',
      user_id: userId,
      parent_thread_id: sourceThreadId,
      branched_from_message_id: branchFromMessageId,
    }])
    .select('id, title, updated_at')
    .single();
  
  if (threadError) throw threadError;
  
  if (branchMessages.length > 0) {
    const newMessages = branchMessages.map((msg: Record<string, unknown>) => ({
      session_id: newThread.id,
      role: msg.role,
      content: msg.content,
      created_at: msg.created_at,
    }));
    
    const { error: copyError } = await supabase
      .from('chat_messages')
      .insert(newMessages);
    
    if (copyError) {
      await supabase.from('chat_sessions').delete().eq('id', newThread.id);
      throw copyError;
    }
  }
  
  res.status(201).json({
    thread: newThread,
    branchFromMessageId,
    copiedMessages: branchMessages.length,
  });
}));

// Delete a thread (and all its messages)
router.delete("/threads/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ownership = await ensureThreadOwnership(req, id);
  if ("error" in ownership) {
    const status = ownership.status ?? 404;
    res.status(status).json({ error: ownership.error });
    return;
  }

  const { supabase } = ownership;

  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', id);

  if (error) throw error;

  res.json({ success: true, message: "Thread deleted successfully" });
}));

// Pin or unpin a message
router.patch("/messages/:id/pin", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_pinned } = req.body;
  const { supabase } = await import("../../services/rag/rag-supabase-client.js");

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { data: messageRow, error: messageLookupError } = await supabase
    .from("chat_messages")
    .select("id, session_id, chat_sessions!inner(user_id)")
    .eq("id", id)
    .eq("chat_sessions.user_id", userId)
    .maybeSingle();

  if (messageLookupError) {
    throw messageLookupError;
  }

  if (!messageRow) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { error } = await supabase
    .from('chat_messages')
    .update({ is_pinned })
    .eq('id', id)
    .eq("session_id", messageRow.session_id);

  if (error) throw error;
  res.json({ success: true });
}));

// Submit feedback for a message
router.patch("/messages/:id/feedback", asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  const { is_positive } = req.body;

  let feedbackValue: 1 | -1 | null;
  if (is_positive === true) feedbackValue = 1;
  else if (is_positive === false) feedbackValue = -1;
  else if (is_positive === null || is_positive === undefined) feedbackValue = null;
  else {
    res.status(400).json({ error: "is_positive must be true, false, or null" });
    return;
  }

  const { supabase } = await import("../../services/rag/rag-supabase-client.js");

  const { data: messageRow, error: ownershipErr } = await supabase
    .from("chat_messages")
    .select("id, session_id, chat_sessions!inner(user_id)")
    .eq("id", id)
    .eq("chat_sessions.user_id", userId)
    .maybeSingle();

  if (ownershipErr) throw ownershipErr;
  if (!messageRow) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { error: updateErr } = await supabase
    .from("chat_messages")
    .update({ feedback: feedbackValue })
    .eq("id", id)
    .eq("session_id", messageRow.session_id);

  if (updateErr) throw updateErr;

  res.json({ success: true, feedback: feedbackValue });
}));

export default router;
