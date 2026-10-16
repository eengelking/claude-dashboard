// Who may report, and as whom (issue #36): per-person tokens bound to a name, the admin secret, and auth off.
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { PeopleStore } from './people.js';
import { createFleetRouter } from './routes.js';
import { fixtureReport } from './testing.js';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

function setup(adminSecret: string | null = 'admin-secret') {
  const logs: string[] = [];
  const db = openDb(':memory:');
  const fleet = new Fleet(new FleetDb(db), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' });
  const people = new PeopleStore(db);
  const app = express();
  app.use('/api/fleet', createFleetRouter(fleet, { token: adminSecret, people, log: (l) => logs.push(l) }));
  closers.push(() => fleet.close());
  return { app, fleet, people, logs };
}

function report(userName: string | null, id = 'sess-1') {
  const r = fixtureReport() as unknown as Record<string, unknown> & { session: { id: string } };
  r.session = { ...r.session, id };
  if (userName !== null) r.userName = userName;
  return r;
}

const owners = async (app: express.Express) =>
  ((await request(app).get('/api/fleet/state')).body.sessions as { owner: string | null }[]).map((s) => s.owner);

describe('reporting with a person token', () => {
  it('accepts the right token with the right name (any case) and records the owner', async () => {
    const { app, people } = setup();
    const { token } = people.createPerson('Dana');
    const res = await request(app).post('/api/fleet/report').set('X-Podium-Token', token).send(report('dana'));
    expect(res.status).toBe(200);
    expect(await owners(app)).toEqual(['Dana']);
    const row = people.list({ page: 1, pageSize: 50, q: '' }).rows[0]!;
    expect(row.lastReportAt).not.toBeNull();
  });

  it('refuses a valid token that carries another person’s name, and shows nothing', async () => {
    const { app, people } = setup();
    const dana = people.createPerson('Dana');
    people.createPerson('Eli');
    const res = await request(app).post('/api/fleet/report').set('X-Podium-Token', dana.token).send(report('Eli'));
    expect(res.status).toBe(401);
    expect((await request(app).get('/api/fleet/state')).body.sessions).toHaveLength(0);
  });

  it('refuses a missing name, an unknown name and the right name with a wrong token', async () => {
    const { app, people } = setup();
    const dana = people.createPerson('Dana');
    const eli = people.createPerson('Eli');
    const post = (token: string, name: string | null) =>
      request(app).post('/api/fleet/report').set('X-Podium-Token', token).send(report(name));
    expect((await post(dana.token, null)).status).toBe(401);
    expect((await post(dana.token, 'Nobody')).status).toBe(401);
    expect((await post(eli.token, 'Dana')).status).toBe(401);
    expect((await post(dana.token.slice(0, -1) + (dana.token.endsWith('0') ? '1' : '0'), 'Dana')).status).toBe(401);
    expect((await request(app).get('/api/fleet/state')).body.sessions).toHaveLength(0);
  });

  it('refuses a revoked token, and an old token after a rotation', async () => {
    const { app, people } = setup();
    const a = people.createPerson('Dana');
    people.revoke(a.person.id);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Dana'))).status).toBe(401);
    const b = people.rotate(a.person.id)!;
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Dana'))).status).toBe(401);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', b.token).send(report('Dana'))).status).toBe(200);
  });

  it('never echoes the token in a refusal or a log line', async () => {
    const { app, people, logs } = setup();
    const a = people.createPerson('Dana');
    const res = await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Eli'));
    expect(JSON.stringify(res.body)).not.toContain(a.token);
    expect(logs.join('\n')).not.toContain(a.token);
  });

  it('takes the owner of a classic hook from the token alone', async () => {
    const { app, people } = setup();
    const a = people.createPerson('Dana');
    const res = await request(app)
      .post('/api/fleet/hook')
      .set('X-Podium-Token', a.token)
      .send({ hook_event_name: 'SessionStart', session_id: 'hook-1', cwd: '/tmp/x' });
    expect(res.status).toBe(200);
    expect(await owners(app)).toEqual(['Dana']);
  });

  it('lets any valid credential delete a session, and refuses a revoked one', async () => {
    const { app, people } = setup();
    const a = people.createPerson('Dana');
    await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Dana'));
    people.revoke(a.person.id);
    expect((await request(app).delete('/api/fleet/sessions/sess-1').set('X-Podium-Token', a.token)).status).toBe(401);
    expect((await request(app).delete('/api/fleet/sessions/sess-1').set('X-Podium-Token', 'admin-secret')).status).toBe(200);
  });
});

