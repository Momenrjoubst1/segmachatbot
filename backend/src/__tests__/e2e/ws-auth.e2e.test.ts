/**
 * E2E for the STT WebSocket auth protocol over a REAL socket.
 *
 * Boots a real HTTP server with attachSttWebSocket and drives the exact
 * wire protocol the frontend speaks: the JWT must arrive in the FIRST
 * config frame (never the upgrade URL), garbage/missing tokens must be
 * closed with 4401 before anything else happens, and the localhost
 * anon-dev escape hatch must still authenticate through the same frame.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';

process.env.DEEPGRAM_API_KEY = 'e2e-dummy-key';

import { attachSttWebSocket, isSttEnabled } from '../../ws/stt-ws.js';

let server: http.Server;
let port = 0;

beforeAll(async () => {
  expect(isSttEnabled()).toBe(true);
  server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  attachSttWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Outcome {
  messages: Array<Record<string, unknown>>;
  close?: { code: number; reason: string };
}

/** Opens a socket, runs the frame script, resolves on ready/close/timeout. */
function drive(
  frames: Array<Record<string, unknown> | Buffer>,
  opts: { anonDev: boolean; timeoutMs?: number },
): Promise<Outcome> {
  const prev = process.env.STT_ALLOW_ANON_DEV;
  process.env.STT_ALLOW_ANON_DEV = opts.anonDev ? 'true' : '';

  return new Promise<Outcome>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stt`);
    const outcome: Outcome = { messages: [] };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch { /* noop */ }
      resolve(outcome);
    };
    const timer = setTimeout(finish, opts.timeoutMs ?? 5000);

    ws.on('open', () => {
      for (const f of frames) {
        ws.send(typeof f === 'string' || Buffer.isBuffer(f) ? f : JSON.stringify(f));
      }
    });
    ws.on('message', (raw) => {
      try { outcome.messages.push(JSON.parse(String(raw))); } catch { /* ignore */ }
      if (outcome.messages.some((m) => m.type === 'ready')) {
        clearTimeout(timer);
        finish();
      }
    });
    ws.on('close', (code, reason) => {
      outcome.close = { code, reason: reason.toString() };
      clearTimeout(timer);
      finish();
    });
    ws.on('error', () => { /* surface via close */ });
  });
}

describe('E2E · /ws/stt config-frame auth over a real socket', () => {
  it('anon-dev session authenticates via the config frame and reaches ready', async () => {
    const out = await drive(
      [{ type: 'config', sampleRate: 16000 }], // no token — anon-dev localhost
      { anonDev: true },
    );
    expect(out.messages.some((m) => m.type === 'ready')).toBe(true);
    expect(out.close?.code).not.toBe(4401);
  });

  it('missing token without anon-dev → closed 4401, never ready', async () => {
    const out = await drive([{ type: 'config', sampleRate: 16000 }], { anonDev: false });
    expect(out.messages.some((m) => m.type === 'ready')).toBe(false);
    expect(out.close?.code).toBe(4401);
  });

  it('garbage token → closed 4401, never ready', async () => {
    const out = await drive(
      [{ type: 'config', sampleRate: 16000, token: 'garbage.token.here' }],
      { anonDev: false },
    );
    expect(out.messages.some((m) => m.type === 'ready')).toBe(false);
    expect(out.close?.code).toBe(4401);
  });

  it('binary audio before the config frame → closed 4401', async () => {
    const out = await drive([Buffer.alloc(64)], { anonDev: true });
    expect(out.close?.code).toBe(4401);
  });
});
