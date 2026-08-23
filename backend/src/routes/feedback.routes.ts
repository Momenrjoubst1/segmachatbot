import express from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase.service.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { feedbackSchema, messageFeedbackSchema } from '../validators/feedback-validation.js';
import { feedbackLimiter } from '../middleware/rate-limiters.js';
import { log } from '../utils/logger.js';

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, name, category, message, rating } = parsed.data;
  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    email: email ?? req.user?.email ?? null,
    name,
    category,
    message,
    rating,
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true });
}));

// ── Message-level feedback (thumbs up/down on assistant messages) ──────────
// Source of truth is the message_feedback table (migration 028); the legacy
// chat_messages.feedback SMALLINT column is kept in sync for compatibility.
//
// Semantics:
//   - First rating           → INSERT   { action: 'created' }
//   - Rating switched        → UPDATE   { action: 'updated' }
//   - Same type re-submitted → DELETE   { action: 'removed' }  (toggle off)
//
// Ownership is enforced by joining through chat_sessions.user_id — a user can
// only rate messages inside their own threads. Snapshots of the rated exchange
// are captured server-side at rating time; clients never supply them.
const SNAPSHOT_MAX_LENGTH = 8000;

router.post(
  '/message',
  feedbackLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = messageFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { messageId, isPositive, reasonCategory, comment } = parsed.data;
    const feedbackType = isPositive ? 'like' : 'dislike';
    // Reason/comment only apply to dislikes — strip them when switching to a like.
    const dislikeMeta = isPositive
      ? { reason_category: null, comment: null }
      : { reason_category: reasonCategory ?? null, comment: comment ?? null };

    // Ownership + snapshot source: fetch the rated message directly with its
    // session owner. Non-assistant messages are not rateable.
    const { data: messageRow, error: ownershipError } = await supabase
      .from('chat_messages')
      .select('id, session_id, content, model, created_at, chat_sessions!inner(user_id)')
      .eq('id', messageId)
      .eq('role', 'assistant')
      .eq('chat_sessions.user_id', userId)
      .maybeSingle();

    if (ownershipError) {
      log.error('Message feedback ownership check failed', { error: ownershipError.message });
      res.status(500).json({ error: 'Internal error' });
      return;
    }
    if (!messageRow) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const responseSnapshot = messageRow.content.slice(0, SNAPSHOT_MAX_LENGTH);
    const modelVersion = messageRow.model || 'unknown';

    // Existing rating (for toggle detection) and the prompt snapshot (the user
    // question that preceded this answer) are independent — fetch in parallel.
    const [existingResult, promptResult] = await Promise.all([
      supabase
        .from('message_feedback')
        .select('id, feedback_type')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('chat_messages')
        .select('content')
        .eq('session_id', messageRow.session_id)
        .eq('role', 'user')
        .lt('created_at', messageRow.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (existingResult.error) {
      log.error('Message feedback lookup failed', { error: existingResult.error.message });
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    const existing = existingResult.data as { id: string; feedback_type: string } | null;
    const promptSnapshot = promptResult.data?.content
      ? promptResult.data.content.slice(0, SNAPSHOT_MAX_LENGTH)
      : null;

    // Same type re-submitted → the active button was clicked again: remove.
    if (existing && existing.feedback_type === feedbackType) {
      const [deleteResult, syncResult] = await Promise.all([
        supabase.from('message_feedback').delete().eq('id', existing.id),
        supabase.from('chat_messages').update({ feedback: null }).eq('id', messageId),
      ]);
      if (deleteResult.error) {
        log.error('Message feedback delete failed', { error: deleteResult.error.message });
        res.status(500).json({ error: 'Failed to save feedback' });
        return;
      }
      if (syncResult.error) {
        log.error('Legacy feedback column sync failed', { error: syncResult.error.message });
      }
      res.json({ success: true, action: 'removed', feedback: null });
      return;
    }

    let saveError: { message: string } | null;
    if (existing) {
      ({ error: saveError } = await supabase
        .from('message_feedback')
        .update({
          feedback_type: feedbackType,
          ...dislikeMeta,
          prompt_snapshot: promptSnapshot,
          response_snapshot: responseSnapshot,
          model_version: modelVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id));
    } else {
      ({ error: saveError } = await supabase.from('message_feedback').insert({
        conversation_id: messageRow.session_id,
        message_id: messageId,
        user_id: userId,
        feedback_type: feedbackType,
        ...dislikeMeta,
        prompt_snapshot: promptSnapshot,
        response_snapshot: responseSnapshot,
        model_version: modelVersion,
      }));
    }

    if (saveError) {
      log.error('Message feedback save failed', { error: saveError.message });
      res.status(500).json({ error: 'Failed to save feedback' });
      return;
    }

    // Legacy column sync — best-effort, never fails the request.
    const { error: syncError } = await supabase
      .from('chat_messages')
      .update({ feedback: isPositive ? 1 : -1 })
      .eq('id', messageId);
    if (syncError) {
      log.error('Legacy feedback column sync failed', { error: syncError.message });
    }

    // ── Retrieval feedback loop: negative feedback → log miss ──────────────
    if (!isPositive && promptSnapshot !== null) {
      try {
        await supabase.from('retrieval_feedback').insert({
          user_id: userId,
          query_text: promptSnapshot.slice(0, 2000),
          chunks_retrieved: 0,
          user_satisfied: false,
        });
      } catch (err) {
        // Silent — retrieval feedback failure must never break the main flow
        log.error('Retrieval feedback insert failed (passive)', { error: (err as Error).message });
      }
    }

    res.json({
      success: true,
      action: existing ? 'updated' : 'created',
      feedback: isPositive ? 1 : -1,
    });
  }),
);

// ── Retrieval quality feedback (thumbs up/down on RAG answers) ──────────
// Writes to retrieval_feedback table for active learning analysis.
const retrievalFeedbackSchema = z.object({
  textbookId: z.string().uuid().optional(),
  queryText: z.string().min(1).max(2000),
  matchedSectionId: z.string().uuid().optional(),
  matchedPages: z.array(z.number().int().positive()).optional(),
  chunksRetrieved: z.number().int().nonnegative().optional(),
  satisfied: z.boolean(),
  feedbackText: z.string().max(2000).optional(),
});

router.post(
  '/retrieval',
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = retrievalFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { textbookId, queryText, matchedSectionId, matchedPages, chunksRetrieved, satisfied, feedbackText } = parsed.data;

    const { error } = await supabase.from('retrieval_feedback').insert({
      user_id: userId,
      textbook_id: textbookId || null,
      query_text: queryText,
      matched_section_id: matchedSectionId || null,
      matched_pages: matchedPages || null,
      chunks_retrieved: chunksRetrieved || 0,
      user_satisfied: satisfied,
      feedback_text: feedbackText || null,
    });

    if (error) {
      log.error('Retrieval feedback insert failed', { error: error.message });
      res.status(500).json({ error: 'Failed to save feedback' });
      return;
    }

    res.json({ success: true });
  }),
);

export default router;
