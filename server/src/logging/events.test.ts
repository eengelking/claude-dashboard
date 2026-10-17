// What the server logs, end to end through the routers and the fleet (#140): the events an agent needs to
// troubleshoot a deployment, no secret or typed text in any line or shipped batch, and a dead log endpoint
// that never holds up a report.
import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { gunzipSync } from 'node:zlib';
import { openDb, FleetDb } from '../fleet/db.js';
import { DEFAULT_CONFIG, Fleet } from '../fleet/fleet.js';
import { PeopleStore } from '../fleet/people.js';
import { WallSettings } from '../fleet/wallSettings.js';
import { FeatureFlags } from '../fleet/featureFlags.js';
import { createFleetRouter } from '../fleet/routes.js';
import { createAdminRouter } from '../admin/adminRouter.js';
import { startSweeper } from '../fleet/sweeper.js';
import { fixtureReport } from '../fleet/testing.js';
import type { Report } from '../fleet/protocol.js';
import { createLogger, type Level } from './logger.js';
import { LogShipper } from './shipper.js';
import { requestLog } from './requestLog.js';
import { createServerLogging } from './setup.js';

const SECRET = 'the-admin-secret-0123456789';
const PROMPT = 'PROMPT-MARKER-do-not-log';
const ANSWER = 'ANSWER-MARKER-do-not-log';
const ACTIVITY = 'ACTIVITY-MARKER-do-not-log';
const T0 = 1_791_648_000_000;

type Rec = Record<string, unknown> & { event: string; level: string; message: string };

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.restoreAllMocks();
});

function fetchStub(hang = false) {
  const bodies: string[] = [];
  const fn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    bodies.push(gunzipSync(Buffer.from(init!.body as Uint8Array)).toString('utf8'));
    if (hang) return new Promise<Response>(() => {});
    return new Response(null, { status: 204 });
  });
  return { fn: fn as unknown as typeof fetch, bodies, mock: fn };
}

function stack(opts: { level?: Level; hang?: boolean; clock?: { t: number } } = {}) {
  const local: string[] = [];
  const f = fetchStub(opts.hang);
  const shipper = new LogShipper({ url: 'http://logs.test:9428', fetch: f.fn, flushMs: 60_000, notify: () => {} });
  const logger = createLogger({ level: opts.level ?? 'debug', format: 'json', secrets: [SECRET], write: (l) => local.push(l), ship: (j) => shipper.push(j) });
  const db = openDb(':memory:');
  const now = opts.clock ? () => opts.clock!.t : Date.now;
  const fleet = new Fleet(new FleetDb(db), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, now, logger);
  const people = new PeopleStore(db);
  const app = express();
  app.set('trust proxy', false);
  app.use(requestLog(logger));
  app.use('/api/fleet', createFleetRouter(fleet, { token: SECRET, people, logger }));
  app.use('/api/admin', createAdminRouter({ secret: SECRET, people, wall: new WallSettings(db), features: new FeatureFlags(db), logger }));
  cleanups.push(() => fleet.close(), () => shipper.close(50));
  const records = () => local.map((l) => JSON.parse(l) as Rec);
  const shippedText = async () => {
    await shipper.flush();
    return f.bodies.join('');
  };
  return { app, fleet, people, logger, shipper, local, records, shippedText, fetch: f };
}

function reportFor(userName: string | null, id = 'sess-log-1'): Report {
  const r = fixtureReport();
  const agents = r.agents.map((a, i) => (i === 0 ? { ...a, promptText: PROMPT, answerText: ANSWER, activity: [{ at: r.sentAt, kind: 'text' as const, text: ACTIVITY }] } : a));
  return { ...r, ...(userName === null ? {} : { userName }), session: { ...r.session, id, activity: [{ at: r.sentAt, kind: 'tool' as const, text: `Bash ${ACTIVITY}` }] }, agents };
}

