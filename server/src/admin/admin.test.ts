// The Admin API (issue #36): who may open it, what it does, and what it never reveals.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '../fleet/db.js';
import { PeopleStore } from '../fleet/people.js';
import { ReporterStore } from '../fleet/reporters.js';
import { WallSettings } from '../fleet/wallSettings.js';
import { ModelPriceStore } from '../fleet/modelPrices.js';
import { FeatureFlags } from '../fleet/featureFlags.js';
import { createAdminRouter } from './adminRouter.js';

const SECRET = 'the-admin-secret-0123456789';

function setup(over: { secret?: string | null; idleMs?: number } = {}) {
  const db = openDb(':memory:');
  const people = new PeopleStore(db);
  const wall = new WallSettings(db);
  const prices = new ModelPriceStore(db);
  const features = new FeatureFlags(db);
  const reporters = new ReporterStore(db, 0);
  const clock = { t: 1_000_000 };
  const lines: string[] = [];
  const app = express();
  app.use(
    '/api/admin',
    createAdminRouter({
      secret: over.secret === undefined ? SECRET : over.secret,
      people,
      wall,
      prices,
      features,
      reporters,
      now: () => clock.t,
      idleMs: over.idleMs,
      log: (l) => lines.push(l),
    }),
  );
  return { app, people, wall, prices, features, reporters, clock, lines };
}

const H = { 'X-Podium-Admin': '1' };

async function unlocked(over: Parameters<typeof setup>[0] = {}) {
  const s = setup(over);
  const agent = request.agent(s.app);
  const res = await agent.post('/api/admin/unlock').set(H).send({ secret: SECRET });
  expect(res.status).toBe(200);
  return { ...s, agent };
}

