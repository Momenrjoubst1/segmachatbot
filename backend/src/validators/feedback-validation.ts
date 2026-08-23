import { z } from 'zod';

export const feedbackSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  category: z.enum(['bug', 'feature', 'improvement', 'other']),
  message: z.string().min(10).max(2000),
  rating: z.number().int().min(1).max(5),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

// ── Message-level feedback (thumbs up/down on assistant messages) ─────────
// reasonCategory/comment only accompany dislikes; stripped server-side for likes.
export const FEEDBACK_REASON_CATEGORIES = [
  'inaccurate',
  'harmful',
  'not_helpful',
  'off_topic',
  'other',
] as const;

export const messageFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  isPositive: z.boolean(),
  reasonCategory: z.enum(FEEDBACK_REASON_CATEGORIES).optional(),
  comment: z.string().trim().max(2000).optional(),
});

export type MessageFeedbackInput = z.infer<typeof messageFeedbackSchema>;
