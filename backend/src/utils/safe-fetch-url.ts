import dns from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

const ALLOWED_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_PROXY_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 10_000;

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

function hostnameLooksBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost')) return true;
  if (net.isIP(host) === 4) return isPrivateIpv4(host);
  if (net.isIP(host) === 6) return isPrivateIpv6(host);
  return false;
}

function hostAllowedByAllowlist(hostname: string): boolean {
  const raw = process.env.IMAGE_PROXY_ALLOWED_HOSTS || '';
  const allowed = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) {
    // Safe defaults for avatar CDNs used by the app
    return (
      hostname === 'ui-avatars.com' ||
      hostname.endsWith('.ui-avatars.com') ||
      hostname === 'api.dicebear.com' ||
      hostname.endsWith('.dicebear.com') ||
      hostname.endsWith('.supabase.co')
    );
  }
  return allowed.includes(hostname);
}

/**
 * Validates a URL before the image proxy fetches it (SSRF mitigation).
 * Returns the parsed URL and its validated primary resolved IP address.
 */
export async function assertSafeImageProxyUrl(
  rawUrl: string,
): Promise<{ safeUrl: URL; resolvedIp: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!ALLOWED_IMAGE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostnameLooksBlocked(hostname)) {
    throw new Error('Blocked hostname');
  }

  if (!hostAllowedByAllowlist(hostname)) {
    throw new Error('Hostname not allowed for image proxy');
  }

  const resolved = await dns.lookup(hostname, { all: true });
  if (resolved.length === 0) {
    throw new Error('Could not resolve hostname');
  }

  for (const entry of resolved) {
    if (hostnameLooksBlocked(entry.address)) {
      throw new Error('URL resolves to a blocked address');
    }
  }

  return { safeUrl: parsed, resolvedIp: resolved[0].address };
}

export async function fetchImageForProxy(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  let currentUrl = url;
  let attempts = 0;
  const maxRedirects = 3;

  while (attempts <= maxRedirects) {
    attempts++;
    // Re-validate and re-resolve DNS on EACH attempt (including redirects)
    // This prevents DNS rebinding where the IP changes between validation and fetch
    const { safeUrl, resolvedIp } = await assertSafeImageProxyUrl(currentUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      // Pin IP to prevent DNS Rebinding: replace hostname with IP in request URL if hostname is domain name
      const isIp = net.isIP(safeUrl.hostname) !== 0;
      const targetUrl = isIp
        ? safeUrl.toString()
        : `${safeUrl.protocol}//${net.isIP(resolvedIp) === 6 ? `[${resolvedIp}]` : resolvedIp}${safeUrl.port ? `:${safeUrl.port}` : ''}${safeUrl.pathname}${safeUrl.search}`;

      const headers: Record<string, string> = {
        Accept: 'image/*',
      };
      if (!isIp) {
        headers['Host'] = safeUrl.hostname;
      }

      const response = await fetch(targetUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers,
      });

      // Handle safe manual redirects by re-validating the target URL
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Redirect response missing Location header');
        }
        currentUrl = new URL(location, safeUrl).toString();
        // Loop continues - will re-resolve DNS and re-validate the redirect target
        continue;
      }

      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      // Raster formats only by default: SVG can carry scripts, and re-serving
      // it from our API origin turns the proxy into an XSS/origin-trust
      // vector. Hosts explicitly trusted for SVG may be allowlisted via env.
      const baseType = contentType.split(';')[0].trim().toLowerCase();
      const svgAllowedHosts = (process.env.IMAGE_PROXY_SVG_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      const isRaster = [
        'image/png', 'image/jpeg', 'image/gif', 'image/webp',
        'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon',
      ].includes(baseType);
      const isAllowedSvg =
        baseType === 'image/svg+xml' &&
        svgAllowedHosts.includes(safeUrl.hostname.toLowerCase());
      if (contentType && !isRaster && !isAllowedSvg) {
        throw new Error('Response is not an allowed image type');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_PROXY_BYTES) {
        throw new Error('Image too large');
      }

      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: contentType || 'image/png',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Too many redirects');
}
