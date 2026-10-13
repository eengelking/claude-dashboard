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
