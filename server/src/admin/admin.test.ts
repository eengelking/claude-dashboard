// The Admin API (issue #36): who may open it, what it does, and what it never reveals.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb } from '../fleet/db.js';
import { PeopleStore } from '../fleet/people.js';
import { WallSettings } from '../fleet/wallSettings.js';
import { ModelPriceStore } from '../fleet/modelPrices.js';
import { createAdminRouter } from './adminRouter.js';

const SECRET = 'the-admin-secret-0123456789';

function setup(over: { secret?: string | null; idleMs?: number } = {}) {
  const db = openDb(':memory:');
  const people = new PeopleStore(db);
  const wall = new WallSettings(db);
  const prices = new ModelPriceStore(db);
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
      now: () => clock.t,
      idleMs: over.idleMs,
      log: (l) => lines.push(l),
    }),
  );
  return { app, people, wall, prices, clock, lines };
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
    for (const [m, p] of [['get', '/people'], ['post', '/people'], ['get', '/groups'], ['get', '/log'], ['get', '/settings']] as const) {
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
    expect((await agent.get('/api/admin/session').set(H)).body).toEqual({ unlocked: true, enabled: true });
    expect((await request(setup().app).get('/api/admin/session').set(H)).body).toEqual({ unlocked: false, enabled: true });
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
    expect(created.body.person).toMatchObject({ name: 'Dana', last4: token.slice(-4) });
    const listed = await agent.get('/api/admin/people').set(H);
    expect(JSON.stringify(listed.body)).not.toContain(token);
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
    expect((await agent.get('/api/admin/groups').set(H)).body.rows[0]).toMatchObject({ name: 'Frontend', members: ['Dana'] });
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
