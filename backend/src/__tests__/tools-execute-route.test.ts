import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

// Mock the sandbox executor so tests never hit the network
const { mockExecuteCode } = vi.hoisted(() => ({ mockExecuteCode: vi.fn() }));
vi.mock('../tools/code/executor/wandbox-code-executor.js', () => ({
  executeCode: (...args: any[]) => mockExecuteCode(...args),
}));

// Mock logger (used by the route for error logging)
vi.mock('../utils/logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import toolsRoutes from '../routes/tools.routes.js';

// Minimal auth middleware stub that mirrors the real contract:
// it attaches req.user when a Bearer token is present.
const app = express();
app.use(express.json());
app.use((req: any, _res: any, next: any) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    req.user = { id: 'user-1', email: 'u@t.dev' };
  }
  next();
});
app.use('/api/tools', toolsRoutes);

describe('POST /api/tools/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .send({ code: 'print(1)', language: 'python' });
    expect(res.status).toBe(401);
    expect(mockExecuteCode).not.toHaveBeenCalled();
  });

  it('rejects an empty code payload with 400', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', 'Bearer test')
      .send({ code: '', language: 'python' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  it('rejects a missing language with 400', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', 'Bearer test')
      .send({ code: 'print(1)' });
    expect(res.status).toBe(400);
  });

  it('rejects oversized payloads with 400', async () => {
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', 'Bearer test')
      .send({ code: 'a'.repeat(50_001), language: 'python' });
    expect(res.status).toBe(400);
  });

  it('executes code and returns the executor result', async () => {
    mockExecuteCode.mockResolvedValue({
      status: 'success',
      output: '1',
      language: 'python',
    });
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', 'Bearer test')
      .send({ code: 'print(1)', language: 'python' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.output).toBe('1');
    expect(mockExecuteCode).toHaveBeenCalledWith('print(1)', 'python', '', 'user-1');
  });

  it('returns 500 with a clean error when the executor throws', async () => {
    mockExecuteCode.mockRejectedValue(new Error('sandbox down'));
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', 'Bearer test')
      .send({ code: 'print(1)', language: 'python' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Code execution failed. Please try again.');
  });

  it('rate-limits after 10 requests from the same user', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/tools/execute')
        .set('Authorization', 'Bearer test')
        .send({ code: `print(${i})`, language: 'python' });
    }
    const res = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', 'Bearer test')
      .send({ code: 'print(11)', language: 'python' });
    expect(res.status).toBe(429);
  });
});
