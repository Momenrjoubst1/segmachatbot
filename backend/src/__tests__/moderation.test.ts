import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moderateInput, type CoreMessage } from '../services/chat/moderation.service.js';

// Mock the rag/rag-supabase-client module
vi.mock('../services/rag/rag-supabase-client.js', () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));

/** Helper to build a user-role `CoreMessage` for tests. */
const u = (content: string): CoreMessage => ({ role: 'user', content });

describe('Moderation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Length Check', () => {
    it('should block messages exceeding MAX_MESSAGE_CHARS', async () => {
      const longMessage = 'a'.repeat(32_001);
      const messages: CoreMessage[] = [u(longMessage)];

      const result = await moderateInput(messages);

      expect(result.blocked).toBe(true);
      expect(result.error).toContain('طويلة جداً');
    });

    it('should allow messages within length limit', async () => {
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
    it('should proceed when moderation service returns null', async () => {
      const messages: CoreMessage[] = [u('Normal message')];

      const result = await moderateInput(messages);

      expect(result.blocked).toBe(false);
    });

    it('should censor flagged content', async () => {
      const { supabase } = await import('../services/rag/rag-supabase-client.js');
      (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
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
      expect(messages[0].content).toContain('***');
    });

    it('should block content when action is block', async () => {
      const { supabase } = await import('../services/rag/rag-supabase-client.js');
      (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
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

    it('should proceed when moderation service fails', async () => {
      const { supabase } = await import('../services/rag/rag-supabase-client.js');
      (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: new Error('Service unavailable'),
      });

      const messages: CoreMessage[] = [u('Normal message')];
      const result = await moderateInput(messages);

      expect(result.blocked).toBe(false);
    });
  });
});