describe('unlocking', () => {
  it('refuses every other endpoint until unlocked, and the right secret unlocks with an HttpOnly SameSite=Strict cookie', async () => {
    const { app } = setup();
    for (const [m, p] of [['get', '/people'], ['post', '/people'], ['get', '/groups'], ['get', '/log'], ['get', '/settings'], ['get', '/reporters'], ['get', '/reporters/x'], ['delete', '/reporters/x']] as const) {
      expect((await request(app)[m](`/api/admin${p}`).set(H)).status).toBe(401);
    }
    const res = await request(app).post('/api/admin/unlock').set(H).send({ secret: SECRET });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('rejects a wrong secret and logs it without the secret', async () => {
    const { app, people, lines } = setup();
    const res = await request(app).post('/api/admin/unlock').set(H).send({ secret: 'wrong-guess-value' });
    expect(res.status).toBe(401);
    const log = people.listLog({ page: 1, pageSize: 50 }).rows;
    expect(log.map((r) => r.kind)).toEqual(['unlock_failed']);
    expect(JSON.stringify(log) + lines.join('')).not.toContain('wrong-guess-value');
  });

  it('locks after 5 wrong tries for 15 minutes, even for the right secret, then lets it through', async () => {
    const { app, clock, people } = setup();
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/admin/unlock').set(H).send({ secret: 'nope' + i })).status).toBe(401);
    }
    const locked = await request(app).post('/api/admin/unlock').set(H).send({ secret: SECRET });
    expect(locked.status).toBe(429);
    expect(locked.body.retryAfterSec).toBeGreaterThan(0);
    expect(people.listLog({ page: 1, pageSize: 100 }).rows.filter((r) => r.kind === 'unlock_failed')).toHaveLength(5);
    clock.t += 15 * 60_000 + 1;
    expect((await request(app).post('/api/admin/unlock').set(H).send({ secret: SECRET })).status).toBe(200);
  });

  it('is off when the server runs without a token', async () => {
    const { app } = setup({ secret: null });
    expect((await request(app).post('/api/admin/unlock').set(H).send({ secret: '' })).status).toBe(403);
    expect((await request(app).get('/api/admin/people').set(H)).status).toBe(403);
  });

  it('ends a session after the idle timeout and on lock', async () => {
    const { agent, clock } = await unlocked({ idleMs: 10 * 60_000 });
    clock.t += 9 * 60_000;
    expect((await agent.get('/api/admin/people').set(H)).status).toBe(200); // activity resets the timer
    clock.t += 9 * 60_000;
    expect((await agent.get('/api/admin/people').set(H)).status).toBe(200);
    clock.t += 11 * 60_000;
    expect((await agent.get('/api/admin/people').set(H)).status).toBe(401);
    const b = await unlocked();
    expect((await b.agent.post('/api/admin/lock').set(H)).status).toBe(200);
    expect((await b.agent.get('/api/admin/people').set(H)).status).toBe(401);
  });

  it('reports whether this browser is unlocked', async () => {
    const { agent } = await unlocked();
    expect((await agent.get('/api/admin/session').set(H)).body).toEqual({ unlocked: true, enabled: true, version: expect.any(String) });
    expect((await request(setup().app).get('/api/admin/session').set(H)).body).toEqual({ unlocked: false, enabled: true, version: expect.any(String) });
  });
});

describe('cross-site protection and caching', () => {
  it('refuses a change without the Admin header, or from another origin', async () => {
    const { agent, people } = await unlocked();
    expect((await agent.post('/api/admin/people').send({ name: 'Dana' })).status).toBe(403);
    expect((await agent.post('/api/admin/people').set(H).set('Origin', 'https://evil.example').send({ name: 'Dana' })).status).toBe(403);
    expect(people.list({ page: 1, pageSize: 50, q: '' }).total).toBe(0);
    expect((await agent.post('/api/admin/people').set(H).send({ name: 'Dana' })).status).toBe(201);
  });

  it('sends Cache-Control: no-store on every response', async () => {
    const { agent, app } = await unlocked();
    expect((await agent.get('/api/admin/people').set(H)).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/admin/people').set(H)).headers['cache-control']).toBe('no-store');
  });
});

describe('people and tokens', () => {
  it('creates a person, shows the token once, never again, and logs without the token', async () => {
    const { agent, people, lines } = await unlocked();
    const created = await agent.post('/api/admin/people').set(H).send({ name: 'Dana' });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^pdm_/);
    // The list names a token by its key id, `pdm_<key id>`, as Reporters does (#218); no part of the secret.
    const keyId = /^pdm_([0-9a-f]{12})_/.exec(token)![1];
    expect(created.body.person).toMatchObject({ name: 'Dana', credential: `pdm_${keyId}` });
    expect(created.body.person).not.toHaveProperty('last4');
    const listed = await agent.get('/api/admin/people').set(H);
    expect(JSON.stringify(listed.body)).not.toContain(token);
    expect(listed.body.rows[0]).toMatchObject({ credential: `pdm_${keyId}` });
    expect(listed.body.rows[0]).not.toHaveProperty('last4');
    expect(JSON.stringify(listed.body)).not.toMatch(/tokenHash|token_hash|keyId/);
    expect(JSON.stringify(people.listLog({ page: 1, pageSize: 50 })) + lines.join('')).not.toContain(token);
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((r) => r.kind)).toContain('person_created');
  });

  it('refuses a duplicate name (any case) with 409 and a bad name with 400', async () => {
    const { agent } = await unlocked();
    await agent.post('/api/admin/people').set(H).send({ name: 'Dana' });
    expect((await agent.post('/api/admin/people').set(H).send({ name: 'dana' })).status).toBe(409);
    expect((await agent.post('/api/admin/people').set(H).send({ name: '' })).status).toBe(400);
    expect((await agent.post('/api/admin/people').set(H).send({})).status).toBe(400);
  });

  it('rotates (new token, old one dead) and revokes, each logged with the source address', async () => {
    const { agent, people } = await unlocked();
    const a = await agent.post('/api/admin/people').set(H).send({ name: 'Dana' });
    const id = a.body.person.id as number;
    const r = await agent.post(`/api/admin/people/${id}/rotate`).set(H);
    expect(r.status).toBe(200);
    expect(r.body.token).not.toBe(a.body.token);
    expect((await agent.post(`/api/admin/people/${id}/revoke`).set(H)).status).toBe(200);
    expect((await agent.post('/api/admin/people/999/revoke').set(H)).status).toBe(404);
    expect((await agent.post('/api/admin/people/abc/rotate').set(H)).status).toBe(400);
    const kinds = people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['unlock', 'person_created', 'token_rotated', 'token_revoked']));
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.every((x) => x.source.length > 0)).toBe(true);
  });

  it('pages on the server (default 50, at most 100), searches, and reports the total', async () => {
    const { agent, people } = await unlocked();
    for (let i = 0; i < 125; i++) people.createPerson(`person-${String(i).padStart(3, '0')}`);
    const p1 = await agent.get('/api/admin/people').set(H);
    expect(p1.body).toMatchObject({ total: 125, page: 1, pageSize: 50 });
    expect(p1.body.rows).toHaveLength(50);
    expect((await agent.get('/api/admin/people?page=3').set(H)).body.rows).toHaveLength(25);
    expect((await agent.get('/api/admin/people?pageSize=1000').set(H)).body.rows).toHaveLength(100);
    expect((await agent.get('/api/admin/people?q=person-099').set(H)).body.total).toBe(1);
  });
});