describe('session ownership', () => {
  it('refuses a report for a session id that already belongs to someone else', async () => {
    const { app, people } = setup();
    const dana = people.createPerson('Dana');
    const eli = people.createPerson('Eli');
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', dana.token).send(report('Dana', 'shared'))).status).toBe(200);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', eli.token).send(report('Eli', 'shared'))).status).toBe(409);
    expect(await owners(app)).toEqual(['Dana']);
  });
});

describe('reporting with the admin secret', () => {
  it('puts the session in the Admin band whatever name it carries', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report('Dana'));
    expect(res.status).toBe(200);
    expect(await owners(app)).toEqual(['Admin']);
  });

  it('is refused once the owner turns admin-secret reporting off, while person tokens keep working', async () => {
    const { app, people } = setup();
    people.setAdminReporting(false);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report(null))).status).toBe(401);
    const a = people.createPerson('Dana');
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Dana'))).status).toBe(200);
  });

  it('refuses a wrong secret and a missing token', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', 'nope').send(report(null))).status).toBe(401);
    expect((await request(app).post('/api/fleet/report').send(report(null))).status).toBe(401);
  });
});

describe('reporting with authentication off', () => {
  it('accepts a report with no token and no name as Unassigned (no owner)', async () => {
    const { app } = setup(null);
    expect((await request(app).post('/api/fleet/report').send(report(null))).status).toBe(200);
    expect(await owners(app)).toEqual([null]);
  });

  it('still checks a person token when one is presented', async () => {
    const { app, people } = setup(null);
    const a = people.createPerson('Dana');
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Eli'))).status).toBe(401);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', a.token).send(report('Dana'))).status).toBe(200);
  });
});

