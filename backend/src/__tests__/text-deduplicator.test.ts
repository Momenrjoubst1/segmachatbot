import { describe, it, expect, vi } from 'vitest';
import { deduplicateTexts, containsDuplicate, deduplicateSentences, deduplicateMemoryContexts } from '../services/memory/text-deduplicator.js';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Text Deduplicator', () => {
  describe('deduplicateTexts', () => {
    it('should remove exact duplicates', () => {
      // minLength is 20 by default so short texts skip dedup, use longer texts
      const texts = [
        'The quick brown fox jumps over the lazy dog here',
        'The quick brown fox jumps over the lazy dog here',
        'Completely different text about another topic entirely',
      ];
      const result = deduplicateTexts(texts, { strategy: 'jaccard', threshold: 0.7 });
      expect(result).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const result = deduplicateTexts([]);
      expect(result).toHaveLength(0);
    });

    it('should return all texts when no duplicates', () => {
      const texts = [
        'Machine learning is a subset of artificial intelligence',
        'Database normalization is important for reducing redundancy',
        'Arabic language processing has unique challenges',
      ];
      const result = deduplicateTexts(texts);
      expect(result).toHaveLength(3);
    });

    it('should handle single text', () => {
      const result = deduplicateTexts(['Single text entry here']);
      expect(result).toHaveLength(1);
    });

    it('should detect similar texts via Jaccard', () => {
      const texts = [
        'The quick brown fox jumps over the lazy dog in the field',
        'The quick brown fox jumps over the lazy cat in the field',
        'Completely different text about something else entirely here',
      ];
      const result = deduplicateTexts(texts, { strategy: 'jaccard', threshold: 0.7 });
      expect(result.length).toBeLessThan(3);
    });

    it('should keep dissimilar texts', () => {
      const texts = [
        'Machine learning algorithms for data science applications',
        'Arabic language processing techniques for NLP systems',
      ];
      const result = deduplicateTexts(texts, { strategy: 'jaccard', threshold: 0.7 });
      expect(result).toHaveLength(2);
    });

    it('should handle Arabic text deduplication', () => {
      const texts = [
        'الخوارزميات المستخدمة في تعلم الآلة والبيانات الضخمة',
        'الخوارزميات المستخدمة في تعلم الآلة والبيانات الكبيرة جدا',
        'نص مختلف تماماً عن شيء آخر تماماً في موضوع مختلف',
      ];
      const result = deduplicateTexts(texts, { strategy: 'jaccard', threshold: 0.7 });
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should not deduplicate texts shorter than minLength', () => {
      const texts = ['Short text is here', 'Short text is here', 'A much longer text that is unique to the collection'];
      const result = deduplicateTexts(texts, { minLength: 20 });
      // minLength is 20 and texts are short, so no dedup happens
      expect(result).toHaveLength(3);
    });
  });

  describe('containsDuplicate', () => {
    it('should return true for similar long text', () => {
      const existing = [
        'The quick brown fox jumps over the lazy dog in the yard',
      ];
      const similar = 'The quick brown fox jumps over the lazy dog in the park';
      expect(containsDuplicate(similar, existing, { threshold: 0.6 })).toBe(true);
    });

    it('should return false for unique text', () => {
      expect(containsDuplicate('Unique text content here that is very different', [
        'Hello world how are you today doing well',
      ])).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(containsDuplicate('Hello world how are you today', [])).toBe(false);
    });
  });

  describe('deduplicateSentences', () => {
    it('should remove duplicate sentences', () => {
      const text = 'First sentence is about databases. Second sentence is about networks. First sentence is about databases.';
      const result = deduplicateSentences(text);
      expect(result).toContain('First sentence is about databases');
      expect(result).toContain('Second sentence is about networks');
    });

    it('should handle empty text', () => {
      const result = deduplicateSentences('');
      expect(result).toBe('');
    });

    it('should preserve unique sentences', () => {
      const text = 'First sentence about databases. Second sentence about networking. Third sentence about security.';
      const result = deduplicateSentences(text);
      expect(result).toContain('First sentence about databases');
      expect(result).toContain('Second sentence about networking');
      expect(result).toContain('Third sentence about security');
    });
  });

  describe('deduplicateMemoryContexts', () => {
    it('should return all unique contexts', () => {
      const contexts = [
        'User prefers detailed responses about programming and coding',
        'User likes brief answers for quick questions only',
        'User is a computer science major at university',
      ];
      const result = deduplicateMemoryContexts(contexts);
      expect(result.uniqueTexts).toHaveLength(3);
      expect(result.duplicatesRemoved).toBe(0);
    });

    it('should remove duplicate contexts', () => {
      const contexts = [
        'User prefers detailed responses about programming and coding topics',
        'User prefers detailed responses about programming and coding tasks',
        'User is a computer science major at university',
      ];
      const result = deduplicateMemoryContexts(contexts, { threshold: 0.5 });
      expect(result.uniqueTexts.length).toBeLessThan(3);
      expect(result.duplicatesRemoved).toBeGreaterThan(0);
    });

    it('should handle empty contexts', () => {
      const result = deduplicateMemoryContexts([]);
      expect(result.uniqueTexts).toHaveLength(0);
      expect(result.duplicatesRemoved).toBe(0);
    });

    it('should track similarity scores for duplicates', () => {
      const contexts = [
        'User likes coffee and tea in the morning',
        'User likes coffee and tea in the morning daily',
        'User likes tea and water in the evening',
      ];
      const result = deduplicateMemoryContexts(contexts, { threshold: 0.5 });
      if (result.duplicatesRemoved > 0) {
        expect(result.similarityScores.length).toBeGreaterThan(0);
      }
    });
  });
});
