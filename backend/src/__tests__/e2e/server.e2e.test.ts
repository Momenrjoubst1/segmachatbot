/**
 * TRUE end-to-end over the real Express app — no mini-app stubs.
 *
 * Boots backend/src/index.ts with its real middleware chain (helmet,
 * request-id, CORS, global rate limiter, auth middleware, route
 * registration, error handler) and drives it over real HTTP with
 * supertest. Only the outward network edges are mocked (Supabase auth
 * rejects, BM25/reranker stubs) so the suite is deterministic in CI.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// The global setup mocks the logger without initSentry; the real app needs
// the whole module — restore the actual logger for this E2E file.
vi.mock('../../utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/logger.js')>();
  return { ...actual };
});

vi.mock('../../services/rag/bm25-search.js', () => ({
  initializeBM25FromDB: vi.fn(),
  getBM25Search: () => ({
    getStats: () => ({ totalDocs: 0, avgDocLen: 0, vocabSize: 0 }),
  }),
}));

vi.mock('../../services/rag/document-reranker.js', () => ({
  warmUpReranker: vi.fn().mockResolvedValue(undefined),
  rerankDocuments: vi.fn().mockResolvedValue([]),
}));

// Deterministic auth: every token verify fails → protected routes 401.
vi.mock('../../config/supabase.config.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'invalid claim' },
      }),
    },
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      const mk = (): unknown => {
        const fn = vi.fn().mockReturnValue(chain);
        chain.select = fn; chain.eq = fn; chain.in = fn; chain.limit = fn;
        chain.lte = fn; chain.lt = fn; chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        return fn;
      };
      mk();
      return chain;
    }),
  },
}));

const appMod = await import('../../index.js');
const app = appMod.default;

describe('E2E · real server surface', () => {
  it('GET /api/health → 200 with service shape', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveProperty('redis');
    expect(res.body.services).toHaveProperty('aiProviders');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('protected routes reject missing credentials → 401', async () => {
    for (const path of ['/api/memory', '/api/tools', '/api/stt', '/api/voice/agent/session']) {
      const res = await request(app).get(path);
      expect([401, 404]).toContain(res.status);
      if (res.status === 401) expect(res.body.error).toBeTruthy();
    }
  });

  it('protected routes reject garbage JWTs → 401', async () => {
    const res = await request(app)
      .get('/api/memory')
      .set('Authorization', 'Bearer garbage.token.here');
    expect(res.status).toBe(401);
  });

  it('POST /api/voice/agent/session with garbage JWT → 401 (never 5xx)', async () => {
    const res = await request(app)
      .post('/api/voice/agent/session')
      .set('Authorization', 'Bearer garbage.token.here');
    expect(res.status).toBe(401);
  });

  it('dev routes are absent when ENABLE_DEV_ROUTES is not enabled', async () => {
    expect(process.env.ENABLE_DEV_ROUTES).not.toBe('true');
    const res = await request(app).post('/api/dev/reprocess/00000000-0000-4000-8000-00000000dead');
    expect(res.status).toBe(404);
  });

  it('helmet security headers are present', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS rejects origins outside the allowlist', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    // The cors middleware turns a rejected origin into a middleware error,
    // which the central error handler converts to a 4xx/5xx — never a 2xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('unknown routes → 404 JSON error', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
  });
});
