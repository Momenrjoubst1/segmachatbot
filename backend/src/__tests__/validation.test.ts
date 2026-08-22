import { describe, it, expect } from 'vitest';
import { validateAndPrepareRequest } from '../services/chat/pipeline/validation.js';

describe('Validation Pipeline Step', () => {
  const validBody = {
    messages: [
      { role: 'user', content: 'Hello' },
    ],
  };

  describe('Valid requests', () => {
    it('should accept a valid request with messages', () => {
      const result = validateAndPrepareRequest({
        body: validBody,
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe('user-123');
        expect(result.selectedModel).toBeDefined();
        expect(result.messages).toHaveLength(1);
        expect(result.ragEnabled).toBe(true);
      }
    });

    it('should accept request with model selection', () => {
      const result = validateAndPrepareRequest({
        body: { ...validBody, model: 'gpt-4o' },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.selectedModel).toBe('gpt-4o');
      }
    });

    it('should accept request with config.modelName', () => {
      const result = validateAndPrepareRequest({
        body: { ...validBody, config: { modelName: 'gemini-3.7-flash' } },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.selectedModel).toBe('gemini-3.7-flash');
      }
    });

    it('should accept request with data.modelName', () => {
      const result = validateAndPrepareRequest({
        body: { ...validBody, data: { modelName: 'glm-5.2' } },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.selectedModel).toBe('glm-5.2');
      }
    });

    it('should accept request with ragEnabled false', () => {
      const result = validateAndPrepareRequest({
        body: { ...validBody, ragEnabled: false },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.ragEnabled).toBe(false);
      }
    });

    it('should accept request with threadId and courseId', () => {
      const result = validateAndPrepareRequest({
        body: {
          ...validBody,
          threadId: '550e8400-e29b-41d4-a716-446655440000',
          courseId: '550e8400-e29b-41d4-a716-446655440001',
        },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.threadId).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(result.courseId).toBe('550e8400-e29b-41d4-a716-446655440001');
      }
    });

    it('should create metrics with correct model', () => {
      const result = validateAndPrepareRequest({
        body: { ...validBody, model: 'gpt-4o' },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.metrics.model).toBe('gpt-4o');
        expect(result.metrics.startTime).toBeDefined();
        expect(result.metrics.ragSuccess).toBe(false);
      }
    });
  });

  describe('Invalid requests', () => {
    it('should reject missing user (unauthorized)', () => {
      const result = validateAndPrepareRequest({ body: validBody, user: undefined });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.payload.error).toBe('Unauthorized');
      }
    });

    it('should reject empty messages array', () => {
      const result = validateAndPrepareRequest({
        body: { messages: [] },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }
    });

    it('should reject unauthorized model and fall back to default', () => {
      const result = validateAndPrepareRequest({
        body: { ...validBody, model: 'totally-fake-model-9000' },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.modelFallback).toBeDefined();
        expect(result.modelFallback?.from).toBe('totally-fake-model-9000');
      }
    });
  });

  describe('Message content formats', () => {
    it('should accept string content', () => {
      const result = validateAndPrepareRequest({
        body: {
          messages: [{ role: 'user', content: 'Hello world' }],
        },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
    });

    it('should accept array content with text parts', () => {
      const result = validateAndPrepareRequest({
        body: {
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          }],
        },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
    });

    it('should accept record content', () => {
      const result = validateAndPrepareRequest({
        body: {
          messages: [{
            role: 'user',
            content: { key: 'value' },
          }],
        },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
    });

    it('should accept tool role messages', () => {
      const result = validateAndPrepareRequest({
        body: {
          messages: [
            { role: 'tool', content: 'Tool result' },
            { role: 'user', content: 'Continue' },
          ],
        },
        user: { id: 'user-123' },
      });
      expect(result.ok).toBe(true);
    });
  });
});
