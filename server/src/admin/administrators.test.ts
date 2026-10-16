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

const unlockWith = (_app: express.Express, agent: ReturnType<typeof request.agent>, name: string, token: string) => agent.post('/api/admin/unlock').set(H).send({ name, token });

describe('the Administrators group', () => {
  it('exists on a fresh server and is marked built in', () => {
    const { people, admins } = setup();
    expect(admins).toBeDefined();
    expect(people.listGroups({}).rows.find((g) => g.id === admins!.id)?.builtIn).toBe(true);
  });

  it('cannot be deleted, and says why', async () => {
    const { app, admins, people } = setup();
    const agent = request.agent(app);
    await unlockWith(app, agent, 'Admin', SECRET);
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
    expect((await unlockWith(app, agent, 'Priya', token)).status).toBe(200);
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
    await unlockWith(app, agent, 'Admin', SECRET);
    await agent.post('/api/admin/groups').set(H).send({ name: 'Backend' });
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'group_created')?.actor).toBe('Admin secret');
  });

  it('refuses a person outside the group, a revoked token and an unknown token, never saying which part was wrong', async () => {
    const { app, people, admins } = setup();
    const outsider = people.createPerson('Dana', null);
    const revoked = people.createPerson('Lee', admins!.id);
    people.revoke(revoked.person.id);
    const unknown = people.createPerson('Tmp', admins!.id).token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const tries: [string, string][] = [['Dana', outsider.token], ['Lee', revoked.token], ['Tmp', unknown]];
    for (const [name, t] of tries) {
      const res = await unlockWith(app, request.agent(app), name, t);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('wrong name or token');
    }
  });

  it('counts refused tokens toward the same lockout', async () => {
    const { app, people } = setup();
    const { token } = people.createPerson('Dana', null);
    for (let i = 0; i < 5; i++) expect((await unlockWith(app, request.agent(app), 'Dana', token)).status).toBe(401);
    expect((await unlockWith(app, request.agent(app), 'Admin', SECRET)).status).toBe(429);
  });

  it('needs the person\'s own name with the token, in any letter case', async () => {
    const { app, people, admins } = setup();
    const { token } = people.createPerson('Priya', admins!.id);
    const wrong = await unlockWith(app, request.agent(app), 'Dana', token);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('wrong name or token');
    expect((await unlockWith(app, request.agent(app), '  priya ', token)).status).toBe(200);
  });

  it('takes the admin secret only with the name Admin', async () => {
    const { app } = setup();
    expect((await unlockWith(app, request.agent(app), 'Priya', SECRET)).status).toBe(401);
    expect((await unlockWith(app, request.agent(app), 'admin', SECRET)).status).toBe(200);
  });

  it('refuses a token alone, or a name alone, with a 400', async () => {
    const { app, people, admins } = setup();
    const { token } = people.createPerson('Priya', admins!.id);
    expect((await request(app).post('/api/admin/unlock').set(H).send({ secret: SECRET })).status).toBe(400);
    expect((await request(app).post('/api/admin/unlock').set(H).send({ token })).status).toBe(400);
    expect((await request(app).post('/api/admin/unlock').set(H).send({ name: 'Priya' })).status).toBe(400);
  });

  it('does not let an ordinary person reach any Admin route after a refused sign-in', async () => {
    const { app, people } = setup();
    const { token } = people.createPerson('Dana', null);
    const agent = request.agent(app);
    expect((await unlockWith(app, agent, 'Dana', token)).status).toBe(401);
    for (const path of ['/api/admin/people', '/api/admin/groups', '/api/admin/settings']) expect((await agent.get(path).set(H)).status).toBe(401);
  });

  it('ends the open session when the person leaves the group', async () => {
    const { app, people, admins } = setup();
    const { person, token } = people.createPerson('Priya', admins!.id);
    const agent = request.agent(app);
    await unlockWith(app, agent, 'Priya', token);
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(200);
    people.setGroup(person.id, null);
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(401);
  });

  it('ends the open session when the token is revoked', async () => {
    const { app, people, admins } = setup();
    const { person, token } = people.createPerson('Priya', admins!.id);
    const agent = request.agent(app);
    await unlockWith(app, agent, 'Priya', token);
    people.revoke(person.id);
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(401);
  });
});

describe('who is recorded', () => {
  it('still names an administrator whose own change ends their session', async () => {
    const { app, people, admins } = setup();
    const { person, token } = people.createPerson('Priya', admins!.id);
    const agent = request.agent(app);
    await unlockWith(app, agent, 'Priya', token);
    expect((await agent.put(`/api/admin/people/${person.id}/group`).set(H).send({ groupId: null })).status).toBe(200);
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'group_assigned')?.actor).toBe('Priya');
    expect((await agent.get('/api/admin/groups').set(H)).status).toBe(401);
  });

  it('keeps the name "Admin secret" for the secret, so no person can take it', () => {
    const { people } = setup();
    expect(() => people.createPerson('Admin secret')).toThrow(/reserved/);
    expect(() => people.createPerson('admin SECRET')).toThrow(/reserved/);
  });
});