describe('no secret and no typed text in a log line or a shipped batch', () => {
  it('holds for a request carrying a person token, the admin secret, prompts, answers and activity', async () => {
    const s = stack();
    const dana = s.people.createPerson('Dana');
    // A token that does not match the name, a wrong token, the admin secret, and a good report full of text.
    await request(s.app).post('/api/fleet/report').set('X-Podium-Token', dana.token).send(reportFor('Eli'));
    await request(s.app).post('/api/fleet/report').set('X-Podium-Token', `${dana.token.slice(0, -4)}beef`).send(reportFor('Dana'));
    await request(s.app).post('/api/fleet/report').set('X-Podium-Token', SECRET).send(reportFor(null, 'sess-admin'));
    const ok = await request(s.app).post('/api/fleet/report').set('X-Podium-Token', dana.token).send(reportFor('Dana'));
    expect(ok.status).toBe(200);
    await request(s.app).post(`/api/fleet/report?token=${dana.token}`).set('X-Podium-Token', dana.token).send({ v: 1, prompt: PROMPT });
    // Admin: a wrong secret, the right one, and a new person (whose token is in the response only).
    const agent = request.agent(s.app);
    await agent.post('/api/admin/unlock').set('X-Podium-Admin', '1').send({ name: 'Admin', token: `${SECRET}-wrong` });
    await agent.post('/api/admin/unlock').set('X-Podium-Admin', '1').send({ name: 'Admin', token: SECRET });
    const made = await agent.post('/api/admin/people').set('X-Podium-Admin', '1').send({ name: 'Finn' });
    expect(made.status).toBe(201);

    const localText = s.local.join('\n');
    const shipped = await s.shippedText();
    expect(s.fetch.mock).toHaveBeenCalled();
    for (const text of [localText, shipped]) {
      for (const bad of [dana.token, dana.token.split('_')[2]!, SECRET, made.body.token as string, PROMPT, ANSWER, ACTIVITY]) {
        expect(text).not.toContain(bad);
      }
    }
    // And the lines were there to check: the refusals, the report, the requests and the Admin changes.
    const events = s.records().map((r) => r.event);
    expect(events).toEqual(expect.arrayContaining(['auth.failed', 'report.accepted', 'session.started', 'reporter.connected', 'http.request', 'admin.unlock_failed', 'admin.unlock', 'admin.person_created']));
  });
});

