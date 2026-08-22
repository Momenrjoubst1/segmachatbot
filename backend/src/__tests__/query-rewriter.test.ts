import { describe, it, expect, vi } from 'vitest';
import { rewriteQuery } from '../services/chat/query-rewriter.js';
import { UserIntent } from '../services/chat/intent-detector.js';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Query Rewriter', () => {
  const knowledgeIntent = {
    intent: UserIntent.KNOWLEDGE_QUERY,
    confidence: 0.8,
    needsRAG: true,
    needsTools: false,
  };

  const followUpIntent = {
    intent: UserIntent.FOLLOW_UP,
    confidence: 0.8,
    needsRAG: true,
    needsTools: false,
  };

  const smallTalkIntent = {
    intent: UserIntent.SMALL_TALK,
    confidence: 0.9,
    needsRAG: false,
    needsTools: false,
  };

  describe('HyDE strategy', () => {
    it('should use hyde for knowledge queries with high confidence', () => {
      const result = rewriteQuery('What are database normalization forms?', [], knowledgeIntent);
      expect(result.strategy).toBe('hyde');
      expect(result.rewritten).toContain('Document about:');
      expect(result.rewritten).toContain('Jordan University');
    });

    it('should use hyde for Arabic knowledge queries', () => {
      const result = rewriteQuery('ما هي أنواع القواعد البيانات؟', [], knowledgeIntent);
      expect(result.strategy).toBe('hyde');
      expect(result.rewritten).toContain('Document about:');
    });
  });

  describe('Contextualized strategy', () => {
    it('should use contextualized for follow-up queries', () => {
      const recentMessages = [
        { role: 'user', content: 'What is normalization?' },
        { role: 'assistant', content: 'Normalization is the process of organizing data in a database.' },
      ];
      const result = rewriteQuery('What about 2NF?', recentMessages, followUpIntent);
      expect(result.strategy).toBe('contextualized');
      expect(result.rewritten).toContain('What about 2NF?');
    });

    it('should handle follow-up with no prior assistant message', () => {
      const result = rewriteQuery('Tell me more', [], followUpIntent);
      expect(result.strategy).toBe('contextualized');
      expect(result.rewritten).toBe('Tell me more');
    });
  });

  describe('Expanded strategy', () => {
    it('should expand Arabic academic terms in short non-knowledge queries', () => {
      // small_talk intent ensures hyde doesn't trigger
      const result = rewriteQuery('ساعات التسجيل', [], smallTalkIntent);
      expect(result.strategy).toBe('expanded');
      expect(result.rewritten).toContain('ساعات');
      expect(result.rewritten).toContain('registration');
    });
  });

  describe('Direct strategy', () => {
    it('should use direct for long questions', () => {
      const longQuestion = 'What are the main differences between SQL and NoSQL databases in terms of scalability and performance?';
      const result = rewriteQuery(longQuestion, [], smallTalkIntent);
      expect(result.strategy).toBe('direct');
      expect(result.rewritten).toBe(longQuestion);
    });
  });

  describe('Passthrough fallback', () => {
    it('should pass through when no strategy applies', () => {
      const message = 'hi';
      const result = rewriteQuery(message, [], smallTalkIntent);
      expect(result.rewritten).toBeDefined();
      expect(result.original).toBe(message);
    });
  });

  describe('Question detection', () => {
    it('should detect Arabic question marks', () => {
      const result = rewriteQuery('ما هي أنواع القواعد؟', [], smallTalkIntent);
      expect(result.original).toBe('ما هي أنواع القواعد؟');
    });

    it('should detect English question marks', () => {
      const result = rewriteQuery('What is a database?', [], smallTalkIntent);
      expect(result.original).toBe('What is a database?');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty message', () => {
      const result = rewriteQuery('', [], smallTalkIntent);
      expect(result.rewritten).toBe('');
    });

    it('should handle whitespace-only message', () => {
      const result = rewriteQuery('   ', [], smallTalkIntent);
      expect(result.rewritten).toBeDefined();
      expect(result.original).toBe('');
    });
  });
});
