import { describe, it, expect } from 'vitest';
import { detectIntent, UserIntent } from '../services/chat/intent-detector.js';

describe('Intent Detector', () => {
  describe('Small Talk Detection', () => {
    it('should detect Arabic greeting', async () => {
      const result = await detectIntent('مرحبا', []);
      expect(result.intent).toBe(UserIntent.SMALL_TALK);
      expect(result.needsRAG).toBe(false);
      expect(result.needsTools).toBe(false);
    });

    it('should detect English greeting', async () => {
      const result = await detectIntent('Hello', []);
      expect(result.intent).toBe(UserIntent.SMALL_TALK);
      expect(result.needsRAG).toBe(false);
    });

    it('should detect Arabic thanks', async () => {
      const result = await detectIntent('شكراً', []);
      expect(result.intent).toBe(UserIntent.SMALL_TALK);
    });

    it('should detect English thanks', async () => {
      const result = await detectIntent('Thank you', []);
      expect(result.intent).toBe(UserIntent.SMALL_TALK);
    });

    it('should detect Arabic how are you', async () => {
      const result = await detectIntent('كيف حالك', []);
      expect(result.intent).toBe(UserIntent.SMALL_TALK);
    });

    it('should detect English how are you', async () => {
      const result = await detectIntent('How are you?', []);
      expect(result.intent).toBe(UserIntent.SMALL_TALK);
    });
  });

  describe('Tool Request Detection', () => {
    it('should detect Arabic send email request', async () => {
      const result = await detectIntent('أرسل إيميل للمعلم', []);
      expect(result.intent).toBe(UserIntent.TOOL_REQUEST);
      expect(result.needsTools).toBe(true);
    });

    it('should detect English send email request', async () => {
      const result = await detectIntent('Send an email to the professor', []);
      expect(result.intent).toBe(UserIntent.TOOL_REQUEST);
      expect(result.needsTools).toBe(true);
    });

    it('should detect Arabic calendar request', async () => {
      const result = await detectIntent('أنشئ حدث في التقويم', []);
      expect(result.intent).toBe(UserIntent.TOOL_REQUEST);
      expect(result.needsTools).toBe(true);
    });

    it('should detect English calendar request', async () => {
      const result = await detectIntent('Create a calendar event', []);
      expect(result.intent).toBe(UserIntent.TOOL_REQUEST);
      expect(result.needsTools).toBe(true);
    });

    it('should detect Arabic search request', async () => {
      const result = await detectIntent('ابحث عن معلومات', []);
      expect(result.intent).toBe(UserIntent.TOOL_REQUEST);
      expect(result.needsTools).toBe(true);
    });

    it('should detect English search request', async () => {
      const result = await detectIntent('Search for information', []);
      expect(result.intent).toBe(UserIntent.TOOL_REQUEST);
      expect(result.needsTools).toBe(true);
    });
  });

  describe('Personal Query Detection', () => {
    it('should detect Arabic personal query', async () => {
      const result = await detectIntent('ما هي موادي؟', []);
      expect(result.intent).toBe(UserIntent.PERSONAL_QUERY);
    });

    it('should detect English personal query', async () => {
      const result = await detectIntent('What are my courses?', []);
      expect(result.intent).toBe(UserIntent.PERSONAL_QUERY);
    });

    it('should detect Arabic grades query', async () => {
      const result = await detectIntent('ما هي علاماتي؟', []);
      expect(result.intent).toBe(UserIntent.PERSONAL_QUERY);
    });

    it('should detect English grades query', async () => {
      const result = await detectIntent('What are my grades?', []);
      expect(result.intent).toBe(UserIntent.PERSONAL_QUERY);
    });
  });

  describe('Knowledge Query Detection', () => {
    it('should detect Arabic academic question', async () => {
      const result = await detectIntent('ما هي أنواع القواعد البيانات؟', []);
      expect(result.intent).toBe(UserIntent.KNOWLEDGE_QUERY);
      expect(result.needsRAG).toBe(true);
    });

    it('should detect English academic question', async () => {
      const result = await detectIntent('What are the types of databases?', []);
      expect(result.intent).toBe(UserIntent.KNOWLEDGE_QUERY);
      expect(result.needsRAG).toBe(true);
    });
  });

  describe('Follow-up Detection', () => {
    it('should detect Arabic follow-up', async () => {
      const result = await detectIntent('وماذا عن التكامل؟', [
        { role: 'assistant', content: 'تحدثنا عن الاختبار' },
      ]);
      expect(result.intent).toBe(UserIntent.FOLLOW_UP);
    });

    it('should detect English follow-up', async () => {
      const result = await detectIntent('What about integration?', [
        { role: 'assistant', content: 'We talked about testing' },
      ]);
      expect(result.intent).toBe(UserIntent.FOLLOW_UP);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message', async () => {
      const result = await detectIntent('', []);
      expect(result.intent).toBeDefined();
    });

    it('should handle very long message', async () => {
      const longMessage = 'ما هي '.repeat(100) + 'القواعد؟';
      const result = await detectIntent(longMessage, []);
      expect(result.intent).toBeDefined();
    });

    it('should handle message with special characters', async () => {
      const result = await detectIntent('مرحبا!!! كيف حالك؟؟؟', []);
      expect(result.intent).toBeDefined();
    });
  });
});
