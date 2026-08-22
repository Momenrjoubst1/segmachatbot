import { z } from 'zod';

export const chatTranslationSchema = z.object({
  text: z
    .string()
    .min(1, 'text cannot be empty')
    .max(2000, 'text too long (max 2000 chars)'),
  targetLang: z
    .enum(['en', 'en-formal', 'es', 'ar', 'fr', 'de', 'tr', 'fa', 'zh']),
});

/** Max characters per message content — enforced by moderation but also validated here as defense-in-depth */
const MAX_MESSAGE_CONTENT_CHARS = 32_000;

/** Max base64 string length per attached image (~6MB binary after decoding) */
const MAX_IMAGE_DATA_CHARS = 8_000_000;

/**
 * Images per single message. The composer enforces 3 for new sends; the
 * higher server-side cap keeps older multi-image history messages valid.
 */
const MAX_IMAGE_PARTS_PER_MESSAGE = 6;

const messagePartSchema = z
  .object({
    type: z.string(),
    text: z.string().max(MAX_MESSAGE_CONTENT_CHARS).optional(),
  })
  .passthrough()
  .superRefine((part, ctx) => {
    const dataFields = [part.image, part.url, part.data, part.base64];
    for (const value of dataFields) {
      if (typeof value === 'string' && value.length > MAX_IMAGE_DATA_CHARS) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: 'string',
          inclusive: true,
          maximum: MAX_IMAGE_DATA_CHARS,
          message: 'attached image data too large',
        });
        return;
      }
    }
  });

function isImageLikePart(part: Record<string, unknown>): boolean {
  if (part.type === 'image') return true;
  const url = part.url;
  return typeof url === 'string' && url.startsWith('data:image/');
}

const messageContentPartsSchema = z
  .array(messagePartSchema)
  .max(20)
  .superRefine((parts, ctx) => {
    const imageCount = parts.filter((p) => isImageLikePart(p as Record<string, unknown>)).length;
    if (imageCount > MAX_IMAGE_PARTS_PER_MESSAGE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `too many images in one message (max ${MAX_IMAGE_PARTS_PER_MESSAGE})`,
      });
    }
  });

/**
 * Loose validator for the streaming chat endpoint. The full message-shape
 * validation (parts, base64 images, etc.) happens later in chat.routes.ts
 * — this only protects against outright type confusion on the URL/body
 * — actual content length validation happens in moderation (MAX_MESSAGE_CHARS = 32000)
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
    // Validate messages array structure early to catch malformed payloads
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant', 'system', 'tool']),
          content: z.union([
            z.string().max(MAX_MESSAGE_CONTENT_CHARS),
            messageContentPartsSchema,
            z.record(z.unknown()),
          ]),
        })
      )
      .min(1, 'messages array cannot be empty')
      .max(100, 'messages array too long')
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