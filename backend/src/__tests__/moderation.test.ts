import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the lazy-loaded supabase client that moderation.service.ts imports via import()
const mockInvoke = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('../services/rag/rag-supabase-client.js', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

// Import AFTER mocks are set up
import { moderateInput, type CoreMessage } from '../services/chat/moderation.service.js';

/** Helper to build a user-role `CoreMessage` for tests. */
const u = (content: string): CoreMessage => ({ role: 'user', content });

describe('Moderation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default: returns null (service unavailable)
    mockInvoke.mockResolvedValue({ data: null, error: null });
  });

  describe('Length Check', () => {
    it('should block messages exceeding MAX_MESSAGE_CHARS', async () => {
      const longMessage = 'a'.repeat(400_001);
      const messages: CoreMessage[] = [u(longMessage)];

      const result = await moderateInput(messages);

      expect(result.blocked).toBe(true);
      expect(result.error).toContain('طويلة جداً');
    });

    it('should allow messages within length limit', async () => {
      mockInvoke.mockResolvedValue({
        data: { flagged: false, action: 'allow' },
        error: null,
      });

      const messages: CoreMessage[] = [u('Hello, how are you?')];
      const result = await moderateInput(messages);

      expect(result.blocked).toBe(false);
    });

    it('should handle empty messages', async () => {
      const result = await moderateInput([]);
      expect(result.blocked).toBe(false);
    });

    it('should handle messages without content', async () => {
      const messages: CoreMessage[] = [{ role: 'user', content: '' }];
      const result = await moderateInput(messages);
      expect(result.blocked).toBe(false);
    });
  });

  describe('Content Moderation', () => {
    it('should block when moderation service returns null (fail-closed)', async () => {
      // Default mock returns null data → service unavailable
      mockInvoke.mockResolvedValue({ data: null, error: null });

      const messages: CoreMessage[] = [u('Normal message')];
      const result = await moderateInput(messages);

      expect(result.blocked).toBe(true);
      expect(result.error).toContain('unavailable');
    });

    it('should censor flagged content', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          flagged: true,
          action: 'censor',
          flaggedParts: ['badword'],
        },
        error: null,
      });

      const messages: CoreMessage[] = [u('This is badword content')];
      const result = await moderateInput(messages);

      expect(result.blocked).toBe(false);
      expect(result.messages[0].content).toContain('***');
      expect(messages[0].content).toBe('This is badword content'); // Original unchanged
    });

    it('should block content when action is block', async () => {
      mockInvoke.mockResolvedValue({
        data: {
          flagged: true,
          action: 'block',
        },
        error: null,
      });

      const messages: CoreMessage[] = [u('Bad content')];
      const result = await moderateInput(messages);

      expect(result.blocked).toBe(true);
      expect(result.error).toContain('content policy');
    });

    it('should block when moderation service fails (fail-closed)', async () => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: new Error('Service unavailable'),
      });

      const messages: CoreMessage[] = [u('Normal message')];
      const result = await moderateInput(messages);

      expect(result.blocked).toBe(true);
      expect(result.error).toContain('unavailable');
    });
  });
});
