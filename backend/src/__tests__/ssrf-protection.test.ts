import { describe, it, expect, vi, beforeEach } from 'vitest';
import dns from 'dns/promises';

vi.mock('dns/promises', () => {
  const original = vi.importActual<typeof import('dns/promises')>('dns/promises');
  return {
    default: {
      ...(original as any).default,
      lookup: vi.fn(),
    },
  };
});

import { assertSafeImageProxyUrl, fetchImageForProxy } from '../utils/safe-fetch-url.js';

const mockLookup = vi.mocked(dns.lookup);

describe('SSRF Protection (safe-fetch-url)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.IMAGE_PROXY_ALLOWED_HOSTS = '';
  });

  describe('assertSafeImageProxyUrl', () => {
    describe('URL validation', () => {
      it('should reject invalid URLs', async () => {
        await expect(assertSafeImageProxyUrl('not-a-url')).rejects.toThrow('Invalid URL');
      });

      it('should reject non-http/https protocols', async () => {
        await expect(assertSafeImageProxyUrl('ftp://example.com/img.png')).rejects.toThrow(
          'Only http and https URLs are allowed',
        );
        await expect(assertSafeImageProxyUrl('file:///etc/passwd')).rejects.toThrow(
          'Only http and https URLs are allowed',
        );
      });

      it('should reject URLs with credentials', async () => {
        await expect(
          assertSafeImageProxyUrl('https://user:pass@example.com/img.png'),
        ).rejects.toThrow('URLs with credentials are not allowed');
      });
    });

    describe('Blocked hostnames', () => {
      it('should block localhost', async () => {
        await expect(assertSafeImageProxyUrl('http://localhost/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });

      it('should block 127.0.0.1', async () => {
        await expect(assertSafeImageProxyUrl('http://127.0.0.1/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });

      it('should block 0.0.0.0', async () => {
        await expect(assertSafeImageProxyUrl('http://0.0.0.0/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });

      it('should block ::1 (IPv6 loopback)', async () => {
        await expect(assertSafeImageProxyUrl('http://[::1]/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });

      it('should block *.localhost subdomains', async () => {
        await expect(
          assertSafeImageProxyUrl('http://evil.localhost/img.png'),
        ).rejects.toThrow('Blocked hostname');
      });

      it('should block private IPv4 ranges (10.x)', async () => {
        await expect(assertSafeImageProxyUrl('http://10.0.0.1/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });

      it('should block private IPv4 ranges (172.16-31.x)', async () => {
        await expect(assertSafeImageProxyUrl('http://172.16.0.1/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });

      it('should block private IPv4 ranges (192.168.x)', async () => {
        await expect(assertSafeImageProxyUrl('http://192.168.1.1/img.png')).rejects.toThrow(
          'Blocked hostname',
        );
      });
    });

    describe('Allowlist', () => {
      it('should allow default safe hosts (ui-avatars.com)', async () => {
        mockLookup.mockResolvedValue([{ address: '104.21.10.1', family: 4 }] as any);

        const result = await assertSafeImageProxyUrl(
          'https://ui-avatars.com/api/?name=test',
        );
        expect(result.safeUrl.hostname).toBe('ui-avatars.com');
      });

      it('should allow default safe hosts (dicebear.com)', async () => {
        mockLookup.mockResolvedValue([{ address: '104.21.10.2', family: 4 }] as any);

        const result = await assertSafeImageProxyUrl(
          'https://api.dicebear.com/7.x/avataaars/svg?seed=test',
        );
        expect(result.safeUrl.hostname).toBe('api.dicebear.com');
      });

      it('should allow supabase.co subdomains', async () => {
        mockLookup.mockResolvedValue([{ address: '104.21.10.3', family: 4 }] as any);

        const result = await assertSafeImageProxyUrl(
          'https://abc123.supabase.co/storage/v1/object/public/avatar.png',
        );
        expect(result.safeUrl.hostname).toContain('supabase.co');
      });

      it('should block non-allowlisted hosts', async () => {
        await expect(
          assertSafeImageProxyUrl('https://evil-site.com/steal.png'),
        ).rejects.toThrow('Hostname not allowed for image proxy');
      });

      it('should respect custom IMAGE_PROXY_ALLOWED_HOSTS', async () => {
        process.env.IMAGE_PROXY_ALLOWED_HOSTS = 'custom-cdn.com,images.example.org';
        mockLookup.mockResolvedValue([{ address: '104.21.10.4', family: 4 }] as any);

        const result = await assertSafeImageProxyUrl(
          'https://custom-cdn.com/image.png',
        );
        expect(result.safeUrl.hostname).toBe('custom-cdn.com');
      });
    });

    describe('DNS resolution & IP pinning', () => {
      it('should reject when hostname cannot be resolved', async () => {
        mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

        await expect(
          assertSafeImageProxyUrl('https://ui-avatars.com/img.png'),
        ).rejects.toThrow();
      });

      it('should reject when DNS resolves to blocked address', async () => {
        mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);

        await expect(
          assertSafeImageProxyUrl('https://ui-avatars.com/img.png'),
        ).rejects.toThrow('URL resolves to a blocked address');
      });

      it('should reject when any DNS entry resolves to blocked address', async () => {
        mockLookup.mockResolvedValue([
          { address: '104.21.10.1', family: 4 },
          { address: '192.168.1.100', family: 4 },
        ] as any);

        await expect(
          assertSafeImageProxyUrl('https://ui-avatars.com/img.png'),
        ).rejects.toThrow('URL resolves to a blocked address');
      });

      it('should block DNS rebinding via resolved private IPs', async () => {
        mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as any);

        await expect(
          assertSafeImageProxyUrl('https://ui-avatars.com/img.png'),
        ).rejects.toThrow('URL resolves to a blocked address');
      });

      it('should return resolved IP for successful validation', async () => {
        mockLookup.mockResolvedValue([{ address: '104.21.10.1', family: 4 }] as any);

        const result = await assertSafeImageProxyUrl(
          'https://ui-avatars.com/api/?name=test',
        );
        expect(result.resolvedIp).toBe('104.21.10.1');
      });
    });
  });

  describe('fetchImageForProxy', () => {
    it('should throw on invalid URL', async () => {
      await expect(fetchImageForProxy('not-a-url')).rejects.toThrow();
    });

    it('should enforce redirect limit', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      // Simulate infinite redirects
      fetchSpy.mockResolvedValue({
        status: 302,
        headers: new Headers({ location: 'https://ui-avatars.com/redirect1' }),
      } as Response);

      await expect(fetchImageForProxy('https://ui-avatars.com/loop')).rejects.toThrow(
        'Too many redirects',
      );

      fetchSpy.mockRestore();
    });
  });
});
