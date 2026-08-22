import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { assertSafeImageProxyUrl } from '../utils/safe-fetch-url.js';
import dns from 'dns/promises';

vi.mock('dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

const mockLookup = vi.mocked(dns.lookup);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.IMAGE_PROXY_ALLOWED_HOSTS = '';
});

afterEach(() => {
  delete process.env.IMAGE_PROXY_ALLOWED_HOSTS;
});

describe('assertSafeImageProxyUrl', () => {
  it('rejects invalid URLs', async () => {
    await expect(assertSafeImageProxyUrl('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('rejects non-http protocols', async () => {
    await expect(assertSafeImageProxyUrl('ftp://example.com/image.png')).rejects.toThrow(
      'Only http and https URLs are allowed',
    );
    await expect(assertSafeImageProxyUrl('file:///etc/passwd')).rejects.toThrow(
      'Only http and https URLs are allowed',
    );
  });

  it('rejects URLs with credentials', async () => {
    await expect(
      assertSafeImageProxyUrl('https://user:pass@example.com/img.png'),
    ).rejects.toThrow('URLs with credentials are not allowed');
  });

  it('rejects localhost', async () => {
    await expect(assertSafeImageProxyUrl('http://localhost/img.png')).rejects.toThrow(
      'Blocked hostname',
    );
  });

  it('rejects 127.0.0.1', async () => {
    await expect(assertSafeImageProxyUrl('http://127.0.0.1/img.png')).rejects.toThrow(
      'Blocked hostname',
    );
  });

  it('rejects 0.0.0.0', async () => {
    await expect(assertSafeImageProxyUrl('http://0.0.0.0/img.png')).rejects.toThrow(
      'Blocked hostname',
    );
  });

  it('rejects hostname not in allowlist', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    await expect(
      assertSafeImageProxyUrl('https://evil.com/steal.png'),
    ).rejects.toThrow('Hostname not allowed for image proxy');
  });

  it('allows ui-avatars.com by default', async () => {
    mockLookup.mockResolvedValue([{ address: '104.21.0.0', family: 4 }] as any);
    const result = await assertSafeImageProxyUrl('https://ui-avatars.com/api/?name=test');
    expect(result.safeUrl.hostname).toBe('ui-avatars.com');
  });

  it('allows api.dicebear.com by default', async () => {
    mockLookup.mockResolvedValue([{ address: '104.21.0.1', family: 4 }] as any);
    const result = await assertSafeImageProxyUrl('https://api.dicebear.com/7.x/avataaars/svg');
    expect(result.safeUrl.hostname).toBe('api.dicebear.com');
  });

  it('allows *.supabase.co by default', async () => {
    mockLookup.mockResolvedValue([{ address: '104.21.0.2', family: 4 }] as any);
    const result = await assertSafeImageProxyUrl('https://xyzproject.supabase.co/storage/v1/object/public/avatar.png');
    expect(result.safeUrl.hostname).toContain('supabase.co');
  });

  it('allows custom allowed hosts via env', async () => {
    process.env.IMAGE_PROXY_ALLOWED_HOSTS = 'custom-cdn.example.com';
    mockLookup.mockResolvedValue([{ address: '104.21.0.3', family: 4 }] as any);
    const result = await assertSafeImageProxyUrl('https://custom-cdn.example.com/img.png');
    expect(result.safeUrl.hostname).toBe('custom-cdn.example.com');
  });

  it('rejects URLs resolving to private IPs', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }] as any);
    process.env.IMAGE_PROXY_ALLOWED_HOSTS = 'internal.test';
    await expect(
      assertSafeImageProxyUrl('https://internal.test/img.png'),
    ).rejects.toThrow('URL resolves to a blocked address');
  });

  it('rejects URLs resolving to 10.x.x.x', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as any);
    process.env.IMAGE_PROXY_ALLOWED_HOSTS = 'internal.test';
    await expect(
      assertSafeImageProxyUrl('https://internal.test/img.png'),
    ).rejects.toThrow('URL resolves to a blocked address');
  });

  it('rejects 169.254.x.x (link-local)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.1.1', family: 4 }] as any);
    process.env.IMAGE_PROXY_ALLOWED_HOSTS = 'internal.test';
    await expect(
      assertSafeImageProxyUrl('https://internal.test/img.png'),
    ).rejects.toThrow('URL resolves to a blocked address');
  });

  it('returns resolvedIp for valid URLs', async () => {
    mockLookup.mockResolvedValue([{ address: '104.21.42.1', family: 4 }] as any);
    const result = await assertSafeImageProxyUrl('https://ui-avatars.com/api/?name=test');
    expect(result.resolvedIp).toBe('104.21.42.1');
  });

  it('rejects when DNS resolution returns empty', async () => {
    mockLookup.mockResolvedValue([] as any);
    await expect(
      assertSafeImageProxyUrl('https://ui-avatars.com/api/?name=test'),
    ).rejects.toThrow('Could not resolve hostname');
  });
});