describe('groups and settings', () => {
  it('creates, assigns, deletes a group (people stay) and logs each change', async () => {
    const { agent, people } = await unlocked();
    const g = await agent.post('/api/admin/groups').set(H).send({ name: 'Frontend' });
    expect(g.status).toBe(201);
    expect((await agent.post('/api/admin/groups').set(H).send({ name: 'frontend' })).status).toBe(409);
    expect((await agent.post('/api/admin/groups').set(H).send({ name: 'x'.repeat(25) })).status).toBe(400);
    const p = await agent.post('/api/admin/people').set(H).send({ name: 'Dana' });
    expect((await agent.put(`/api/admin/people/${p.body.person.id}/group`).set(H).send({ groupId: g.body.id })).status).toBe(200);
    expect((await agent.put(`/api/admin/people/${p.body.person.id}/group`).set(H).send({ groupId: 999 })).status).toBe(404);
    expect((await agent.get('/api/admin/groups').set(H)).body.rows.find((r: { name: string }) => r.name === 'Frontend')).toMatchObject({ members: ['Dana'] });
    expect((await agent.delete(`/api/admin/groups/${g.body.id}`).set(H)).status).toBe(200);
    expect((await agent.get('/api/admin/people').set(H)).body.rows[0]).toMatchObject({ name: 'Dana', groupId: null });
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).toEqual(
      expect.arrayContaining(['group_created', 'group_assigned', 'group_deleted']),
    );
  });

  it('switches admin-secret reporting and logs it', async () => {
    const { agent, people } = await unlocked();
    expect((await agent.get('/api/admin/settings').set(H)).body).toMatchObject({ allowAdminSecretReporting: true });
    expect((await agent.put('/api/admin/settings').set(H).send({ allowAdminSecretReporting: false })).status).toBe(200);
    expect(people.adminReportingAllowed()).toBe(false);
    expect((await agent.put('/api/admin/settings').set(H).send({ allowAdminSecretReporting: 'yes' })).status).toBe(400);
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).toContain('admin_reporting_changed');
  });

  it('lists the wall notices with their switches and changes them, the background-sessions setting and nothing unknown', async () => {
    const { agent, people, wall } = await unlocked();
    const got = (await agent.get('/api/admin/settings').set(H)).body;
    expect(got.showBackgroundSessions).toBe(false);
    expect(got.notices).toEqual([expect.objectContaining({ id: 'background-sessions', name: 'Background sessions', on: true })]);
    expect((await agent.put('/api/admin/settings').set(H).send({ notices: { 'background-sessions': false } })).status).toBe(200);
    expect(wall.noticeOn('background-sessions')).toBe(false);
    expect((await agent.put('/api/admin/settings').set(H).send({ showBackgroundSessions: true })).status).toBe(200);
    expect(wall.showBackgroundSessions()).toBe(true);
    for (const bad of [{ notices: { nope: true } }, { notices: { 'background-sessions': 'off' } }, { notices: {} }, { showBackgroundSessions: 1 }, {}]) {
      expect((await agent.put('/api/admin/settings').set(H).send(bad)).status).toBe(400);
    }
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).toEqual(expect.arrayContaining(['wall_notice_changed', 'wall_background_changed']));
  });

  describe('feature flags (#118)', () => {
    it('refuses the flags before unlocking', async () => {
      const { app } = setup();
      expect((await request(app).put('/api/admin/settings').set(H).send({ features: { 'activity-feed': false } })).status).toBe(401);
    });

    it('lists each flag with its name, description and switch, each at its default', async () => {
      const { agent } = await unlocked();
      const got = (await agent.get('/api/admin/settings').set(H)).body;
      expect(got.features).toEqual([
        {
          id: 'activity-feed',
          name: 'Agent activity feed',
          description: expect.stringContaining("Shows an agent's recent tool calls and text in its panel while someone watches."),
          on: true,
        },
        {
          id: 'respond',
          name: 'Respond from Podium',
          description: 'Lets people answer and message the sessions they own. Each answer is written to the admin log with who sent it.',
          on: false,
        },
      ]);
    });

    it('turns Respond from Podium on and logs it (#206)', async () => {
      const { agent, features, people } = await unlocked();
      const res = await agent.put('/api/admin/settings').set(H).send({ features: { respond: true } });
      expect(res.status).toBe(200);
      expect(features.featureOn('respond')).toBe(true);
      const log = people.listLog({ page: 1, pageSize: 50 }).rows.filter((x) => x.kind === 'feature_changed');
      expect(log.map((x) => x.detail)).toEqual(['Feature respond turned on']);
    });

    it('turns a flag off and on, and logs each change', async () => {
      const { agent, features, people } = await unlocked();
      const res = await agent.put('/api/admin/settings').set(H).send({ features: { 'activity-feed': false } });
      expect(res.status).toBe(200);
      expect(res.body.features).toEqual([expect.objectContaining({ id: 'activity-feed', on: false }), expect.objectContaining({ id: 'respond', on: false })]);
      expect(features.featureOn('activity-feed')).toBe(false);
      expect((await agent.get('/api/admin/settings').set(H)).body.features[0].on).toBe(false);
      await agent.put('/api/admin/settings').set(H).send({ features: { 'activity-feed': true } });
      expect(features.featureOn('activity-feed')).toBe(true);
      const log = people.listLog({ page: 1, pageSize: 50 }).rows.filter((x) => x.kind === 'feature_changed');
      expect(log.map((x) => x.detail)).toEqual(['Feature activity-feed turned on', 'Feature activity-feed turned off']);
    });

    it.each([
      ['an unknown id', { features: { nope: false } }],
      ['a value that is not a boolean', { features: { 'activity-feed': 'off' } }],
      ['an empty map', { features: {} }],
      ['a list', { features: ['activity-feed'] }],
    ])('rejects %s and changes nothing', async (_n, body) => {
      const { agent, features, people } = await unlocked();
      expect((await agent.put('/api/admin/settings').set(H).send(body)).status).toBe(400);
      expect(features.featureOn('activity-feed')).toBe(true);
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).not.toContain('feature_changed');
    });
  });

  describe('model prices (#117)', () => {
    const S = { input: 3, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 };
    const put = (agent: Awaited<ReturnType<typeof unlocked>>['agent'], body: unknown) => agent.put('/api/admin/settings').set(H).send(body as object);

    it('lists every built-in row with its price, and refuses it before unlocking', async () => {
      const { app } = setup();
      expect((await request(app).get('/api/admin/settings').set(H)).status).toBe(401);
      const { agent } = await unlocked();
      const v = (await agent.get('/api/admin/settings').set(H)).body.modelPrices;
      expect(v.asOf).toBe('2026-10-13');
      expect(v.models.find((m: { key: string }) => m.key === 'sonnet-5-5')).toMatchObject({ builtin: true, overridden: false, std: { input: 2, output: 10 } });
    });

    it('saves a price, applies it, and logs it', async () => {
      const { agent, prices, people } = await unlocked();
      const res = await put(agent, { modelPrice: { key: 'sonnet-5-5', std: S } });
      expect(res.status).toBe(200);
      expect(res.body.modelPrices.models.find((m: { key: string }) => m.key === 'sonnet-5-5')).toMatchObject({ overridden: true, std: S });
      expect(prices.overrides()['sonnet-5-5']!.std).toEqual(S);
      const log = people.listLog({ page: 1, pageSize: 50 }).rows.find((x) => x.kind === 'model_price_changed')!;
      expect(log.detail).toMatch(/sonnet-5-5/);
    });

    it('saving values equal to the built-in ones changes nothing and logs nothing', async () => {
      const { agent, people } = await unlocked();
      const res = await put(agent, { modelPrice: { key: 'sonnet-5-5', std: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } } });
      expect(res.status).toBe(200);
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).not.toContain('model_price_changed');
    });

    it('resets a row to the built-in price and logs it', async () => {
      const { agent, prices, people } = await unlocked();
      await put(agent, { modelPrice: { key: 'sonnet-5-5', std: S } });
      const res = await put(agent, { resetModelPrice: 'sonnet-5-5' });
      expect(res.status).toBe(200);
      expect(prices.overrides()).toEqual({});
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).toContain('model_price_reset');
    });

    it('adds a model the Admin names', async () => {
      const { agent, prices } = await unlocked();
      expect((await put(agent, { modelPrice: { key: 'my-local-model', std: S } })).status).toBe(200);
      expect(prices.overrides()['my-local-model']!.std).toEqual(S);
    });

    it.each([
      ['a negative price', { key: 'sonnet-5-5', std: { ...S, input: -1 } }],
      ['a string price', { key: 'sonnet-5-5', std: { ...S, output: '10' } }],
      ['a price over the bound', { key: 'sonnet-5-5', std: { ...S, output: 100000 } }],
      ['no std prices', { key: 'sonnet-5-5' }],
      ['no key', { std: S }],
      ['a long tier on a model without one', { key: 'sonnet-5-5', std: S, long: S }],
    ])('rejects %s with a clear error and changes nothing', async (_n, modelPrice) => {
      const { agent, prices, people } = await unlocked();
      const res = await put(agent, { modelPrice });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/\w/);
      expect(prices.overrides()).toEqual({});
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.map((x) => x.kind)).not.toContain('model_price_changed');
    });

    it('rejects a reset with no key', async () => {
      const { agent } = await unlocked();
      expect((await put(agent, { resetModelPrice: 5 })).status).toBe(400);
    });
  });

  it('pages the admin log, newest first', async () => {
    const { agent, people } = await unlocked();
    for (let i = 0; i < 60; i++) people.log('test', `n${i}`, '1.2.3.4');
    const res = await agent.get('/api/admin/log').set(H);
    expect(res.body.total).toBeGreaterThanOrEqual(60);
    expect(res.body.rows).toHaveLength(50);
    expect(res.body.rows[0].detail).toBe('n59');
  });
});