describe('the people view fields (issue #34)', () => {
  it('shows each session’s owner, its group and its machine, and splits today’s spend by owner', async () => {
    const { app, people } = setup();
    const backend = people.createGroup('Backend');
    const priya = people.createPerson('Priya N.', backend.id);
    const dana = people.createPerson('Dana K.');
    const withMachine = (r: ReturnType<typeof report>, name: string, id: string) => ({ ...r, machine: { name, id } });
    await request(app).post('/api/fleet/report').set('X-Podium-Token', priya.token).send(withMachine(report('Priya N.', 'p1'), 'priya-mbp', 'aaaa1111'));
    await request(app).post('/api/fleet/report').set('X-Podium-Token', priya.token).send(withMachine(report('Priya N.', 'p2'), 'build-01', 'bbbb2222'));
    await request(app).post('/api/fleet/report').set('X-Podium-Token', dana.token).send(report('Dana K.', 'd1'));
    await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report(null, 'x1'));
    const body = (await request(app).get('/api/fleet/state')).body as {
      sessions: { id: string; owner: string | null; ownerGroup: string | null; machine: { name: string; id: string } | null; costUsd: number }[];
      kpis: { costToday: number; costTodayByOwner: { owner: string | null; group: string | null; costUsd: number }[] };
    };
    const byId = Object.fromEntries(body.sessions.map((s) => [s.id, s]));
    expect(byId.p1).toMatchObject({ owner: 'Priya N.', ownerGroup: 'Backend', machine: { name: 'priya-mbp', id: 'aaaa1111' } });
    expect(byId.p2).toMatchObject({ owner: 'Priya N.', ownerGroup: 'Backend', machine: { name: 'build-01', id: 'bbbb2222' } });
    expect(byId.d1).toMatchObject({ owner: 'Dana K.', ownerGroup: null, machine: null });
    expect(byId.x1).toMatchObject({ owner: 'Admin', ownerGroup: null, machine: null });
    const cost = byId.p1!.costUsd;
    expect(body.kpis.costTodayByOwner).toEqual([
      { owner: 'Priya N.', group: 'Backend', costUsd: cost * 2 },
      { owner: 'Admin', group: null, costUsd: cost },
      { owner: 'Dana K.', group: null, costUsd: cost },
    ]);
    expect(body.kpis.costTodayByOwner.reduce((n, r) => n + r.costUsd, 0)).toBeCloseTo(body.kpis.costToday);
  });

  it('keeps a session’s machine when a later settings-hook payload carries none', async () => {
    const { app, people, fleet } = setup();
    const priya = people.createPerson('Priya N.');
    await request(app).post('/api/fleet/report').set('X-Podium-Token', priya.token).send({ ...report('Priya N.', 'p1'), machine: { name: 'priya-mbp', id: 'aaaa1111' } });
    fleet.ingestHook({ session_id: 'p1', hook_event_name: 'Notification', cwd: '/tmp', message: 'Claude needs your permission' }, 'Priya N.');
    expect(fleet.view('p1')?.machine).toEqual({ name: 'priya-mbp', id: 'aaaa1111' });
  });
});

describe('guessing the admin secret through X-Podium-Token (#255)', () => {
  const guess = (app: express.Express, n: number) =>
    request(app).post('/api/fleet/report').set('X-Podium-Token', `guess-${n}`).send(report(null));

  it('ends many different wrong secrets from one address in 429s with Retry-After, and a person token still works', async () => {
    const { app, people, logs } = setup();
    const { token } = people.createPerson('Dana');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await guess(app, i);
      statuses.push(res.status);
      if (res.status === 429) expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      const ok = await request(app).post('/api/fleet/report').set('X-Podium-Token', token).send(report('Dana'));
      expect(ok.status).toBe(200);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    expect(logs.join('\n')).not.toContain('guess-3');
  });

  it('refuses even the right secret from a throttled address, so a guess cannot be confirmed', async () => {
    const { app } = setup();
    for (let i = 0; i < 6; i++) await guess(app, i);
    const res = await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report(null));
    expect(res.status).toBe(429);
  });

  it('does not count one stale credential sent again and again, so a misconfigured reporter locks nobody out', async () => {
    const { app } = setup();
    for (let i = 0; i < 20; i++) expect((await guess(app, 0)).status).toBe(401);
    const res = await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report(null));
    expect(res.status).toBe(200);
  });

  it('does not count a revoked or unknown person token', async () => {
    const { app, people } = setup();
    const dana = people.createPerson('Dana');
    const eli = people.createPerson('Eli');
    people.revoke(dana.person.id);
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', dana.token).send(report('Dana'))).status).toBe(401);
    }
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', eli.token).send(report('Eli'))).status).toBe(200);
  });
});

describe('GuessThrottle (#255)', () => {
  it('unlocks after lockMs and starts counting again from zero', async () => {
    const { GuessThrottle } = await import('./lockout.js');
    let t = 0;
    const g = new GuessThrottle(() => t, 3, 1000);
    expect([g.fail('a', '1'), g.fail('a', '1'), g.fail('a', '2')]).toEqual([false, false, false]);
    expect(g.fail('a', '3')).toBe(true);
    expect(g.lockedFor('a')).toBe(1000);
    expect(g.lockedFor('b')).toBe(0);
    t = 1001;
    expect(g.lockedFor('a')).toBe(0);
    expect(g.fail('a', '4')).toBe(false);
  });
});
