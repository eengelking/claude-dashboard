// Responding sends a name, a token and a session cookie; over plain HTTP beyond loopback they travel unencrypted.
// The server says so in its log and still serves (#306).
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLogger } from './logging/logger.js';
import { createPlainHttpWatch, isLoopbackBind } from './plainHttp.js';

const setup = (opts: { bind: string; respondOn?: boolean; now?: () => number; trustProxy?: boolean }) => {
  const lines: string[] = [];
  const logger = createLogger({ format: 'json', write: (l) => lines.push(l) });
  const state = { on: opts.respondOn ?? true };
  const watch = createPlainHttpWatch({ bind: opts.bind, respondOn: () => state.on, logger, now: opts.now });
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', true);
  app.post('/api/fleet/respond/sign-in', watch.onSignIn, (_req, res) => void res.json({ ok: true }));
  const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.event === 'server.respond_plain_http');
  return { watch, app, state, lines, events };
};

describe('isLoopbackBind', () => {
  it('is true for the loopback names and addresses, false for a wildcard, another address or an empty bind', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) expect(isLoopbackBind(h), h).toBe(true);
    for (const h of ['0.0.0.0', '::', '', '192.168.1.5', 'podium.lan']) expect(isLoopbackBind(h), h).toBe(false);
  });
});

describe('start and flag warning', () => {
  it('warns once at start when bound beyond loopback with responding on', () => {
    const t = setup({ bind: '0.0.0.0' });
    t.watch.atStart();
    expect(t.events()).toHaveLength(1);
    expect(t.events()[0]).toMatchObject({ level: 'warn', trigger: 'start', bind: '0.0.0.0' });
  });

  it('does not warn at start on loopback, or with responding off', () => {
    const loop = setup({ bind: '127.0.0.1' });
    loop.watch.atStart();
    const off = setup({ bind: '0.0.0.0', respondOn: false });
    off.watch.atStart();
    expect(loop.events()).toHaveLength(0);
    expect(off.events()).toHaveLength(0);
  });

  it('warns when the flag is turned on beyond loopback, and not on loopback', () => {
    const t = setup({ bind: '0.0.0.0', respondOn: false });
    t.state.on = true;
    t.watch.onFlagOn();
    expect(t.events()).toHaveLength(1);
    expect(t.events()[0]).toMatchObject({ trigger: 'flag' });
    const loop = setup({ bind: '127.0.0.1' });
    loop.watch.onFlagOn();
    expect(loop.events()).toHaveLength(0);
  });

  it('names the risk and holds no token, header value or cookie value', async () => {
    const t = setup({ bind: '0.0.0.0' });
    t.watch.atStart();
    await request(t.app)
      .post('/api/fleet/respond/sign-in')
      .set('Host', 'podium.lan')
      .set('Cookie', 'podium_respond=COOKIEVALUE')
      .set('X-Podium-Token', 'SECRETVALUE')
      .send({ name: 'Ed', token: 'BODYSECRET' });
    const all = t.lines.join('\n');
    expect(all).toMatch(/unencrypted/i);
    expect(t.events()).toHaveLength(2);
    expect(all).not.toMatch(/COOKIEVALUE|SECRETVALUE|BODYSECRET/);
  });
});

describe('sign-in over plain HTTP', () => {
  it('notes a sign-in over plain HTTP from a non-loopback Host, even when the bind is loopback, and still serves it', async () => {
    const t = setup({ bind: '127.0.0.1' });
    const res = await request(t.app).post('/api/fleet/respond/sign-in').set('Host', 'podium.lan:4317');
    expect(res.status).toBe(200);
    expect(t.events()).toHaveLength(1);
    expect(t.events()[0]).toMatchObject({ level: 'warn', trigger: 'sign_in', request_host: 'podium.lan' });
  });

  it('is silent for a loopback Host', async () => {
    const t = setup({ bind: '0.0.0.0' });
    for (const host of ['127.0.0.1:4317', 'localhost:4317', '[::1]:4317']) await request(t.app).post('/api/fleet/respond/sign-in').set('Host', host);
    expect(t.events()).toHaveLength(0);
  });

  it('is silent when the connection is HTTPS behind a trusted proxy', async () => {
    const t = setup({ bind: '0.0.0.0', trustProxy: true });
    await request(t.app).post('/api/fleet/respond/sign-in').set('Host', 'podium.example').set('X-Forwarded-Proto', 'https');
    expect(t.events()).toHaveLength(0);
  });

  it('ignores X-Forwarded-Proto while the proxy is not trusted', async () => {
    const t = setup({ bind: '0.0.0.0' });
    await request(t.app).post('/api/fleet/respond/sign-in').set('Host', 'podium.example').set('X-Forwarded-Proto', 'https');
    expect(t.events()).toHaveLength(1);
  });

  it('notes at most once a minute', async () => {
    let now = 1_000_000;
    const t = setup({ bind: '0.0.0.0', now: () => now });
    const go = () => request(t.app).post('/api/fleet/respond/sign-in').set('Host', 'podium.lan');
    await go();
    now += 59_000;
    await go();
    expect(t.events()).toHaveLength(1);
    now += 2_000;
    await go();
    expect(t.events()).toHaveLength(2);
  });

  it('puts only a sanitized, bounded host in the log', async () => {
    const t = setup({ bind: '0.0.0.0' });
    await request(t.app).post('/api/fleet/respond/sign-in').set('Host', 'a'.repeat(300));
    const host = String(t.events()[0]?.request_host ?? '');
    expect(host.length).toBeLessThanOrEqual(100);
  });

  it('never blocks: next is always called', () => {
    const t = setup({ bind: '0.0.0.0' });
    const next = vi.fn();
    t.watch.onSignIn({ protocol: 'http', headers: { host: 'podium.lan' } } as unknown as express.Request, {} as express.Response, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
