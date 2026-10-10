import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { createFleetRouter } from './routes.js';
import type { Report } from './protocol.js';
import { fixtureReport } from './testing.js';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

function setup(token: string | null = null) {
  const logs: string[] = [];
  const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' });
  const app = express();
  app.use('/api/fleet', createFleetRouter(fleet, { token, log: (l) => logs.push(l) }));
  closers.push(() => fleet.close());
  return { app, fleet, logs };
}

describe('POST /api/fleet/report', () => {
  it('ingests a valid report and acks its events', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/fleet/report').send(fixtureReport());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ackedEvents: 3 });
    expect(typeof res.body.serverTime).toBe('number');
  });

  it('400 with error and path for an invalid report, logging the path but not the body', async () => {
    const { app, logs } = setup();
    const res = await request(app).post('/api/fleet/report').send({ ...fixtureReport(), v: 2, secret: 'sk-ant-should-not-be-logged' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'unsupported protocol version', path: '$.v' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('$.v');
    expect(logs[0]).not.toContain('sk-ant');
  });

  it('400 for malformed JSON', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/fleet/report').set('Content-Type', 'application/json').send('{"v":1,');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'malformed JSON' });
  });

  it('413 over 512 KB', async () => {
    const { app } = setup();
    const big = { ...fixtureReport(), pad: 'x'.repeat(600 * 1024) };
    const res = await request(app).post('/api/fleet/report').send(big);
    expect(res.status).toBe(413);
  });

  it('401 without the token when one is configured', async () => {
    const { app } = setup('s3cret');
    expect((await request(app).post('/api/fleet/report').send(fixtureReport())).status).toBe(401);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', 'nope').send(fixtureReport())).status).toBe(401);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', 's3cret').send(fixtureReport())).status).toBe(200);
    // reads stay open
    expect((await request(app).get('/api/fleet/state')).status).toBe(200);
  });
});

describe('reads', () => {
  it('GET /state lists live sessions, KPIs and events', async () => {
    const { app } = setup();
    await request(app).post('/api/fleet/report').send(fixtureReport());
    const res = await request(app).get('/api/fleet/state');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].agents).toHaveLength(4);
    expect(res.body.kpis.live).toBe(1);
    expect(res.body.events).toHaveLength(3);
    expect(res.body.clearedToday).toBe(0);
  });

  it('GET /sessions/:id returns a view, 404 when unknown', async () => {
    const { app } = setup();
    const r = fixtureReport();
    await request(app).post('/api/fleet/report').send(r);
    const ok = await request(app).get(`/api/fleet/sessions/${r.session.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('invoice-v2');
    expect((await request(app).get('/api/fleet/sessions/nope')).status).toBe(404);
  });

  it('GET /events pages newest first with before and limit', async () => {
    const { app } = setup();
    const r = fixtureReport();
    const events = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, t: 1000 + i, kind: 'note' as const, agentId: null, text: `n${i}`, data: null }));
    const rep: Report = { ...r, events: events.slice(0, 20) };
    await request(app).post('/api/fleet/report').send(rep);
    await request(app).post('/api/fleet/report').send({ ...r, events: events.slice(20) });
    const p1 = await request(app).get('/api/fleet/events?limit=10');
    expect(p1.body.events.map((e: { text: string }) => e.text)).toEqual(Array.from({ length: 10 }, (_, i) => `n${29 - i}`));
    const last = p1.body.events.at(-1).t;
    const p2 = await request(app).get(`/api/fleet/events?limit=10&before=${last}&sessionId=${r.session.id}`);
    expect(p2.body.events.map((e: { text: string }) => e.text)).toEqual(Array.from({ length: 10 }, (_, i) => `n${19 - i}`));
    const def = await request(app).get('/api/fleet/events');
    expect(def.body.events).toHaveLength(30);
    const capped = await request(app).get('/api/fleet/events?limit=5000');
    expect(capped.status).toBe(200);
    expect((await request(app).get('/api/fleet/events?limit=abc')).status).toBe(400);
    expect((await request(app).get('/api/fleet/events?sessionId=nobody')).body.events).toEqual([]);
  });

  it('GET /health', async () => {
    const { app } = setup();
    await request(app).post('/api/fleet/report').send(fixtureReport());
    const res = await request(app).get('/api/fleet/health');
    expect(res.body).toMatchObject({ ok: true, dbPath: ':memory:', liveSessions: 1, reporterVersionsSeen: ['0.1.0'] });
  });

  it('GET /history lists ended sessions of a day', async () => {
    const { app, fleet } = setup();
    const r = fixtureReport();
    await request(app).post('/api/fleet/report').send({ ...r, session: { ...r.session, status: 'done', endReason: 'clear' } });
    const d = new Date(fleet.now());
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await request(app).get(`/api/fleet/history?day=${day}`);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0]).toMatchObject({ name: 'invoice-v2', endReason: 'clear', blowouts: 2, agents: 4 });
    expect((await request(app).get('/api/fleet/history?day=yesterday')).status).toBe(400);
  });
});

describe('DELETE /sessions/:id', () => {
  it('removes a session; requires the token when configured; 404 when unknown', async () => {
    const { app } = setup('t');
    const r = fixtureReport();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', 't').send(r);
    expect((await request(app).delete(`/api/fleet/sessions/${r.session.id}`)).status).toBe(401);
    expect((await request(app).delete(`/api/fleet/sessions/${r.session.id}`).set('X-Podium-Token', 't')).status).toBe(200);
    expect((await request(app).delete(`/api/fleet/sessions/${r.session.id}`).set('X-Podium-Token', 't')).status).toBe(404);
    expect((await request(app).get('/api/fleet/state')).body.sessions).toHaveLength(0);
  });
});

describe('GET /stream', () => {
  it('streams a snapshot, then session and activity messages, with SSE headers', async () => {
    const { app, fleet } = setup();
    const server = app.listen(0, '127.0.0.1');
    closers.push(() => server.close());
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    const received: string[] = [];
    const { headers, done } = await new Promise<{ headers: http.IncomingHttpHeaders; done: Promise<void> }>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/fleet/stream' }, (res) => {
        res.setEncoding('utf8');
        const done = new Promise<void>((fin) => {
          res.on('data', (c: string) => {
            received.push(c);
            const all = received.join('');
            if (all.includes('event: session')) {
              req.destroy();
              fin();
            }
          });
        });
        resolve({ headers: res.headers, done });
      });
      req.on('error', reject);
    });
    expect(headers['content-type']).toMatch(/^text\/event-stream/);
    expect(headers['cache-control']).toMatch(/no-cache/);
    // wait for the snapshot, then report
    while (!received.join('').includes('event: snapshot')) await new Promise((r) => setTimeout(r, 10));
    expect(fleet.hub.size).toBe(1);
    fleet.ingest(fixtureReport());
    await done;
    const all = received.join('');
    expect(all.startsWith('retry: 2000')).toBe(true);
    expect(all.indexOf('event: snapshot')).toBeLessThan(all.indexOf('event: activity'));
    expect(all).toContain('event: session');
    // the hub forgets the client once its socket closes
    for (let i = 0; i < 50 && fleet.hub.size > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(fleet.hub.size).toBe(0);
  });
});
