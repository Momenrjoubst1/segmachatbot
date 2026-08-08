import { z } from 'zod';

export const chatTranslationSchema = z.object({
  text: z
    .string()
    .min(1, 'text cannot be empty')
    .max(2000, 'text too long (max 2000 chars)'),
  targetLang: z
    .enum(['en', 'en-formal', 'es', 'ar', 'fr', 'de', 'tr', 'fa', 'zh']),
});

/**
 * Loose validator for the streaming chat endpoint. The full message-shape
 * validation (parts, base64 images, etc.) happens later in chat.routes.ts
 * — this only protects against outright type confusion on the URL/body
 * (e.g. threadId not a string, ragEnabled not a boolean).
 *
 * Kept as a `.partial()` style on the known scalar fields so we don't
 * reject legitimate assistant-ui payloads that include extra fields.
 */
export const chatMessageSchema = z
  .object({
    threadId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    ragEnabled: z.boolean().optional(),
    model: z.string().max(200).optional(),
    modelName: z.string().max(200).optional(),
    /** Idempotency key generated client-side for new chats (prevents duplicate sessions on 401 retry) */
    clientChatGuid: z.string().uuid().optional(),
  })
  .strip();

export const chatMessagesSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().max(50000),
    })
  ).min(1),
});

export type ChatTranslationInput = z.infer<typeof chatTranslationSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type ChatMessagesInput = z.infer<typeof chatMessagesSchema>;
