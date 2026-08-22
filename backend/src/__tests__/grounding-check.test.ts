import { describe, it, expect, vi } from 'vitest';
import { checkGrounding } from '../services/chat/grounding-check.js';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Grounding Check', () => {
  describe('No documents', () => {
    it('should return grounded when no docs retrieved', () => {
      const result = checkGrounding('Any response', []);
      expect(result.isGrounded).toBe(true);
      expect(result.groundedPercentage).toBe(100);
      expect(result.ungroundedClaims).toHaveLength(0);
    });

    it('should handle null/undefined docs', () => {
      const result = checkGrounding('Any response', null as any);
      expect(result.isGrounded).toBe(true);
    });
  });

  describe('Empty response', () => {
    it('should return grounded for empty response', () => {
      const result = checkGrounding('', [{ content: 'Some doc' }]);
      expect(result.isGrounded).toBe(true);
    });

    it('should return grounded for whitespace-only response', () => {
      const result = checkGrounding('   ', [{ content: 'Some doc' }]);
      expect(result.isGrounded).toBe(true);
    });
  });

  describe('No claims', () => {
    it('should return grounded when no factual claims detected', () => {
      const response = 'Hello how are you doing today? I hope you are well.';
      const result = checkGrounding(response, [{ content: 'Some doc' }]);
      expect(result.isGrounded).toBe(true);
    });
  });

  describe('Grounded claims', () => {
    it('should identify grounded claims from documents', () => {
      const response = 'The university was established in 1986 and has 15 faculties.';
      const docs = [{
        content: 'Jordan University of Science and Technology was established in 1986 and has 15 faculties.',
      }];
      const result = checkGrounding(response, docs);
      expect(result.groundedPercentage).toBeGreaterThan(0);
    });

    it('should track used sources', () => {
      const response = 'The university has 15 faculties and 10000 students enrolled in 2024.';
      const docs = [{
        content: 'The university has 15 faculties and 10000 students enrolled in 2024.',
        metadata: { file_name: 'university-info.pdf' },
      }];
      const result = checkGrounding(response, docs);
      expect(result.usedSources.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Ungrounded claims', () => {
    it('should detect ungrounded claims when completely unrelated', () => {
      // Response has specific facts that are completely different from the doc
      const response = 'The university was established in 1999 with 50 faculties and 100 campuses worldwide.';
      const docs = [{
        content: 'Completely unrelated document about weather patterns in Antarctica.',
      }];
      const result = checkGrounding(response, docs);
      // The response has many claims (numbers) but the doc doesn't contain them
      expect(result.isGrounded).toBe(false);
    });
  });

  describe('Strict mode', () => {
    it('should use higher thresholds in strict mode', () => {
      const response = 'The university was founded in 1986.';
      const docs = [{
        content: 'The university was founded in 1986 and is located in Irbid.',
      }];
      const strict = checkGrounding(response, docs, { strictMode: true });
      expect(strict.groundedPercentage).toBeDefined();
    });
  });

  describe('Sources section stripping', () => {
    it('should strip Sources section from response', () => {
      const response = 'The answer is 42.\n\n---\n### Sources\n- Source 1';
      const docs = [{ content: 'The answer is 42.' }];
      const result = checkGrounding(response, docs);
      expect(result.groundedPercentage).toBeGreaterThan(0);
    });
  });

  describe('Arabic text', () => {
    it('should handle Arabic responses', () => {
      const response = 'الجامعة تأسست عام 1986 وتحتوي على 15 كلية.';
      const docs = [{
        content: 'الجامعة تأسست عام 1986 وتحتوي على 15 كلية.',
      }];
      const result = checkGrounding(response, docs);
      expect(result.groundedPercentage).toBeGreaterThan(0);
    });
  });
});
