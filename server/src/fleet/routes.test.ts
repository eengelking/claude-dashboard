import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { createFleetRouter } from './routes.js';
import { MAIN_LOOP, type Report } from './protocol.js';
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

  it('tells an older, a matching and a newer reporter where it stands, and accepts all three', async () => {
    const { app } = setup();
    const send = async (version: string) => {
      const r = fixtureReport();
      r.reporter.version = version;
      return request(app).post('/api/fleet/report').send(r);
    };
    const older = await send('0.1.0');
    const matching = await send('0.3.2');
    const newer = await send('99.0.0');
    expect([older.status, matching.status, newer.status]).toEqual([200, 200, 200]);
    expect(older.body.reporterCompat).toBe('outdated');
    expect(matching.body.reporterCompat).toBe('ok');
    expect(newer.body.reporterCompat).toBe('newer');
    expect(older.body.serverVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(older.body.reporterSupport).toEqual({ min: expect.any(String), max: expect.any(String) });
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

  it('GET /sessions/:id/agents/:agentId/text serves the full text, 404 when there is none', async () => {
    const { app } = setup();
    const r = fixtureReport();
    r.agents[0]!.promptText = '# Task\n\nDo it.';
    await request(app).post('/api/fleet/report').send(r);
    const ok = await request(app).get(`/api/fleet/sessions/${r.session.id}/agents/${r.agents[0]!.id}/text`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ prompt: '# Task\n\nDo it.', answer: null });
    expect((await request(app).get(`/api/fleet/sessions/${r.session.id}/agents/${r.agents[1]!.id}/text`)).status).toBe(404);
    expect((await request(app).get('/api/fleet/sessions/nope/agents/x/text')).status).toBe(404);
  });

  it('the session view carries the text lengths, never the text', async () => {
    const { app } = setup();
    const r = fixtureReport();
    r.agents[0]!.promptText = '# Task\n\nDo it.';
    await request(app).post('/api/fleet/report').send(r);
    const v = (await request(app).get(`/api/fleet/sessions/${r.session.id}`)).body;
    const a = v.agents.find((x: { id: string }) => x.id === r.agents[0]!.id);
    expect(a).toMatchObject({ promptChars: 14, answerChars: null });
    expect('promptText' in a).toBe(false);
    expect(JSON.stringify(v)).not.toContain('Do it.');
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
    expect(res.body).toMatchObject({ ok: true, dbPath: ':memory:', liveSessions: 1, reporterVersionsSeen: ['0.14.2'] });
    expect(res.body.serverVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.body.reporterSupport).toEqual({ min: expect.any(String), max: expect.any(String) });
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
    // a date that does not exist is a 400, not a silent roll over into the next month
    for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29']) {
      const r = await request(app).get(`/api/fleet/history?day=${bad}`);
      expect(r.status, bad).toBe(400);
    }
    expect((await request(app).get('/api/fleet/history?day=2024-02-29')).status).toBe(200);
  });

  describe('paging (#195)', () => {
    /** Ends `n` sessions named s1..sn, and returns the app and today's date. */
    const endMany = async (n: number) => {
      const ctx = setup();
      const r = fixtureReport();
      for (let i = 1; i <= n; i++) {
        const session = { ...r.session, id: `5f0c2a8e-1b7d-4c3e-9a51-${String(i).padStart(12, '0')}`, name: `s${i}`, status: 'done' as const, endReason: 'clear' };
        await request(ctx.app).post('/api/fleet/report').send({ ...r, session });
      }
      const d = new Date(ctx.fleet.now());
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { ...ctx, day };
    };

    it('returns the first page of 50 with the whole day as the total', async () => {
      const { app, day } = await endMany(60);
      const res = await request(app).get(`/api/fleet/history?day=${day}`);
      expect(res.body).toMatchObject({ day, total: 60, page: 1, pageSize: 50 });
      expect(res.body.sessions).toHaveLength(50);
    });

    it('returns the rest on page 2 and does not repeat rows between pages', async () => {
      const { app, day } = await endMany(60);
      const one = await request(app).get(`/api/fleet/history?day=${day}&page=1&pageSize=25`);
      const two = await request(app).get(`/api/fleet/history?day=${day}&page=2&pageSize=25`);
      const three = await request(app).get(`/api/fleet/history?day=${day}&page=3&pageSize=25`);
      expect([one, two, three].map((r) => r.body.sessions.length)).toEqual([25, 25, 10]);
      const ids = [one, two, three].flatMap((r) => r.body.sessions.map((s: { id: string }) => s.id));
      expect(new Set(ids).size).toBe(60);
      const ended = [one, two, three].flatMap((r) => r.body.sessions.map((s: { endedAt: number }) => s.endedAt));
      expect(ended).toEqual([...ended].sort((a, b) => b - a));
    });

    it('clamps a page past the end to the last page', async () => {
      const { app, day } = await endMany(60);
      const res = await request(app).get(`/api/fleet/history?day=${day}&page=9&pageSize=25`);
      expect(res.body).toMatchObject({ total: 60, page: 3, pageSize: 25 });
      expect(res.body.sessions).toHaveLength(10);
    });

    it('answers an empty day with page 1 and a total of 0', async () => {
      const { app } = setup();
      const res = await request(app).get('/api/fleet/history?day=2020-01-01');
      expect(res.body).toMatchObject({ sessions: [], total: 0, page: 1, pageSize: 50 });
    });

    it('rejects a page or page size that is not allowed', async () => {
      const { app } = setup();
      for (const q of ['page=0', 'page=abc', 'page=-1', 'pageSize=10', 'pageSize=abc', 'pageSize=1000']) {
        const r = await request(app).get(`/api/fleet/history?day=2024-02-29&${q}`);
        expect(r.status, q).toBe(400);
      }
    });
  });
});

