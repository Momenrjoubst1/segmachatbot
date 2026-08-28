import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal fake Supabase client, same shape as the one used by artifact-store.test.ts.
const sb = vi.hoisted(() => {
  type Row = Record<string, any>;
  const tables: Record<string, Row[]> = { artifacts: [], artifact_versions: [] };
  let seq = 0;

  function matches(row: Row, filters: Array<[string, any]>): boolean {
    return filters.every(([col, val]) => row[col] === val);
  }

  function makeQuery(name: string) {
    const rows = () => tables[name];
    const q: any = {};
    let filters: Array<[string, any]> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' | null = null;
    let payload: any = null;

    const materialize = (): Row[] => {
      if (op === 'insert') {
        const incoming: Row[] = Array.isArray(payload) ? payload : [payload];
        const stored: Row[] = [];
        for (const item of incoming) {
          const row = { version: 1, visibility: 'private', updated_at: new Date().toISOString(), id: `gen-${++seq}`, created_at: new Date().toISOString(), ...item };
          rows().push(row);
          stored.push({ ...row });
        }
        return stored;
      }
      if (op === 'update') {
        const updated: Row[] = [];
        for (const row of rows()) {
          if (matches(row, filters)) {
            Object.assign(row, payload);
            updated.push({ ...row });
          }
        }
        return updated;
      }
      if (op === 'delete') {
        const kept: Row[] = [];
        const removed: Row[] = [];
        for (const row of rows()) {
          if (matches(row, filters)) removed.push({ ...row });
          else kept.push(row);
        }
        tables[name] = kept;
        return removed;
      }
      return rows().filter((row) => matches(row, filters)).map((row) => ({ ...row }));
    };

    q.select = () => { if (!op) op = 'select'; return q; };
    q.insert = (row: Row) => { op = 'insert'; payload = row; return q; };
    q.update = (patch: Row) => { op = 'update'; payload = patch; return q; };
    q.delete = () => { op = 'delete'; return q; };
    q.eq = (col: string, val: any) => { filters.push([col, val]); return q; };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: materialize()[0] ?? null, error: null });
    q.single = async () => {
      const out = materialize();
      return out.length > 0 ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } };
    };
    q.then = (resolve: any, reject: any) => {
      try { resolve({ data: materialize(), error: null }); } catch (err) { reject(err); }
    };
    return q;
  }

  return { tables, reset: () => { tables.artifacts = []; tables.artifact_versions = []; }, from: (name: string) => makeQuery(name) };
});

vi.mock('../config/supabase.config.js', () => ({ supabase: sb }));
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Importing the tool modules registers them in the shared tool registry.
import '../tools/files/update-artifact/index.js';
import '../tools/files/create-artifact/index.js';
import { getToolSchemas } from '../tools/tool-registry.js';
import { applyReplacements } from '../tools/files/update-artifact/index.js';

const schemas = getToolSchemas();

beforeEach(() => sb.reset());

describe('applyReplacements', () => {
  it('replaces the first occurrence by default and all with replace_all', () => {
    expect(applyReplacements('aXbXc', [{ find: 'X', replace: '-' }]).content).toBe('a-bXc');
    expect(applyReplacements('aXbXc', [{ find: 'X', replace: '-', replace_all: true }]).content).toBe('a-b-c');
  });

  it('supports nth-occurrence targeting and rejects missing occurrences', () => {
    expect(applyReplacements('a1b1c1', [{ find: '1', replace: '2', occurrence: 3 }]).content).toBe('a1b1c2');
    expect(() => applyReplacements('a1b1c1', [{ find: '1', replace: '2', occurrence: 9 }])).toThrowError(/الحدوث رقم 9/);
  });

  it('throws a helpful error when the find text is missing', () => {
    expect(() => applyReplacements('hello', [{ find: 'nope', replace: 'x' }])).toThrowError(/لم يتم العثور/);
  });

  it('applies edits sequentially so later finds see earlier replaces', () => {
    const result = applyReplacements('<h1>Old</h1>', [
      { find: '<h1>Old</h1>', replace: '<h1>New</h1>' },
      { find: 'New', replace: 'Newer' },
    ]);
    expect(result.content).toBe('<h1>Newer</h1>');
    expect(result.applied).toBe(2);
  });
});