describe('reporters (#142)', () => {
  const seen = (over: Record<string, unknown> = {}) => ({
    kind: 'mod' as const,
    machineId: '9f3a1c7d2e40',
    machineName: 'studio-m2',
    source: '192.168.1.24',
    owner: 'Dana',
    credential: 'pdm_3f9a1c07b2e4',
    version: '0.13.0',
    engineVersion: '2.1.299',
    sessionId: 's1',
    ...over,
  });

  it('lists reporters with the state counts, and takes paging, search, state and sort from the query', async () => {
    const { agent, reporters } = await unlocked();
    const now = Date.now();
    reporters.record(seen(), now);
    reporters.record(seen({ machineId: 'bbbbbbbbbbbb', machineName: 'ci', owner: 'Sam', source: '10.0.0.9' }), now);
    const res = await agent.get('/api/admin/reporters').set(H);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.counts).toMatchObject({ all: 2, reporting: 2 });
    expect((await agent.get('/api/admin/reporters?q=sam').set(H)).body.rows.map((r: { name: string }) => r.name)).toEqual(['ci']);
    expect((await agent.get('/api/admin/reporters?sort=name&dir=1').set(H)).body.rows.map((r: { name: string }) => r.name)).toEqual(['ci', 'studio-m2']);
    expect((await agent.get('/api/admin/reporters?state=silent').set(H)).body.total).toBe(0);
    reporters.record(seen({ machineId: null, machineName: null, owner: 'Admin', credential: 'admin secret', source: '10.0.0.7', sessionId: 'a1' }), now);
    expect((await agent.get('/api/admin/reporters').set(H)).body.adminSecret).toBe(1);
    expect((await agent.get('/api/admin/reporters?admin=1').set(H)).body.rows.map((r: { key: string }) => r.key)).toEqual(['addr:10.0.0.7']);
    expect((await agent.get('/api/admin/reporters?page=2&pageSize=1&sort=name&dir=1&admin=0').set(H)).body.rows).toHaveLength(1);
  });

  it('shows one reporter by key, including an address key, and answers 404 for an unknown one', async () => {
    const { agent, reporters } = await unlocked();
    reporters.record(seen(), Date.now());
    reporters.record(seen({ machineId: null, machineName: null, source: '::1' }), Date.now());
    const d = await agent.get('/api/admin/reporters/9f3a1c7d2e40').set(H);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ name: 'studio-m2', credential: 'pdm_3f9a1c07b2e4', source: '192.168.1.24' });
    expect((await agent.get(`/api/admin/reporters/${encodeURIComponent('addr:::1')}`).set(H)).status).toBe(200);
    expect(d.body).toMatchObject({ recentTotal: 0, recentPage: 1, recentPageSize: 50 });
    expect((await agent.get('/api/admin/reporters/9f3a1c7d2e40?page=3&pageSize=50').set(H)).body).toMatchObject({ recentPage: 3, recentPageSize: 50 });
    expect((await agent.get('/api/admin/reporters/nope').set(H)).status).toBe(404);
    expect((await agent.get('/api/admin/reporters/' + 'x'.repeat(200)).set(H)).status).toBe(400);
  });

  it('removes a reporter, writes it to the admin log, and refuses a write without the Admin header', async () => {
    const { agent, reporters, people } = await unlocked();
    reporters.record(seen(), Date.now());
    expect((await agent.delete('/api/admin/reporters/9f3a1c7d2e40')).status).toBe(403);
    expect(reporters.list({}, Date.now()).total).toBe(1);
    expect((await agent.delete('/api/admin/reporters/9f3a1c7d2e40').set(H)).status).toBe(200);
    expect(reporters.list({}, Date.now()).total).toBe(0);
    expect((await agent.delete('/api/admin/reporters/9f3a1c7d2e40').set(H)).status).toBe(404);
    const log = people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'reporter_removed');
    expect(log?.detail).toContain('studio-m2');
  });
  it('removes many reporters at once, by key or by state, and logs one entry with the count (issue #167)', async () => {
    const { agent, reporters, people, clock } = await unlocked();
    for (const k of ['aaaa', 'bbbb', 'cccc']) reporters.record(seen({ machineId: k, machineName: k, sessionId: k }), clock.t);
    expect((await agent.post('/api/admin/reporters/remove').send({ keys: ['aaaa'] })).status).toBe(403);
    expect((await agent.post('/api/admin/reporters/remove').set(H).send({})).status).toBe(400);
    expect((await agent.post('/api/admin/reporters/remove').set(H).send({ keys: [] })).status).toBe(400);
    expect((await agent.post('/api/admin/reporters/remove').set(H).send({ keys: Array.from({ length: 501 }, (_, i) => `k${i}`) })).status).toBe(400);
    const res = await agent.post('/api/admin/reporters/remove').set(H).send({ keys: ['aaaa', 'bbbb', 'nope'] });
    expect(res.body).toEqual({ ok: true, removed: 2 });
    expect(reporters.list({}, clock.t).rows.map((r) => r.key)).toEqual(['cccc']);
    const byState = await agent.post('/api/admin/reporters/remove').set(H).send({ state: 'reporting' });
    expect(byState.body).toEqual({ ok: true, removed: 1 });
    // A filter removes every reporter it holds, not one page of them.
    for (const k of ['dd1', 'dd2', 'ee1']) reporters.record(seen({ machineId: k, machineName: k, sessionId: k }), clock.t);
    expect((await agent.post('/api/admin/reporters/remove').set(H).send({ match: { q: 'zzz' } })).body).toEqual({ ok: true, removed: 0 });
    expect((await agent.post('/api/admin/reporters/remove').set(H).send({ match: { q: 'dd' } })).body).toEqual({ ok: true, removed: 2 });
    expect(reporters.list({}, clock.t).rows.map((r) => r.key)).toEqual(['ee1']);
    expect((await agent.post('/api/admin/reporters/remove').set(H).send({ match: 'all' })).status).toBe(400);
    reporters.removeMany(['ee1']);
    const log = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'reporter_removed');
    expect(log.map((r) => r.detail)).toEqual([expect.stringContaining('2 reporters'), expect.stringContaining('0 reporters'), expect.stringContaining('1 reporter'), expect.stringContaining('2 reporters')]);
  });

  it('keeps ignore rules: add, list, remove, and log each (issue #167)', async () => {
    const { agent, reporters, people } = await unlocked();
    reporters.record(seen(), Date.now());
    expect((await agent.post('/api/admin/reporters/ignores').send({ kind: 'key', pattern: 'x' })).status).toBe(403);
    expect((await agent.post('/api/admin/reporters/ignores').set(H).send({ kind: 'who', pattern: 'x' })).status).toBe(400);
    expect((await agent.post('/api/admin/reporters/ignores').set(H).send({ kind: 'key', pattern: '' })).status).toBe(400);
    const add = await agent.post('/api/admin/reporters/ignores').set(H).send({ kind: 'key', pattern: '9f3a1c7d2e40' });
    expect(add.status).toBe(200);
    expect(reporters.list({}, Date.now()).total).toBe(0);
    const l = await agent.get('/api/admin/reporters/ignores').set(H);
    expect(l.body.rules).toEqual([expect.objectContaining({ id: add.body.rule.id, kind: 'key', pattern: '9f3a1c7d2e40' })]);
    expect((await agent.delete(`/api/admin/reporters/ignores/${add.body.rule.id}`).set(H)).status).toBe(200);
    expect((await agent.delete(`/api/admin/reporters/ignores/${add.body.rule.id}`).set(H)).status).toBe(404);
    const kinds = people.listLog({ page: 1, pageSize: 50 }).rows.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['reporter_ignore_added', 'reporter_ignore_removed']));
  });

  it('shows and changes the forget-by-age setting (issue #167)', async () => {
    const { agent, reporters, people } = await unlocked();
    expect((await agent.get('/api/admin/settings').set(H)).body.forgetReporters).toEqual({ enabled: false, days: 30 });
    expect((await agent.put('/api/admin/settings').set(H).send({ forgetReporters: { enabled: true, days: 0 } })).status).toBe(400);
    expect((await agent.put('/api/admin/settings').set(H).send({ forgetReporters: { enabled: 'yes' } })).status).toBe(400);
    const ok = await agent.put('/api/admin/settings').set(H).send({ forgetReporters: { enabled: true, days: 14 } });
    expect(ok.body).toEqual({ ok: true, forgetReporters: { enabled: true, days: 14 } });
    expect(reporters.forgetSetting()).toEqual({ enabled: true, days: 14 });
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.some((r) => r.kind === 'reporters_forget_changed')).toBe(true);
  });
});
