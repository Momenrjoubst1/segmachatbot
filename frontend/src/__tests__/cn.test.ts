import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/imageProxy', () => ({
  proxyImage: vi.fn((url: string) => `proxied:${url}`),
}));

import { cn, getUserAvatarUrl } from '@/lib/cn';
import { proxyImage } from '@/utils/imageProxy';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('deduplicates tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('handles undefined and null', () => {
    expect(cn('foo', undefined, null)).toBe('foo');
  });
});

describe('getUserAvatarUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns avatarUrl directly when provided', () => {
    const result = getUserAvatarUrl('https://example.com/avatar.png');
    expect(result).toBe('https://example.com/avatar.png');
    expect(proxyImage).not.toHaveBeenCalled();
  });

  it('returns fallback URL when avatarUrl is empty string', () => {
    const result = getUserAvatarUrl('');
    expect(proxyImage).toHaveBeenCalled();
    expect(result).toContain('ui-avatars.com');
    expect(result).toContain('User');
  });

  it('returns fallback URL when avatarUrl is null', () => {
    const result = getUserAvatarUrl(null);
    expect(proxyImage).toHaveBeenCalled();
    expect(result).toContain('ui-avatars.com');
  });

  it('returns fallback URL when avatarUrl is whitespace only', () => {
    const result = getUserAvatarUrl('   ');
    expect(proxyImage).toHaveBeenCalled();
    expect(result).toContain('ui-avatars.com');
  });

  it('uses nameFallback for the avatar name', () => {
    const result = getUserAvatarUrl(null, 'John Doe');
    expect(result).toContain('John%20Doe');
  });

  it('defaults to "User" when nameFallback is empty', () => {
    const result = getUserAvatarUrl(null, '');
    expect(result).toContain('User');
  });

  it('defaults to "User" when nameFallback is null', () => {
    const result = getUserAvatarUrl(null, null);
    expect(result).toContain('User');
  });

  it('encodes special characters in name', () => {
    const result = getUserAvatarUrl(null, 'John & Jane');
    expect(result).toContain('John%20%26%20Jane');
  });

  it('passes size to the avatar URL', () => {
    const result = getUserAvatarUrl(null, 'Test', 200);
    expect(result).toContain('size=200');
  });

  it('defaults size to 150', () => {
    const result = getUserAvatarUrl(null, 'Test');
    expect(result).toContain('size=150');
  });
});
