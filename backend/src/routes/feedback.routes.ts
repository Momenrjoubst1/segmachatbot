import express from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase.service.js';
import { asyncHandler } from '../utils/express-async-wrapper.js';
import { feedbackSchema } from '../validators/feedback-validation.js';
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
// Writes to chat_messages.feedback (SMALLINT: 1 = positive, -1 = negative).
// Ownership is enforced by joining through chat_sessions.user_id — a user
// can only rate messages inside their own threads.
const messageFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  isPositive: z.boolean(),
});

router.post(
  '/message',
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

    const { messageId, isPositive } = parsed.data;

    // Update only if the message belongs to a session owned by this user.
    const { data: owned, error: ownershipError } = await supabase
      .from('chat_messages')
      .select('id, chat_sessions!inner(user_id)')
      .eq('id', messageId)
      .eq('chat_sessions.user_id', userId)
      .maybeSingle();

    if (ownershipError) {
      log.error('Message feedback ownership check failed', { error: ownershipError.message });
      res.status(500).json({ error: 'Internal error' });
      return;
    }
    if (!owned) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const { error: updateError } = await supabase
      .from('chat_messages')
      .update({ feedback: isPositive ? 1 : -1 })
      .eq('id', messageId);

    if (updateError) {
      log.error('Message feedback update failed', { error: updateError.message });
      res.status(500).json({ error: 'Failed to save feedback' });
      return;
    }

    // ── Retrieval feedback loop: negative feedback → log miss ──────────────
    if (!isPositive) {
      try {
        // Get the session_id for this message to find the preceding user query
        const { data: msgRow } = await supabase
          .from('chat_messages')
          .select('session_id')
          .eq('id', messageId)
          .maybeSingle();

        if (msgRow?.session_id) {
          // Get the last user message before this assistant message
          const { data: lastUserMsg } = await supabase
            .from('chat_messages')
            .select('content')
            .eq('session_id', msgRow.session_id)
            .eq('role', 'user')
            .lt('created_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastUserMsg?.content) {
            await supabase.from('retrieval_feedback').insert({
              user_id: userId,
              query_text: lastUserMsg.content.slice(0, 2000),
              chunks_retrieved: 0,
              user_satisfied: false,
            });
          }
        }
      } catch (err) {
        // Silent — retrieval feedback failure must never break the main flow
        log.error('Retrieval feedback insert failed (passive)', { error: (err as Error).message });
      }
    }

    res.json({ success: true });
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
