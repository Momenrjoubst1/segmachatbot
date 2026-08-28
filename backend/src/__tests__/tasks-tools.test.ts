import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable Supabase query-builder mock; every chained call resolves to results[table].

type QueryResult = { data: unknown; error: { message: string } | null };

const { mockFrom, results, calls } = vi.hoisted(() => {
  const results: Record<string, { data: unknown; error: { message: string } | null }> = {};
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  const CHAIN_METHODS = [
    'insert', 'update', 'delete', 'upsert',
    'select', 'eq', 'neq', 'in', 'lt', 'lte', 'gt', 'gte',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ] as const;

  function makeChainable(table: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      obj[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return obj;
      });
    }
    obj.then = (resolve: (value: { data: unknown; error: { message: string } | null }) => void) =>
      Promise.resolve(results[table]).then(resolve);
    return obj;
  }

  const mockFrom = vi.fn((table: string) => makeChainable(table));
  return { mockFrom, results, calls };
});

vi.mock('../services/rag/rag-supabase-client.js', () => ({
  supabase: { from: mockFrom },
}));

// Import AFTER mocks are set up — these self-register into the tool registry.
import { getToolSchemas } from '../tools/tool-registry.js';
import { getToolsRequiringUserId } from '../tools/tool-metadata.js';
import '../tools/tasks/index.js';

const USER_ID = 'user-123';
const schemas = () => getToolSchemas();

beforeEach(() => {
  calls.length = 0;
  mockFrom.mockClear();
});

describe('task tools registration', () => {
  it('registers all five task tools', () => {
    for (const name of ['create_task', 'update_task', 'complete_task', 'delete_task', 'get_tasks']) {
      expect(schemas()[name], `${name} should be registered`).toBeDefined();
    }
  });

  it('marks every task tool as requiring a userId', () => {
    const needing = getToolsRequiringUserId();
    for (const name of ['create_task', 'update_task', 'complete_task', 'delete_task', 'get_tasks']) {
      expect(needing, `${name} must receive __userId`).toContain(name);
    }
  });

  it('marks every calendar tool as requiring a userId', async () => {
    // Force calendar tool modules to load so their metadata registers.
    await import('../tools/calendar/create-event/index.js');
    await import('../tools/calendar/query/index.js');
    await import('../tools/calendar/scheduler/find-optimal-time.js');
    await import('../tools/calendar/scheduler/email-to-meeting.js');

    const needing = getToolsRequiringUserId();
    for (const name of [
      'create_calendar_event',
      'get_upcoming_events',
      'find_free_slots',
      'get_calendar_insights',
      'delete_calendar_event',
      'update_calendar_event',
      'find_optimal_time',
      'email_to_meeting',
    ]) {
      expect(needing, `${name} must receive __userId`).toContain(name);
    }
  });
});

describe('create_task', () => {
  it('rejects unauthenticated calls', async () => {
    const res = JSON.parse(await schemas().create_task.execute({ title: 'x' }));
    expect(res.status).toBe('error');
    expect(res.message).toBe('User not authenticated');
  });

  it('creates a task scoped to the user', async () => {
    results['user_tasks'] = {
      data: { id: 't1', title: 'Homework', user_id: USER_ID },
      error: null,
    };
    const res = JSON.parse(
      await schemas().create_task.execute({ title: 'Homework', priority: 'high', __userId: USER_ID })
    );
    expect(res.status).toBe('success');
    expect(res.task.title).toBe('Homework');
    const insertCall = calls.find((c) => c.method === 'insert');
    expect(insertCall).toBeDefined();
    expect((insertCall!.args[0] as Record<string, unknown>).user_id).toBe(USER_ID);
  });

  it('rejects an invalid due_date', async () => {
    const res = JSON.parse(
      await schemas().create_task.execute({ title: 'x', due_date: 'not-a-date', __userId: USER_ID })
    );
    expect(res.status).toBe('error');
    expect(res.message).toMatch(/due_date/i);
  });
});

describe('get_tasks', () => {
  it('filters to open tasks by default', async () => {
    results['user_tasks'] = { data: [], error: null };
    const res = JSON.parse(await schemas().get_tasks.execute({ __userId: USER_ID }));
    expect(res.status).toBe('success');
    const inCall = calls.find((c) => c.method === 'in');
    expect(inCall).toBeDefined();
    expect(inCall!.args[0]).toBe('status');
    expect(inCall!.args[1]).toEqual(['pending', 'in_progress']);
  });

  it('includes completed tasks when requested', async () => {
    results['user_tasks'] = { data: [], error: null };
    await schemas().get_tasks.execute({ include_completed: true, __userId: USER_ID });
    const inCall = calls.find((c) => c.method === 'in');
    expect(inCall).toBeUndefined();
  });

  it('counts overdue open tasks', async () => {
    results['user_tasks'] = {
      data: [
        { id: 'a', due_date: '2000-01-01T00:00:00Z', status: 'pending' },
        { id: 'b', due_date: '2100-01-01T00:00:00Z', status: 'pending' },
        { id: 'c', due_date: '2000-01-01T00:00:00Z', status: 'completed' },
      ],
      error: null,
    };
    const res = JSON.parse(await schemas().get_tasks.execute({ include_completed: true, __userId: USER_ID }));
    expect(res.summary.overdue).toBe(1);
  });
});

describe('complete_task / update_task / delete_task', () => {
  it('completes a task with completed_at timestamp', async () => {
    results['user_tasks'] = { data: { id: 't1', title: 'Read', status: 'completed' }, error: null };
    const res = JSON.parse(
      await schemas().complete_task.execute({ task_id: 't1', __userId: USER_ID })
    );
    expect(res.status).toBe('success');
    const upd = calls.find((c) => c.method === 'update');
    expect((upd!.args[0] as Record<string, unknown>).status).toBe('completed');
    expect((upd!.args[0] as Record<string, unknown>).completed_at).toBeTruthy();
    // Ownership scoping: both eq filters applied
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args[0]);
    expect(eqs).toContain('id');
    expect(eqs).toContain('user_id');
  });

  it('reopening clears completed_at', async () => {
    results['user_tasks'] = { data: { id: 't1', status: 'in_progress' }, error: null };
    await schemas().complete_task.execute({ task_id: 't1', completed: false, __userId: USER_ID });
    const upd = calls.find((c) => c.method === 'update');
    expect((upd!.args[0] as Record<string, unknown>).status).toBe('in_progress');
    expect((upd!.args[0] as Record<string, unknown>).completed_at).toBeNull();
  });

  it('updates only provided fields plus updated_at', async () => {
    results['user_tasks'] = { data: { id: 't1', priority: 'urgent' }, error: null };
    const res = JSON.parse(
      await schemas().update_task.execute({ task_id: 't1', priority: 'urgent', __userId: USER_ID })
    );
    expect(res.status).toBe('success');
    const patch = calls.find((c) => c.method === 'update')!.args[0] as Record<string, unknown>;
    expect(patch.priority).toBe('urgent');
    expect(patch.updated_at).toBeTruthy();
    expect(patch.title).toBeUndefined();
  });

  it('reports failure when the task does not exist', async () => {
    results['user_tasks'] = { data: null, error: null };
    const res = JSON.parse(
      await schemas().delete_task.execute({ task_id: 'missing', __userId: USER_ID })
    );
    expect(res.status).toBe('error');
    expect(res.message).toMatch(/not found or not yours/i);
  });
});
