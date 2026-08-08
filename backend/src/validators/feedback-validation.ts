import { z } from 'zod';

export const feedbackSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  category: z.enum(['bug', 'feature', 'improvement', 'other']),
  message: z.string().min(10).max(2000),
  rating: z.number().int().min(1).max(5),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
