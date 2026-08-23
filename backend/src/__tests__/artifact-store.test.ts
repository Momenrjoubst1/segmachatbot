import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fake Supabase ────────────────────────────────────────────────────────────
// Minimal in-memory PostgREST-ish client covering the query shapes the
// artifact store uses: select/eq/order/limit/range chains, maybeSingle/single,
// insert/update/delete (thenable), including insert→select→single.
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
    let orderBy: string | null = null;
    let ascending = true;
    let limitN: number | null = null;
    let rangeStart: number | null = null;

    const materialize = (): Row[] => {
      if (op === 'insert') {
        const incoming: Row[] = Array.isArray(payload) ? payload : [payload];
        const stored: Row[] = [];
        for (const item of incoming) {
          // Emulate NOT NULL DEFAULT columns from migration 032.
          const row = {
            version: 1,
            visibility: 'private',
            updated_at: new Date().toISOString(),
            id: `gen-${++seq}`,
            created_at: new Date().toISOString(),
            ...item,
          };
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
            updated.push(row);
          }
        }
        return [...updated];
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
      let out = rows().filter((row) => matches(row, filters));
      if (orderBy) {
        out.sort((a, b) => {
          const av = a[orderBy!];
          const bv = b[orderBy!];
          const cmp = av === bv ? 0 : av > bv ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if (rangeStart !== null) out = out.slice(rangeStart, rangeStart + (limitN ?? Infinity));
      else if (limitN !== null) out = out.slice(0, limitN);
      return out.map((row) => ({ ...row }));
    };

    q.select = (cols = '*') => { void cols; if (!op) op = 'select'; return q; };
    q.insert = (row: Row) => { op = 'insert'; payload = row; return q; };
    q.update = (patch: Row) => { op = 'update'; payload = patch; return q; };
    q.delete = () => { op = 'delete'; return q; };
    q.eq = (col: string, val: any) => { filters.push([col, val]); return q; };
    q.order = (col: string, opts?: { ascending?: boolean }) => { orderBy = col; ascending = opts?.ascending ?? true; return q; };
    q.limit = (n: number) => { limitN = n; return q; };
    q.range = (start: number, end: number) => { rangeStart = start; limitN = end - start + 1; return q; };
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
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  createArtifact,
  getArtifact,
  listArtifacts,
  updateArtifact,
  deleteArtifact,
  revertToVersion,
  setVisibility,
  remixArtifact,
  listVersions,
  ArtifactStoreError,
} from '../tools/files/create-artifact/artifact-store.js';

beforeEach(() => sb.reset());

describe('artifact store', () => {
  it('creates an artifact with an initial version snapshot', async () => {
    const row = await createArtifact({
      ownerId: 'u1',
      type: 'html',
      title: 'My Page',
      content: '<p>hi</p>',
      author: 'assistant',
    });

    expect(row.version).toBe(1);
    expect(row.language).toBe('html');
    expect(sb.tables.artifacts).toHaveLength(1);
    expect(sb.tables.artifact_versions).toHaveLength(1);
    expect(sb.tables.artifact_versions[0].version).toBe(1);
    expect(sb.tables.artifact_versions[0].author).toBe('assistant');
  });

  it('rejects unknown types and oversized content', async () => {
    await expect(createArtifact({ ownerId: 'u1', type: 'exe', title: 'x', content: 'y' })).rejects.toBeInstanceOf(ArtifactStoreError);
    const big = 'a'.repeat(513 * 1024);
    await expect(createArtifact({ ownerId: 'u1', type: 'code', title: 'big', content: big })).rejects.toMatchObject({ status: 413 });
  });

  it('hides other users private artifacts but allows public ones', async () => {
    await createArtifact({ ownerId: 'u1', type: 'svg', title: 'secret', content: '<svg/>' });
    const publicRow = await createArtifact({ ownerId: 'u2', type: 'svg', title: 'open', content: '<svg/>' });
    await setVisibility(publicRow.id, 'u2', 'public');

    expect(await getArtifact(sb.tables.artifacts[0].id, 'u2')).toBeNull();
    expect((await getArtifact(publicRow.id, 'u3'))?.id).toBe(publicRow.id);
    expect(await getArtifact(publicRow.id)).not.toBeNull();
  });

  it('lists only the owner artifacts newest-first', async () => {
    const a = await createArtifact({ ownerId: 'u1', type: 'code', title: 'old', content: 'x' });
    // Fake shares one clock; force ordering determinism.
    sb.tables.artifacts.find((r) => r.id === a.id)!.updated_at = '2026-01-01T00:00:00Z';
    await createArtifact({ ownerId: 'u1', type: 'code', title: 'new', content: 'y' });
    await createArtifact({ ownerId: 'u2', type: 'code', title: 'foreign', content: 'z' });

    const mine = await listArtifacts('u1');
    expect(mine).toHaveLength(2);
    expect(mine[0].title).toBe('new');
    expect(mine[1].title).toBe('old');

    const limited = await listArtifacts('u1', { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('versions every edit and keeps history complete', async () => {
    const row = await createArtifact({ ownerId: 'u1', type: 'markdown', title: 'Doc', content: 'v1 text' });
    const v2 = await updateArtifact(row.id, 'u1', { content: 'v2 text', changeSummary: 'rewrite' });
    expect(v2.version).toBe(2);

    const versions = await listVersions(row.id, 'u1');
    const numbers = versions.map((v) => v.version).sort();
    expect(numbers).toEqual([1, 2]);
    expect(versions.find((v) => v.version === 1)?.content).toBe('v1 text');
    expect(versions.find((v) => v.version === 2)?.content).toBe('v2 text');
  });

  it("blocks edits and deletes by non-owners", async () => {
    const row = await createArtifact({ ownerId: 'u1', type: 'code', title: 'mine', content: 'x' });
    await expect(updateArtifact(row.id, 'attacker', { content: 'hacked' })).rejects.toMatchObject({ status: 404 });
    await expect(deleteArtifact(row.id, 'attacker')).resolves.toBe(false);
    expect(await deleteArtifact(row.id, 'u1')).toBe(true);
    expect(sb.tables.artifacts).toHaveLength(0);
  });

  it('reverts to an old version as a NEW version (nothing destroyed)', async () => {
    const row = await createArtifact({ ownerId: 'u1', type: 'markdown', title: 'Doc', content: 'one' });
    await updateArtifact(row.id, 'u1', { content: 'two' });
    const restored = await revertToVersion(row.id, 'u1', 1);

    expect(restored.content).toBe('one');
    expect(restored.version).toBe(3);
    const versions = await listVersions(row.id, 'u1');
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
  });

  it('remixes only public or owned artifacts', async () => {
    const foreignPrivate = await createArtifact({ ownerId: 'u9', type: 'chart', title: 'private chart', content: '{}' });
    await expect(remixArtifact(foreignPrivate.id, 'me')).rejects.toMatchObject({ status: 403 });

    const shared = await createArtifact({ ownerId: 'u9', type: 'quiz', title: 'shared quiz', content: '{"questions":[]}' });
    await setVisibility(shared.id, 'u9', 'public');

    const remix = await remixArtifact(shared.id, 'me');
    expect(remix.owner_id).toBe('me');
    expect(remix.title).toBe('shared quiz (remix)');
    expect(remix.type).toBe('quiz');
  });
});
