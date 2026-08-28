import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.RATE_LIMIT_STORE = 'memory';

// Chainable fake Supabase: selects resolve by table+columns, writes record into state arrays.
const sb = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    messageRow: null as Row | null, // chat_messages select incl. session_id (ownership fetch)
    prompt: null as Row | null,     // chat_messages select of content only (preceding user msg)
    existing: null as Row | null,   // message_feedback select (current rating)
    writeError: null as { message: string } | null,
    inserts: [] as { table: string; row: Row }[],
    updates: [] as { table: string; patch: Row }[],
    deletes: [] as { table: string }[],
  };

  function makeTable(name: string) {
    const q: any = {};
    q.select = (cols: string) => { q.__cols = cols; return q; };
    q.eq = () => q;
    q.lt = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => {
      if (name === 'chat_messages') {
        if (q.__cols?.includes('session_id')) return { data: state.messageRow, error: null };
        return { data: state.prompt, error: null };
      }
      if (name === 'message_feedback') return { data: state.existing, error: null };
      return { data: null, error: null };
    };
    q.insert = (row: Row) => { state.inserts.push({ table: name, row }); q.__op = 'insert'; return q; };
    q.update = (patch: Row) => { q.__patch = patch; q.__op = 'update'; return q; };
    q.delete = () => { q.__op = 'delete'; return q; };
    // Write ops are awaited directly (PostgrestBuilder is thenable).
    q.then = (resolve: any, reject: any) => {
      try {
        if (q.__op === 'update') state.updates.push({ table: name, patch: q.__patch });
        else if (q.__op === 'delete') state.deletes.push({ table: name });
        resolve(state.writeError ? { data: null, error: state.writeError } : { data: null, error: null });
      } catch (err) {
        reject(err);
      }
    };
    return q;
  }

  return { state, from: (name: string) => makeTable(name) };
});

vi.mock('../config/supabase.config.js', () => ({ supabase: sb }));

vi.mock('../utils/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import feedbackRoutes from '../routes/feedback.routes.js';

const app = express();
app.use(express.json());
app.use((req: any, _res: any, next: any) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    req.user = { id: auth.slice(7), email: 'u@t.dev' }; // token IS the user id
  }
  next();
});
app.use('/api/feedback', feedbackRoutes);

const post = (body: any, token = 'u1') =>
  request(app).post('/api/feedback/message').set('Authorization', `Bearer ${token}`).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  sb.state.messageRow = {
    id: '11111111-1111-1111-1111-111111111111',
    session_id: '22222222-2222-2222-2222-222222222222',
    content: 'answer text',
    model: 'gpt-x',
    created_at: '2026-08-22T10:00:00Z',
  };
  sb.state.prompt = { content: 'the question' };
  sb.state.existing = null;
  sb.state.writeError = null;
  sb.state.inserts = [];
  sb.state.updates = [];
  sb.state.deletes = [];
});

