import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Route-level tests mock the store module itself — the store has its own
// dedicated suite (artifact-store.test.ts) against a fake PostgREST client.
const store = vi.hoisted(() => ({
  createArtifact: vi.fn(),
  getArtifact: vi.fn(),
  getPublicArtifact: vi.fn(),
  listArtifacts: vi.fn(),
  listVersions: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  revertToVersion: vi.fn(),
  setVisibility: vi.fn(),
  remixArtifact: vi.fn(),
}));

vi.mock('../tools/files/create-artifact/artifact-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools/files/create-artifact/artifact-store.js')>();
  return { ...actual, ...store };
});

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import artifactsRoutes, { publicArtifactsRouter } from '../routes/artifacts.routes.js';
import { ArtifactStoreError } from '../tools/files/create-artifact/artifact-store.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ARTIFACT_ID = '22222222-2222-2222-2222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      req.user = { id: req.headers.authorization.slice(7), email: 'u@t.dev' };
    }
    next();
  });
  app.use('/api/artifacts', artifactsRoutes);
  app.use('/api/public/artifacts', publicArtifactsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('artifacts routes', () => {
  it('requires authentication for the library API', async () => {
    const res = await request(buildApp()).get('/api/artifacts');
    expect(res.status).toBe(401);
    expect(store.listArtifacts).not.toHaveBeenCalled();
  });

  it('lists artifacts for the authenticated user with filters', async () => {
    store.listArtifacts.mockResolvedValue([{ id: ARTIFACT_ID }]);
    const res = await request(buildApp())
      .get('/api/artifacts?type=html&search=page&limit=5')
      .set('Authorization', `Bearer ${USER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: ARTIFACT_ID }]);
    expect(store.listArtifacts).toHaveBeenCalledWith(USER_ID, {
      threadId: undefined,
      type: 'html',
      search: 'page',
      limit: 5,
      offset: undefined,
    });
  });

  it('rejects invalid type filters', async () => {
    const res = await request(buildApp())
      .get('/api/artifacts?type=virus')
      .set('Authorization', `Bearer ${USER_ID}`);
    expect(res.status).toBe(400);
  });

  it('creates an artifact from user-submitted content', async () => {
    store.createArtifact.mockImplementation(async (input: any) => ({ id: ARTIFACT_ID, version: 1, ...input }));
    const res = await request(buildApp())
      .post('/api/artifacts')
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ type: 'markdown', title: 'Notes', content: '# hi' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(ARTIFACT_ID);
    expect(store.createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: USER_ID, type: 'markdown', author: 'user' }),
    );
  });

  it('validates creation payloads', async () => {
    const missingContent = await request(buildApp())
      .post('/api/artifacts')
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ type: 'html', title: 'x' });
    expect(missingContent.status).toBe(400);

    const badType = await request(buildApp())
      .post('/api/artifacts')
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ type: 'exe', content: 'x' });
    expect(badType.status).toBe(400);
  });

  it('maps unknown artifact ids to 404 on read/update/delete/revert', async () => {
    store.getArtifact.mockResolvedValue(null);
    expect((await request(buildApp()).get(`/api/artifacts/${ARTIFACT_ID}`).set('Authorization', `Bearer ${USER_ID}`)).status).toBe(404);

    store.updateArtifact.mockRejectedValue(new ArtifactStoreError('Artifact not found', 404));
    expect((await request(buildApp()).patch(`/api/artifacts/${ARTIFACT_ID}`).set('Authorization', `Bearer ${USER_ID}`).send({ title: 'x' })).status).toBe(404);

    store.deleteArtifact.mockResolvedValue(false);
    expect((await request(buildApp()).delete(`/api/artifacts/${ARTIFACT_ID}`).set('Authorization', `Bearer ${USER_ID}`)).status).toBe(404);

    store.revertToVersion.mockRejectedValue(new ArtifactStoreError('Version 9 not found', 404));
    expect((await request(buildApp()).post(`/api/artifacts/${ARTIFACT_ID}/revert`).set('Authorization', `Bearer ${USER_ID}`).send({ version: 9 })).status).toBe(404);
  });

  it('updates and saves a new version through PATCH', async () => {
    store.updateArtifact.mockResolvedValue({ id: ARTIFACT_ID, version: 2 });
    const res = await request(buildApp())
      .patch(`/api/artifacts/${ARTIFACT_ID}`)
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ content: 'new body', change_summary: 'manual edit' });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(store.updateArtifact).toHaveBeenCalledWith(
      ARTIFACT_ID,
      USER_ID,
      expect.objectContaining({ content: 'new body', author: 'user' }),
    );
  });

  it('reverts to a version', async () => {
    store.revertToVersion.mockResolvedValue({ id: ARTIFACT_ID, version: 3 });
    const res = await request(buildApp())
      .post(`/api/artifacts/${ARTIFACT_ID}/revert`)
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ version: 1 });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(store.revertToVersion).toHaveBeenCalledWith(ARTIFACT_ID, USER_ID, 1);
  });

  it('toggles visibility via the share endpoint', async () => {
    store.setVisibility.mockResolvedValue({ id: ARTIFACT_ID, visibility: 'public' });
    const ok = await request(buildApp())
      .patch(`/api/artifacts/${ARTIFACT_ID}/share`)
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ visibility: 'public' });
    expect(ok.status).toBe(200);

    const bad = await request(buildApp())
      .patch(`/api/artifacts/${ARTIFACT_ID}/share`)
      .set('Authorization', `Bearer ${USER_ID}`)
      .send({ visibility: 'friends' });
    expect(bad.status).toBe(400);
  });

  it('remixes into the caller library', async () => {
    store.remixArtifact.mockResolvedValue({ id: ARTIFACT_ID, owner_id: USER_ID });
    const res = await request(buildApp())
      .post(`/api/artifacts/${ARTIFACT_ID}/remix`)
      .set('Authorization', `Bearer ${USER_ID}`);
    expect(res.status).toBe(201);
    expect(store.remixArtifact).toHaveBeenCalledWith(ARTIFACT_ID, USER_ID);
  });

  it('rejects malformed ids with 400', async () => {
    const res = await request(buildApp())
      .get('/api/artifacts/not-a-uuid')
      .set('Authorization', `Bearer ${USER_ID}`);
    expect(res.status).toBe(400);
    expect(store.getArtifact).not.toHaveBeenCalled();
  });
});

describe('public artifacts route (no auth)', () => {
  it('serves public artifacts without an Authorization header', async () => {
    store.getPublicArtifact.mockResolvedValue({ id: ARTIFACT_ID, visibility: 'public', content: '<p>x</p>' });
    const res = await request(buildApp()).get(`/api/public/artifacts/${ARTIFACT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('public');
    expect(store.getPublicArtifact).toHaveBeenCalledWith(ARTIFACT_ID);
  });

  it('returns 404 for private or missing artifacts', async () => {
    store.getPublicArtifact.mockResolvedValue(null);
    const res = await request(buildApp()).get(`/api/public/artifacts/${ARTIFACT_ID}`);
    expect(res.status).toBe(404);
  });

  it('never exposes private artifacts even when unauthenticated', async () => {
    // getPublicArtifact only resolves rows with visibility='public' (SQL-level
    // guard) — the route adds no bypass around it.
    store.getPublicArtifact.mockResolvedValue(null);
    const res = await request(buildApp()).get(`/api/public/artifacts/${ARTIFACT_ID}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('content');
  });
});
