import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../config/redis/client.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
  },
}));

vi.mock('../services/supabase.service.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }),
    },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

import { assertSafeImageProxyUrl } from '../utils/safe-fetch-url.js';

describe('Proxy SSRF Protection', () => {
  it('should block localhost URLs', async () => {
    await expect(assertSafeImageProxyUrl('http://localhost:3004/api/health'))
      .rejects.toThrow('Blocked hostname');
  });

  it('should block 127.0.0.1', async () => {
    await expect(assertSafeImageProxyUrl('http://127.0.0.1:3004/api/health'))
      .rejects.toThrow('Blocked hostname');
  });

  it('should block private IP ranges', async () => {
    await expect(assertSafeImageProxyUrl('http://192.168.1.1/image.png'))
      .rejects.toThrow('Blocked hostname');
  });

  it('should block non-http protocols', async () => {
    await expect(assertSafeImageProxyUrl('file:///etc/passwd'))
      .rejects.toThrow('Only http and https URLs are allowed');
  });

  it('should block URLs with credentials', async () => {
    await expect(assertSafeImageProxyUrl('http://user:pass@example.com/img.png'))
      .rejects.toThrow('URLs with credentials are not allowed');
  });

  it('should block URLs not in allowlist', async () => {
    await expect(assertSafeImageProxyUrl('http://evil.com/steal.png'))
      .rejects.toThrow('Hostname not allowed');
  });
});
