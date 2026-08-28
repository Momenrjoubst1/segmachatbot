const nodeEnv = process.env.NODE_ENV || 'development';

const frontendOrigins = (
  process.env.FRONTEND_URL || (nodeEnv === 'development' ? 'http://localhost:5173' : '')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (frontendOrigins.includes('*')) {
  throw new Error('[Config] FRONTEND_URL must contain explicit origins; "*" cannot be used with credentialed CORS.');
}

if (nodeEnv === 'production' && frontendOrigins.length === 0) {
  throw new Error(
    '[Config] FRONTEND_URL is required in production. Set a comma-separated list of allowed origins.',
  );
}

/** Dev-only extra origins (e.g. Vite on another port). Comma-separated. */
const devExtraOrigins = (process.env.DEV_CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const appConfig = {
  port: Number(process.env.PORT) || 3004,
  frontendOrigins,
  devExtraOrigins,
  bodyLimit: '10mb',
  nodeEnv,
  // Trust N reverse-proxy hops for X-Forwarded-* headers (TRUST_PROXY_HOPS env).
  trustProxyHops: process.env.TRUST_PROXY_HOPS != null
    ? Number(process.env.TRUST_PROXY_HOPS)
    : 0,
} as const;

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  // Same-origin / server-to-server requests (no Origin header)
  if (!origin) return true;

  if (appConfig.nodeEnv === 'production' && origin === 'null') return false;

  if (appConfig.nodeEnv === 'development') {
    if (appConfig.frontendOrigins.includes(origin)) return true;
    if (appConfig.devExtraOrigins.includes(origin)) return true;
    // Allow localhost on any port during local development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    return false;
  }

  return appConfig.frontendOrigins.includes(origin);
}