describe('the events', () => {
  it('report.rejected carries the reason and the path, at warn', async () => {
    const s = stack();
    await request(s.app).post('/api/fleet/report').set('X-Podium-Token', SECRET).send({ ...fixtureReport(), v: 2 });
    const rec = s.records().find((r) => r.event === 'report.rejected')!;
    expect(rec).toMatchObject({ level: 'warn', reason: 'unsupported protocol version', path: '$.v', status: 400 });
  });

  it('auth.failed names the route and the source address and why, never the token', async () => {
    const s = stack();
    await request(s.app).post('/api/fleet/report').send(fixtureReport());
    const rec = s.records().find((r) => r.event === 'auth.failed')!;
    expect(rec).toMatchObject({ level: 'warn', route: '/api/fleet/report', status: 401, reason: 'missing token' });
    expect(typeof rec.source).toBe('string');
  });

  it('hook.rejected carries the reason and path', async () => {
    const s = stack();
    await request(s.app).post('/api/fleet/hook').set('X-Podium-Token', SECRET).send({ hook_event_name: 'SessionStart' });
    expect(s.records().find((r) => r.event === 'hook.rejected')).toMatchObject({ level: 'warn', status: 400 });
  });

  it('http.request is one debug line per request with the route pattern and no query string', async () => {
    const s = stack();
    await request(s.app).get('/api/fleet/sessions/abc?secret=zzz');
    const rec = s.records().find((r) => r.event === 'http.request')!;
    expect(rec).toMatchObject({ level: 'debug', method: 'GET', route: '/api/fleet/sessions/:id', status: 404 });
    expect(typeof rec.duration_ms).toBe('number');
    expect(JSON.stringify(rec)).not.toContain('zzz');
  });

  it('an aborted request is one http.aborted debug line, and no http.request line', async () => {
    const s = stack();
    s.app.get('/hang', () => {});
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const srv = s.app.listen(0, '127.0.0.1', () => resolve(srv));
    });
    cleanups.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
    const ac = new AbortController();
    const pending = fetch(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/hang?secret=zzz`, { signal: ac.signal }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await pending;
    await vi.waitFor(() => expect(s.records().some((r) => r.event === 'http.aborted')).toBe(true));
    const rec = s.records().find((r) => r.event === 'http.aborted')!;
    expect(rec).toMatchObject({ level: 'debug', method: 'GET', path: '/hang' });
    expect(typeof rec.duration_ms).toBe('number');
    expect(rec).not.toHaveProperty('status');
    expect(JSON.stringify(rec)).not.toContain('zzz');
    expect(s.records().some((r) => r.event === 'http.request')).toBe(false);
  });

  it('http.request is skipped at the default level', async () => {
    const s = stack({ level: 'info' });
    await request(s.app).get('/api/fleet/state');
    expect(s.records().some((r) => r.event === 'http.request')).toBe(false);
  });

  it('a session starts, reports done (ended), and the sweep removes it', async () => {
    const clock = { t: T0 };
    const s = stack({ clock });
    const r = fixtureReport();
    s.fleet.ingest(r, 'Dana');
    s.fleet.ingest({ ...r, session: { ...r.session, status: 'done', endReason: 'prompt_input_exit' } }, 'Dana');
    clock.t += 9000;
    s.fleet.sweep();
    const recs = s.records();
    expect(recs.find((x) => x.event === 'session.started')).toMatchObject({ level: 'info', session_id: r.session.id, owner: 'Dana' });
    expect(recs.find((x) => x.event === 'session.ended')).toMatchObject({ level: 'info', session_id: r.session.id, reason: 'done', end_reason: 'prompt_input_exit' });
    expect(recs.find((x) => x.event === 'sweep.removed')).toMatchObject({ level: 'info', removed: 1, done: 1, dropped: 0 });
  });

  it('sweep.removed lists a bounded number of ids and the total for a large sweep', () => {
    const clock = { t: T0 };
    const s = stack({ clock });
    for (let i = 0; i < 50; i++) {
      const r = fixtureReport();
      s.fleet.ingest({ ...r, session: { ...r.session, id: `bulk-${String(i).padStart(2, '0')}`, status: 'done', endReason: 'prompt_input_exit' } }, 'Dana');
    }
    clock.t += 9000;
    s.fleet.sweep();
    const rec = s.records().find((x) => x.event === 'sweep.removed')!;
    expect(rec).toMatchObject({ removed: 50, done: 50, dropped: 0, session_ids_omitted: 40 });
    expect(String(rec.session_ids).split(',')).toHaveLength(10);
  });

  it('sweep.removed lists every id when the sweep is small', () => {
    const clock = { t: T0 };
    const s = stack({ clock });
    const r = fixtureReport();
    s.fleet.ingest({ ...r, session: { ...r.session, status: 'done', endReason: 'prompt_input_exit' } }, 'Dana');
    clock.t += 9000;
    s.fleet.sweep();
    const rec = s.records().find((x) => x.event === 'sweep.removed')!;
    expect(rec.session_ids).toBe(r.session.id);
    expect(rec).not.toHaveProperty('session_ids_omitted');
  });

  it('session.started says revived only for a session that had ended or been dropped and came back', () => {
    const clock = { t: T0 };
    const s = stack({ clock });
    const started = () => s.records().filter((x) => x.event === 'session.started');
    const r = fixtureReport();
    s.fleet.ingest(r);
    expect(started().at(-1)).toMatchObject({ created: true, revived: false });

    // Stored but not held live, as when another server process wrote it: it reports again, it was never ended.
    (s.fleet as unknown as { live: Map<string, unknown> }).live.delete(r.session.id);
    clock.t += 1000;
    s.fleet.ingest({ ...r, sentAt: clock.t });
    expect(started()).toHaveLength(2);
    expect(started().at(-1)).toMatchObject({ created: false, revived: false });

    // Dropped (heartbeat lost), then back.
    for (let i = 0; i < 80; i++) {
      clock.t += 1000;
      s.fleet.sweep();
    }
    expect(s.fleet.isLive(r.session.id)).toBe(false);
    s.fleet.ingest({ ...r, sentAt: clock.t, events: [] });
    expect(started().at(-1)).toMatchObject({ created: false, revived: true });
  });

  it('a session that stops reporting goes silent, then ends as heartbeat lost', () => {
    const clock = { t: T0 };
    const s = stack({ clock });
    const r = fixtureReport();
    s.fleet.ingest(r);
    for (let i = 0; i < 80; i++) {
      clock.t += 1000;
      s.fleet.sweep();
    }
    const recs = s.records();
    expect(recs.filter((x) => x.event === 'reporter.silent')).toHaveLength(1);
    expect(recs.find((x) => x.event === 'reporter.silent')).toMatchObject({ level: 'warn', session_id: r.session.id });
    expect(recs.find((x) => x.event === 'session.ended')).toMatchObject({ session_id: r.session.id, reason: 'heartbeat lost' });
    expect(recs.find((x) => x.event === 'sweep.removed')).toMatchObject({ removed: 1, dropped: 1 });
  });

  it('reporter.connected once per reporter, and again after it went quiet', () => {
    const clock = { t: T0 };
    const s = stack({ clock });
    const r = { ...fixtureReport(), machine: { name: 'laptop', id: 'm-1' } };
    s.fleet.ingest(r, 'Dana');
    clock.t += 1000;
    s.fleet.ingest(r, 'Dana');
    expect(s.records().filter((x) => x.event === 'reporter.connected')).toHaveLength(1);
    clock.t += 120_000;
    s.fleet.ingest(r, 'Dana');
    const conn = s.records().filter((x) => x.event === 'reporter.connected');
    expect(conn).toHaveLength(2);
    expect(conn[0]).toMatchObject({ owner: 'Dana', machine: 'laptop', machine_id: 'm-1', reporter_version: r.reporter.version });
  });

  it('Admin changes are admin.* events with the action and the source, at info', async () => {
    const s = stack();
    const agent = request.agent(s.app);
    await agent.post('/api/admin/unlock').set('X-Podium-Admin', '1').send({ name: 'Admin', token: SECRET });
    await agent.put('/api/admin/settings').set('X-Podium-Admin', '1').send({ features: { 'activity-feed': false } });
    const rec = s.records().find((r) => r.event === 'admin.feature_changed')!;
    expect(rec).toMatchObject({ level: 'info', action: 'feature_changed', setting: 'activity-feed', on: false });
    expect(typeof rec.source).toBe('string');
  });

  it('a failing sweeper timer is sweeper.failed at error', () => {
    vi.useFakeTimers();
    try {
      const s = stack();
      vi.spyOn(s.fleet, 'sweep').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const stop = startSweeper(s.fleet, { sweepMs: 1000, tickMs: 2000, retentionMs: 3600_000 }, s.logger);
      vi.advanceTimersByTime(1000);
      stop();
      expect(s.records().find((r) => r.event === 'sweeper.failed')).toMatchObject({ level: 'error', timer: 'sweep', message: 'podium sweeper: sweep failed: boom' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a dead log endpoint', () => {
  it('does not hold up POST /api/fleet/report', async () => {
    const s = stack({ hang: true });
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      const res = await request(s.app).post('/api/fleet/report').set('X-Podium-Token', SECRET).send(reportFor(null, `sess-${i}`));
      expect(res.status).toBe(200);
      void s.shipper.flush(); // a flush hangs on the dead endpoint; reports must not wait for it
    }
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(s.fetch.mock).toHaveBeenCalled();
  });
});

describe('logging from the environment', () => {
  it('ships nothing, and makes no network call, when no ship URL is set', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const lines: string[] = [];
    const logging = createServerLogging({}, { write: (l) => lines.push(l) });
    expect(logging.shipper).toBeNull();
    logging.logger.info('server.start', 'up');
    logging.logger.error('ingest.failed', 'bad');
    await logging.close();
    expect(spy).not.toHaveBeenCalled();
    expect(lines).toEqual(['up', 'bad']);
  });

  it('reads the level, format and shipping settings, and warns about junk without failing', async () => {
    const lines: string[] = [];
    const logging = createServerLogging(
      { PODIUM_LOG_LEVEL: 'loud', PODIUM_LOG_FORMAT: 'json', PODIUM_LOG_SHIP_URL: 'http://logs.test:9428', PODIUM_LOG_SHIP_HEADERS: 'AccountID=1;bad header=x', PODIUM_LOG_SHIP_BUFFER: '50' },
      { write: (l) => lines.push(l), fetch: fetchStub().fn },
    );
    cleanups.push(() => logging.close());
    expect(logging.settings).toMatchObject({ level: 'info', format: 'json', shipping: true, shipBuffer: 50 });
    const warns = lines.map((l) => JSON.parse(l) as Rec).filter((r) => r.event === 'log.config_invalid');
    expect(warns.map((w) => w.setting)).toEqual(expect.arrayContaining(['PODIUM_LOG_LEVEL', 'PODIUM_LOG_SHIP_HEADERS']));
    expect(lines.join('\n')).not.toContain('=x');
  });

  it('turns shipping off with a warning when the URL is not usable', () => {
    const lines: string[] = [];
    const logging = createServerLogging({ PODIUM_LOG_SHIP_URL: 'ftp://nope' }, { write: (l) => lines.push(l) });
    expect(logging.shipper).toBeNull();
    expect(lines.join('\n')).toMatch(/PODIUM_LOG_SHIP_URL/);
  });
});
