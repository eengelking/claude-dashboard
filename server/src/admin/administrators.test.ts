// The built-in Administrators group (issue #172): a person in it can open Admin with their own token.
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
const H = { 'X-Podium-Admin': '1' };

function setup() {
  const db = openDb(':memory:');
  const people = new PeopleStore(db);
  const clock = { t: 1_000_000 };
  const app = express();
  app.use(
    '/api/admin',
    createAdminRouter({
      secret: SECRET,
      people,
      wall: new WallSettings(db),
      prices: new ModelPriceStore(db),
      features: new FeatureFlags(db),
      reporters: new ReporterStore(db, 0),
      now: () => clock.t,
      log: () => undefined,
    }),
  );
  const admins = people.allGroups().find((g) => g.name === 'Administrators');
  return { app, people, clock, admins };
}

const unlockWith = (app: express.Express, agent: ReturnType<typeof request.agent>, value: string) => agent.post('/api/admin/unlock').set(H).send({ secret: value });

describe('the Administrators group', () => {
  it('exists on a fresh server and is marked built in', () => {
    const { people, admins } = setup();
    expect(admins).toBeDefined();
    expect(people.listGroups({}).rows.find((g) => g.id === admins!.id)?.builtIn).toBe(true);
  });

  it('cannot be deleted, and says why', async () => {
    const { app, admins, people } = setup();
    const agent = request.agent(app);
    await unlockWith(app, agent, SECRET);
    const res = await agent.delete(`/api/admin/groups/${admins!.id}`).set(H);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/built in/i);
    expect(people.getGroup(admins!.id)).toBeDefined();
  });
});

describe('unlocking Admin with a person token', () => {
  it("opens Admin for a member, and the admin log names the person", async () => {
    const { app, people, admins } = setup();
    const { person, token } = people.createPerson('Priya', admins!.id);
    const agent = request.agent(app);
    expect((await unlockWith(app, agent, token)).status).toBe(200);
    expect((await agent.get('/api/admin/people').set(H)).status).toBe(200);
    expect((await agent.post('/api/admin/groups').set(H).send({ name: 'Backend' })).status).toBe(201);
    const log = people.listLog({ page: 1, pageSize: 50 }).rows;
    expect(log.find((r) => r.kind === 'group_created')?.actor).toBe('Priya');
    expect(log.find((r) => r.kind === 'unlock')?.actor).toBe('Priya');
    expect(person.id).toBeGreaterThan(0);
  });

  it('names the admin secret as the actor for changes it makes', async () => {
    const { app, people } = setup();
    const agent = request.agent(app);
    await unlockWith(app, agent, SECRET);
    await agent.post('/api/admin/groups').set(H).send({ name: 'Backend' });
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'group_created')?.actor).toBe('Admin secret');
  });

  it('refuses a person outside the group, a revoked token and an unknown token with the wrong-secret answer', async () => {
    const { app, people, admins } = setup();
    const outsider = people.createPerson('Dana', null);
    const revoked = people.createPerson('Lee', admins!.id);
    people.revoke(revoked.person.id);
    const unknown = people.createPerson('Tmp', admins!.id).token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    for (const t of [outsider.token, revoked.token, unknown]) {
      const res = await unlockWith(app, request.agent(app), t);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('wrong secret');
    }
  });

  it('counts refused tokens toward the same lockout', async () => {
    const { app, people } = setup();
    const { token } = people.createPerson('Dana', null);
    for (let i = 0; i < 5; i++) expect((await unlockWith(app, request.agent(app), token)).status).toBe(401);
    expect((await unlockWith(app, request.agent(app), SECRET)).status).toBe(429);
  });

  it('ends the open session when the person leaves the group', async () => {
    const { app, people, admins } = setup();
    const { person, token } = people.createPerson('Priya', admins!.id);
    const agent = request.agent(app);
    await unlockWith(app, agent, token);
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(200);
    people.setGroup(person.id, null);
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(401);
  });

  it('ends the open session when the token is revoked', async () => {
    const { app, people, admins } = setup();
    const { person, token } = people.createPerson('Priya', admins!.id);
    const agent = request.agent(app);
    await unlockWith(app, agent, token);
    people.revoke(person.id);
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(401);
  });
});
