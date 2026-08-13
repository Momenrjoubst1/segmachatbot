import { describe, it, expect } from 'vitest';
import { proxyImage } from '../utils/imageProxy.js';

describe('Image Proxy', () => {
  it('should proxy external URLs', () => {
    const result = proxyImage('https://example.com/image.jpg');
    expect(result).toContain('/api/proxy/image');
    expect(result).toContain(encodeURIComponent('https://example.com/image.jpg'));
  });

  it('should not proxy data URLs', () => {
    const dataUrl = 'data:image/png;base64,abc123';
    const result = proxyImage(dataUrl);
    expect(result).toBe(dataUrl);
  });

  it('should not proxy blob URLs', () => {
    const blobUrl = 'blob:http://localhost:3000/abc123';
    const result = proxyImage(blobUrl);
    expect(result).toBe(blobUrl);
  });

  it('should not proxy local URLs', () => {
    const localUrl = '/icons/test.svg';
    const result = proxyImage(localUrl);
    expect(result).toBe(localUrl);
  });

  it('should not proxy Supabase storage URLs', () => {
    const supabaseUrl = 'https://example.supabase.co/storage/v1/object/public/test.jpg';
    const result = proxyImage(supabaseUrl);
    expect(result).toBe(supabaseUrl);
  });

  it('should not proxy already proxied URLs', () => {
    const proxiedUrl = 'http://localhost:3004/api/proxy/image?url=test';
    const result = proxyImage(proxiedUrl);
    expect(result).toBe(proxiedUrl);
  });

  it('should handle empty URL', () => {
    const result = proxyImage('');
    expect(result).toBe('');
  });

  it('should handle undefined URL', () => {
    const result = proxyImage(undefined as any);
    expect(result).toBeUndefined();
  });

  it('should not proxy ui-avatars.com URLs (public CDN)', () => {
    const url = 'https://ui-avatars.com/api/?name=Test&size=30';
    const result = proxyImage(url);
    expect(result).toBe(url);
    expect(result).not.toContain('/api/proxy/image');
  });

  it('should not proxy dicebear.com URLs (public CDN)', () => {
    const url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=test';
    const result = proxyImage(url);
    expect(result).toBe(url);
    expect(result).not.toContain('/api/proxy/image');
  });
});
