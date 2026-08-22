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
 * ⚠️ KEEP THIS VALIDATOR LOOSE — see incident note below.
 *
 * History: a stricter revision added a required `content` union here and
 * silently broke every chat request: the assistant-ui AI-SDK transport sends
 * UIMessages shaped `{ id, role, parts }` WITHOUT `content`, so all requests
 * failed with "messages.0.content: Invalid input" (400). The original design
 * is intentional: this gate only protects scalar fields; message-shape
 * handling lives in services/chat/message-processor.service.ts, and content
 * length limits live in moderation (MAX_MESSAGE_CHARS).
 *
 * Messages get a light structural check only (array of objects with a string
 * role). Do NOT require `content` or reject unknown shapes here.
 */
const MAX_MESSAGES = 200;

export const chatMessageSchema = z
  .object({
    threadId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    ragEnabled: z.boolean().optional(),
    model: z.string().max(200).optional(),
    modelName: z.string().max(200).optional(),
    /** Idempotency key generated client-side for new chats (prevents duplicate sessions on 401 retry) */
    clientChatGuid: z.string().uuid().optional(),
    // Light structural check only — accepts BOTH legacy
    // `{role, content}` and UIMessage `{id, role, parts}` formats.
    messages: z
      .array(
        z.object({ role: z.string() }).passthrough()
      )
      .min(1, 'messages array cannot be empty')
      .max(MAX_MESSAGES)
      .optional(),
    data: z
      .object({
        modelName: z.string().max(200).optional(),
      })
      .optional(),
    config: z
      .object({
        modelName: z.string().max(200).optional(),
      })
      .optional(),
  })
  .strip();

export const chatMessagesSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().max(32000),
    })
  ).min(1),
});

export type ChatTranslationInput = z.infer<typeof chatTranslationSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type ChatMessagesInput = z.infer<typeof chatMessagesSchema>;