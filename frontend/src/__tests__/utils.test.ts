import { describe, it, expect } from 'vitest';
import { cn, getUserAvatarUrl } from '../lib/cn.js';

describe('Utils', () => {
  describe('cn', () => {
    it('should merge class names', () => {
      const result = cn('text-red-500', 'text-blue-500');
      expect(result).toBe('text-blue-500');
    });

    it('should handle conditional classes', () => {
      const result = cn('base', true && 'active', false && 'inactive');
      expect(result).toContain('base');
      expect(result).toContain('active');
      expect(result).not.toContain('inactive');
    });

    it('should handle empty input', () => {
      const result = cn();
      expect(result).toBe('');
    });

    it('should handle undefined and null', () => {
      const result = cn(undefined, null, 'test');
      expect(result).toBe('test');
    });
  });

  describe('getUserAvatarUrl', () => {
    it('should return avatar URL if provided', () => {
      const result = getUserAvatarUrl('https://example.com/avatar.jpg');
      expect(result).toBe('https://example.com/avatar.jpg');
    });

    it('should generate avatar from name', () => {
      const result = getUserAvatarUrl(null, 'John Doe');
      expect(result).toContain('ui-avatars.com');
      expect(result).toContain('John');
    });

    it('should use default name if not provided', () => {
      const result = getUserAvatarUrl(null, null);
      expect(result).toContain('ui-avatars.com');
      expect(result).toContain('User');
    });

    it('should handle empty avatar URL', () => {
      const result = getUserAvatarUrl('  ', 'John');
      expect(result).toContain('ui-avatars.com');
    });

    it('should respect size parameter', () => {
      const result = getUserAvatarUrl(null, 'John', 200);
      // The URL is encoded, so we check for the decoded value
      expect(decodeURIComponent(result)).toContain('size=200');
    });
  });
});