describe('the activity feed (#118)', () => {
  /** The fixture as the reporter would send it now, with the option on and the given entries on its first agent. */
  const live = (activity: { at: number; kind: 'tool' | 'text'; text: string }[] = [], main: typeof activity = []): Report => {
    const r = fixtureReport();
    r.sentAt = Date.now();
    r.session.activityFeed = true;
    r.agents[0]!.activity = activity;
    if (main.length) r.session.activity = main;
    return r;
  };
  const url = (r: Report, loop: string, every = '') => `/api/fleet/sessions/${encodeURIComponent(r.session.id)}/agents/${encodeURIComponent(loop)}/activity${every}`;

  it('the report reply lists no loop while nobody watches, and the agent once a viewer fetches', async () => {
    const { app } = setup();
    const r = live();
    const first = await request(app).post('/api/fleet/report').send(r);
    expect(first.body.watch).toEqual([]);
    const got = await request(app).get(url(r, r.agents[0]!.id, '?every=10'));
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ entries: [], live: true });
    expect(typeof got.body.since).toBe('number');
    const second = await request(app).post('/api/fleet/report').send(live());
    expect(second.body.watch).toEqual([r.agents[0]!.id]);
  });

  it('serves what the reporter sent for a watched loop, numbered, and the orchestrator under @orchestrator', async () => {
    const { app } = setup();
    const r = live();
    await request(app).post('/api/fleet/report').send(r);
    await request(app).get(url(r, r.agents[0]!.id));
    await request(app).get(url(r, MAIN_LOOP));
    const at = Date.now() + 5;
    const second = await request(app)
      .post('/api/fleet/report')
      .send(live([{ at, kind: 'tool', text: 'Bash npm test' }, { at: at + 1, kind: 'text', text: 'Two failures.' }], [{ at, kind: 'tool', text: 'Agent Map call sites' }]));
    expect(second.body.watch.sort()).toEqual([MAIN_LOOP, r.agents[0]!.id].sort());
    const agent = await request(app).get(url(r, r.agents[0]!.id));
    expect(agent.body.entries).toEqual([
      { seq: 1, at, kind: 'tool', text: 'Bash npm test' },
      { seq: 2, at: at + 1, kind: 'text', text: 'Two failures.' },
    ]);
    const main = await request(app).get(url(r, MAIN_LOOP));
    expect(main.body.entries.map((e: { text: string }) => e.text)).toEqual(['Agent Map call sites']);
  });

  it('keeps nothing for a loop nobody watches, and never puts entries in the session view', async () => {
    const { app, fleet } = setup();
    const r = live([{ at: Date.now(), kind: 'tool', text: 'Read a' }]);
    await request(app).post('/api/fleet/report').send(r);
    expect(fleet.activity.size).toBe(0);
    const view = (await request(app).get(`/api/fleet/sessions/${r.session.id}`)).body;
    expect(view.activityFeed).toBe(true);
    expect(JSON.stringify(view)).not.toContain('Read a');
  });

  it('404 for an unknown session or agent; a session that has left the live set answers live: false and takes no lease', async () => {
    let t = Date.now();
    const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, () => t);
    closers.push(() => fleet.close());
    const app = express();
    app.use('/api/fleet', createFleetRouter(fleet, { log: () => {} }));
    const r = live();
    expect((await request(app).get(url(r, 'x'))).status).toBe(404);
    await request(app).post('/api/fleet/report').send(r);
    expect((await request(app).get(url(r, 'no-such-agent'))).status).toBe(404);
    await request(app).get(url(r, r.agents[0]!.id));
    const done = live();
    done.session.status = 'done';
    done.session.endReason = 'prompt_input_exit';
    await request(app).post('/api/fleet/report').send(done);
    t += DEFAULT_CONFIG.lingerMs + 1;
    fleet.sweep();
    expect(fleet.isLive(r.session.id)).toBe(false);
    expect(fleet.activity.size).toBe(0);
    const got = await request(app).get(url(r, r.agents[0]!.id));
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ entries: [], live: false, since: null });
    expect(fleet.activity.size).toBe(0);
  });

  it('says enabled: true while the Admin flag is on', async () => {
    const { app } = setup();
    const r = live();
    await request(app).post('/api/fleet/report').send(r);
    expect((await request(app).get(url(r, r.agents[0]!.id))).body).toMatchObject({ enabled: true, live: true });
    expect((await request(app).get('/api/fleet/state')).body.features).toEqual({ 'activity-feed': true, respond: false });
  });

  it('with the Admin flag off: no lease, enabled: false, nothing watched, nothing kept; back on resumes', async () => {
    const { app, fleet } = setup();
    const r = live();
    const aid = r.agents[0]!.id;
    await request(app).post('/api/fleet/report').send(r);
    await request(app).get(url(r, aid, '?every=60'));
    await request(app).get(url(r, MAIN_LOOP, '?every=60'));
    const at = Date.now() + 5;
    await request(app).post('/api/fleet/report').send(live([{ at, kind: 'tool', text: 'Bash npm test' }]));
    expect(fleet.activity.size).toBe(2);

    // Turning it off drops every lease and entry at once.
    fleet.features.setFeature('activity-feed', false);
    expect(fleet.activity.size).toBe(0);
    expect((await request(app).get('/api/fleet/state')).body.features).toEqual({ 'activity-feed': false, respond: false });

    const off = await request(app).get(url(r, aid));
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ entries: [], since: null, live: true, enabled: false });
    expect(typeof off.body.serverTime).toBe('number');
    expect(fleet.activity.size).toBe(0);
    // The mod is told nothing is watched, and what it sends anyway is not kept.
    const reply = await request(app).post('/api/fleet/report').send(live([{ at: at + 10, kind: 'tool', text: 'Read secret-ish' }]));
    expect(reply.body.watch).toEqual([]);
    expect(fleet.activity.size).toBe(0);
    // An unknown agent is still a 404 while off.
    expect((await request(app).get(url(r, 'no-such-agent'))).status).toBe(404);

    // Back on: the next fetch takes a lease as usual and starts empty.
    fleet.features.setFeature('activity-feed', true);
    const on = await request(app).get(url(r, aid));
    expect(on.body).toMatchObject({ entries: [], live: true, enabled: true });
    expect(typeof on.body.since).toBe('number');
    expect((await request(app).post('/api/fleet/report').send(live())).body.watch).toEqual([aid]);
  });

  it('a flag change reaches open browsers as a fresh snapshot carrying the flags', () => {
    const { fleet } = setup();
    const seen: string[] = [];
    fleet.hub.add({ write: (c: string) => void seen.push(c), end: () => {} });
    seen.length = 0;
    fleet.features.setFeature('activity-feed', false);
    const all = seen.join('');
    expect(all).toContain('event: snapshot');
    expect(all).toContain('"features":{"activity-feed":false,"respond":false}');
  });

  it('a session that is deleted takes its feed with it', async () => {
    const { app, fleet } = setup();
    const r = live();
    await request(app).post('/api/fleet/report').send(r);
    await request(app).get(url(r, r.agents[0]!.id));
    expect(fleet.activity.size).toBe(1);
    fleet.deleteSession(r.session.id);
    expect(fleet.activity.size).toBe(0);
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

describe('POST /sessions/:id/drop', () => {
  it('removes a stale session without a token; 409 while it is not stale; 404 when unknown', async () => {
    const { app, fleet } = setup('t');
    const r = fixtureReport();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', 't').send(r);
    expect((await request(app).post(`/api/fleet/sessions/${r.session.id}/drop`)).status).toBe(409);
    expect((await request(app).post('/api/fleet/sessions/nope/drop')).status).toBe(404);
    // A restarted server treats stored sessions as stale until they report again.
    const restarted = new Fleet(fleet.db, { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' });
    closers.push(() => restarted.close());
    const app2 = express();
    app2.use('/api/fleet', createFleetRouter(restarted, { token: 't', log: () => {} }));
    expect((await request(app2).post(`/api/fleet/sessions/${r.session.id}/drop`)).status).toBe(200);
    expect((await request(app2).get('/api/fleet/state')).body.sessions).toHaveLength(0);
    expect((await request(app2).get(`/api/fleet/sessions/${r.session.id}`)).status).toBe(200);
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

describe('wall notices', () => {
  it('closes a known notice without a token, rejects an unknown one, and carries the switches in the state body', async () => {
    const { app, fleet } = setup('t');
    expect((await request(app).get('/api/fleet/state')).body.wall).toEqual({ notices: { 'background-sessions': true }, showBackgroundSessions: false });
    expect((await request(app).post('/api/fleet/notices/nope/close')).status).toBe(400);
    expect((await request(app).post('/api/fleet/notices/background-sessions/close')).status).toBe(200);
    expect((await request(app).get('/api/fleet/state')).body.wall.notices['background-sessions']).toBe(false);
    expect(fleet.wall.noticeOn('background-sessions')).toBe(false);
  });

  it('sets the background-sessions setting without a token and rejects a non-boolean', async () => {
    const { app } = setup('t');
    expect((await request(app).put('/api/fleet/wall/background-sessions').send({ show: 'yes' })).status).toBe(400);
    expect((await request(app).put('/api/fleet/wall/background-sessions').send({ show: true })).status).toBe(200);
    expect((await request(app).get('/api/fleet/state')).body.wall.showBackgroundSessions).toBe(true);
  });

  it('keeps the switches across a restart and tells open streams when one changes', async () => {
    const { fleet } = setup();
    const sent: string[] = [];
    fleet.hub.add({ write: (c: string) => (sent.push(c), true), end() {} } as never);
    fleet.wall.setNotice('background-sessions', false);
    expect(sent.join('')).toContain('event: wall');
    const restarted = new Fleet(fleet.db, { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' });
    closers.push(() => restarted.close());
    expect(restarted.wall.noticeOn('background-sessions')).toBe(false);
  });
});
