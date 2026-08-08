import { describe, it, expect } from 'vitest';
import {
  chatMessageSchema,
  chatTranslationSchema,
} from '../validators/chat-validation-schemas.js';

describe('Validators', () => {
  describe('chatMessageSchema', () => {
    it('should accept empty body', () => {
      const result = chatMessageSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept valid threadId', () => {
      const result = chatMessageSchema.safeParse({
        threadId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid threadId format', () => {
      const result = chatMessageSchema.safeParse({
        threadId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid courseId', () => {
      const result = chatMessageSchema.safeParse({
        courseId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('should accept ragEnabled boolean', () => {
      const result = chatMessageSchema.safeParse({
        ragEnabled: true,
      });
      expect(result.success).toBe(true);
    });

    it('should accept model string', () => {
      const result = chatMessageSchema.safeParse({
        model: 'llama-3.3-70b-versatile',
      });
      expect(result.success).toBe(true);
    });

    it('should accept clientChatGuid', () => {
      const result = chatMessageSchema.safeParse({
        clientChatGuid: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('should accept extra fields (passthrough)', () => {
      const result = chatMessageSchema.safeParse({
        threadId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [{ role: 'user', content: 'Hello' }],
        extraField: 'test',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('chatTranslationSchema', () => {
    it('should accept valid translation request', () => {
      const result = chatTranslationSchema.safeParse({
        text: 'Hello world',
        targetLang: 'ar',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty text', () => {
      const result = chatTranslationSchema.safeParse({
        text: '',
        targetLang: 'ar',
      });
      expect(result.success).toBe(false);
    });

    it('should reject text exceeding 2000 chars', () => {
      const result = chatTranslationSchema.safeParse({
        text: 'a'.repeat(2001),
        targetLang: 'ar',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid target language', () => {
      const result = chatTranslationSchema.safeParse({
        text: 'Hello',
        targetLang: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid target languages', () => {
      const validLangs = ['en', 'en-formal', 'es', 'ar', 'fr', 'de', 'tr', 'fa', 'zh'];
      
      for (const lang of validLangs) {
        const result = chatTranslationSchema.safeParse({
          text: 'Hello',
          targetLang: lang,
        });
        expect(result.success).toBe(true);
      }
    });
  });
});