describe('POST /api/feedback/message', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/feedback/message')
      .send({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: true });
    expect(res.status).toBe(401);
    expect(sb.state.inserts).toHaveLength(0);
  });

  it('rejects an invalid payload with 400', async () => {
    const res = await post({ messageId: 'not-a-uuid', isPositive: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  it('rejects a missing isPositive with 400', async () => {
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown reason category with 400', async () => {
    const res = await post({
      messageId: '11111111-1111-1111-1111-111111111111',
      isPositive: false,
      reasonCategory: 'vibes',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the message does not exist or is not owned', async () => {
    sb.state.messageRow = null; // covers not-found AND the role='assistant'/ownership filters
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: true });
    expect(res.status).toBe(404);
    expect(sb.state.inserts).toHaveLength(0);
  });

  it('creates a like with server-side snapshots and syncs the legacy column', async () => {
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: true });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('created');
    expect(res.body.feedback).toBe(1);

    expect(sb.state.inserts).toHaveLength(1);
    const { table, row } = sb.state.inserts[0];
    expect(table).toBe('message_feedback');
    expect(row).toMatchObject({
      conversation_id: '22222222-2222-2222-2222-222222222222',
      message_id: '11111111-1111-1111-1111-111111111111',
      user_id: 'u1',
      feedback_type: 'like',
      reason_category: null, // likes never carry dislike metadata
      comment: null,
      prompt_snapshot: 'the question',
      response_snapshot: 'answer text',
      model_version: 'gpt-x',
    });

    const legacySync = sb.state.updates.find((u) => u.table === 'chat_messages');
    expect(legacySync?.patch).toEqual({ feedback: 1 });
    expect(sb.state.deletes).toHaveLength(0);
  });

  it('creates a dislike with reason/comment and feeds the retrieval-miss loop', async () => {
    const res = await post({
      messageId: '11111111-1111-1111-1111-111111111111',
      isPositive: false,
      reasonCategory: 'inaccurate',
      comment: 'wrong formula',
    });

    expect(res.status).toBe(200);
    expect(res.body.feedback).toBe(-1);

    const { row } = sb.state.inserts.find((i) => i.table === 'message_feedback')!;
    expect(row.feedback_type).toBe('dislike');
    expect(row.reason_category).toBe('inaccurate');
    expect(row.comment).toBe('wrong formula');

    const ragMiss = sb.state.inserts.find((i) => i.table === 'retrieval_feedback');
    expect(ragMiss).toBeDefined();
    expect(ragMiss!.row.query_text).toBe('the question');
    expect(ragMiss!.row.user_satisfied).toBe(false);
  });

  it('skips the retrieval-miss loop when there is no preceding user message', async () => {
    sb.state.prompt = null;
    const res = await post({
      messageId: '11111111-1111-1111-1111-111111111111',
      isPositive: false,
      reasonCategory: 'other',
    });

    expect(res.status).toBe(200);
    expect(sb.state.inserts.some((i) => i.table === 'retrieval_feedback')).toBe(false);
  });

  it('removes the rating when the same type is re-submitted (toggle off)', async () => {
    sb.state.existing = { id: 'f1', feedback_type: 'like' };
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: true });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('removed');
    expect(res.body.feedback).toBeNull();
    expect(sb.state.deletes.some((d) => d.table === 'message_feedback')).toBe(true);
    expect(sb.state.inserts).toHaveLength(0);

    const legacySync = sb.state.updates.find((u) => u.table === 'chat_messages');
    expect(legacySync?.patch).toEqual({ feedback: null });
  });

  it('does not log a RAG miss when toggling a dislike off', async () => {
    sb.state.existing = { id: 'f1', feedback_type: 'dislike' };
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: false });

    expect(res.body.action).toBe('removed');
    expect(sb.state.inserts.some((i) => i.table === 'retrieval_feedback')).toBe(false);
  });

  it('updates the row when the rating switches type', async () => {
    sb.state.existing = { id: 'f1', feedback_type: 'like' };
    const res = await post({
      messageId: '11111111-1111-1111-1111-111111111111',
      isPositive: false,
      reasonCategory: 'off_topic',
    });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('updated');

    const update = sb.state.updates.find((u) => u.table === 'message_feedback');
    expect(update).toBeDefined();
    expect(update!.patch.feedback_type).toBe('dislike');
    expect(update!.patch.reason_category).toBe('off_topic');
    expect(update!.patch.updated_at).toBeDefined();

    const legacySync = sb.state.updates.find((u) => u.table === 'chat_messages');
    expect(legacySync?.patch).toEqual({ feedback: -1 });
    expect(sb.state.deletes).toHaveLength(0);
  });

  it('falls back to unknown model_version when the message has no model', async () => {
    sb.state.messageRow = { ...sb.state.messageRow!, model: null };
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: true });
    expect(res.status).toBe(200);
    expect(sb.state.inserts[0].row.model_version).toBe('unknown');
  });

  it('returns 500 with a clean error when the save fails', async () => {
    sb.state.writeError = { message: 'db down' };
    const res = await post({ messageId: '11111111-1111-1111-1111-111111111111', isPositive: true });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to save feedback');
  });

  it('rate-limits a user after repeated submissions', async () => {
    let hit429 = false;
    for (let i = 0; i < 40; i++) {
      const res = await post(
        { messageId: '11111111-1111-1111-1111-111111111111', isPositive: true },
        'spam-user',
      );
      if (res.status === 429) {
        hit429 = true;
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(hit429).toBe(true);
  });
});