describe('create_artifact tool', () => {
  it('persists an artifact for the calling user and returns its id', async () => {
    const result = JSON.parse(
      await schemas.create_artifact.execute({
        type: 'html',
        title: 'Landing',
        content: '<p>hi</p>',
        __userId: 'u1',
        __threadId: 't1',
      }) as string,
    );
    expect(result.status).toBe('success');
    expect(sb.tables.artifacts[0].owner_id).toBe('u1');
    expect(sb.tables.artifacts[0].thread_id).toBe('t1');
    expect(sb.tables.artifacts[0].type).toBe('html');
    expect(typeof result.artifact_id).toBe('string');
  });

  it('refuses to run without a user', async () => {
    const result = JSON.parse(
      await schemas.create_artifact.execute({ type: 'html', title: 'x', content: 'y' }) as string,
    );
    expect(result.status).toBe('error');
    expect(sb.tables.artifacts).toHaveLength(0);
  });

  it('serializes IDE project files into the content payload', async () => {
    const result = JSON.parse(
      await schemas.create_artifact.execute({
        type: 'ide',
        title: 'My Project',
        content: '',
        projectFiles: [{ name: 'main.py', type: 'file', path: '/main.py', content: 'print(1)' }],
        __userId: 'u1',
      }) as string,
    );
    expect(result.status).toBe('success');
    const stored = JSON.parse(sb.tables.artifacts[0].content);
    expect(stored.projectName).toBe('My Project');
    expect(stored.files[0].name).toBe('main.py');
  });
});

describe('update_artifact tool', () => {
  async function seed(content: string) {
    const created = JSON.parse(
      await schemas.create_artifact.execute({ type: 'html', title: 'Page', content, __userId: 'u1' }) as string,
    );
    return created.artifact_id as string;
  }

  it('applies targeted replacements and bumps the version', async () => {
    const id = await seed('<p>alpha beta</p>');
    const result = JSON.parse(
      await schemas.update_artifact.execute({
        artifact_id: id,
        find_replace: [{ find: 'beta', replace: 'omega' }],
        change_summary: 'swap word',
        __userId: 'u1',
      }) as string,
    );
    expect(result.status).toBe('success');
    expect(result.version).toBe(2);
    expect(result.replacements_applied).toBe(1);
    expect(sb.tables.artifacts[0].content).toBe('<p>alpha omega</p>');
    // history: v1 + v2 snapshots exist
    expect(sb.tables.artifact_versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it('reports a missing find string without corrupting the artifact', async () => {
    const id = await seed('<p>keep me</p>');
    const result = JSON.parse(
      await schemas.update_artifact.execute({
        artifact_id: id,
        find_replace: [{ find: 'ghost-text', replace: 'x' }],
        __userId: 'u1',
      }) as string,
    );
    expect(result.status).toBe('error');
    expect(result.message).toContain('ghost-text');
    expect(sb.tables.artifacts[0].version).toBe(1);
    expect(sb.tables.artifacts[0].content).toBe('<p>keep me</p>');
  });

  it('rejects no-op updates and unknown artifacts', async () => {
    const noop = JSON.parse(
      await schemas.update_artifact.execute({ artifact_id: 'whatever', __userId: 'u1' }) as string,
    );
    expect(noop.status).toBe('error');

    const missing = JSON.parse(
      await schemas.update_artifact.execute({ artifact_id: 'missing-id', title: 'x', __userId: 'u1' }) as string,
    );
    expect(missing.status).toBe('error');

    const unauthorized = JSON.parse(
      await schemas.update_artifact.execute({ artifact_id: 'missing-id', title: 'x' }) as string,
    );
    expect(unauthorized.status).toBe('error');
  });
});
