/**
 * Proxies external images through our backend to bypass CORS issues
 */
export function proxyImage(url: string): string {
  // If it's already a local URL or data URL, return as-is
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) {
    return url;
  }

  // If it's from our Supabase storage, return as-is
  if (url.includes('supabase.co/storage')) {
    return url;
  }

  // If it's already proxied, return as-is (prevent double proxying)
  if (url.includes('/api/proxy/image')) {
    return url;
  }

  // For external URLs (ui-avatars.com, dicebear.com, etc.), proxy them
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3004';
  return `${backendUrl}/api/proxy/image?url=${encodeURIComponent(url)}`;
}
