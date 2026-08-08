import { z } from 'zod';

export const updateInstructionsSchema = z.object({
  instructions: z.string().max(10000),
});

export const deleteMemorySchema = z.object({
  id: z.string().uuid(),
});

export type UpdateInstructionsInput = z.infer<typeof updateInstructionsSchema>;
export type DeleteMemoryInput = z.infer<typeof deleteMemorySchema>;
