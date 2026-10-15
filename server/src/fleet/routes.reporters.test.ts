// Which reporters the server records (issue #142): every accepted report, never a refused one, never a token.
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { PeopleStore } from './people.js';
import { ReporterStore } from './reporters.js';
import { createFleetRouter } from './routes.js';
import { fixtureReport } from './testing.js';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

function setup(adminSecret: string | null = 'admin-secret') {
  const db = openDb(':memory:');
  const fleet = new Fleet(new FleetDb(db), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' });
  const people = new PeopleStore(db);
  const reporters = new ReporterStore(db, 0);
  const app = express();
  app.use('/api/fleet', createFleetRouter(fleet, { token: adminSecret, people, reporters, log: () => {} }));
  closers.push(() => fleet.close());
  return { app, people, reporters };
}

function report(over: Record<string, unknown> = {}, id = 'sess-1') {
  const r = fixtureReport() as unknown as Record<string, unknown> & { session: { id: string } };
  r.session = { ...r.session, id };
  return { ...r, ...over };
}
const list = (reporters: ReporterStore) => reporters.list({}, Date.now()).rows;

describe('recording reporters', () => {
  it('records a named reporter on its machine id, with the key id of its token and never the token', async () => {
    const { app, people, reporters } = setup();
    const { token, person } = people.createPerson('Dana');
    const res = await request(app)
      .post('/api/fleet/report')
      .set('X-Podium-Token', token)
      .send(report({ userName: 'Dana', machine: { name: 'studio-m2', id: '9f3a1c7d2e40' } }));
    expect(res.status).toBe(200);
    const d = reporters.get('9f3a1c7d2e40', Date.now())!;
    expect(d).toMatchObject({ name: 'studio-m2', who: 'Dana', credential: `pdm_${person.keyId}`, sessions: 1 });
    expect(JSON.stringify(d)).not.toContain(token);
  });

  it('matches a reporter that sends no machine id by its address, and labels the admin secret', async () => {
    const { app, reporters } = setup();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report());
    const d = reporters.get(list(reporters)[0]!.key, Date.now())!;
    expect(d.key.startsWith('addr:')).toBe(true);
    expect(d).toMatchObject({ who: 'Admin', credential: 'admin secret', machineId: null });
    expect(JSON.stringify(d)).not.toContain('"admin-secret"');
  });

  it('records a settings-hooks session as a hooks-only reporter', async () => {
    const { app, reporters } = setup(null);
    const res = await request(app)
      .post('/api/fleet/hook')
      .send({ session_id: 'hk-1', transcript_path: '/Users/dev/.claude/projects/x/hk-1.jsonl', cwd: '/Users/dev/x', permission_mode: 'default', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-sonnet-5-5' });
    expect(res.status).toBe(200);
    expect(list(reporters)).toMatchObject([{ name: 'Hooks only', version: 'hooks', compat: 'unknown', who: 'Unassigned' }]);
  });

  it('records nothing for a refused report, and keeps the refusal for its address', async () => {
    const { app, reporters } = setup();
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', 'wrong').send(report())).status).toBe(401);
    expect((await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send({ nope: 1 })).status).toBe(400);
    expect(list(reporters)).toHaveLength(0);
    await request(app).post('/api/fleet/report').set('X-Podium-Token', 'admin-secret').send(report());
    const d = reporters.get(list(reporters)[0]!.key, Date.now())!;
    expect(d.rejected.map((x) => x.reason)[1]).toBe('wrong token');
    expect(d.rejected).toHaveLength(2);
  });
});
