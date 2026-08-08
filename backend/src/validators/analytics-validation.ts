import { z } from 'zod';

export const trackEventSchema = z.object({
  event_type: z.string().min(1).max(100),
  metadata: z.record(z.unknown()).optional(),
  thread_id: z.string().uuid().optional(),
  tokens_used: z.number().int().nonnegative().optional(),
  response_time_ms: z.number().int().nonnegative().optional(),
});

export const feedbackScoreSchema = z.object({
  message_id: z.string().uuid(),
  score: z.number().int().min(-1).max(1),
  thread_id: z.string().uuid().optional(),
});

export type TrackEventInput = z.infer<typeof trackEventSchema>;
export type FeedbackScoreInput = z.infer<typeof feedbackScoreSchema>;
