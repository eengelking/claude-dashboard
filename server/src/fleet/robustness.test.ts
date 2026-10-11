// T4.3.1: junk never crashes the server and gets a 4xx; the server keeps serving afterwards.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { createFleetRouter } from './routes.js';
import { fixtureReport } from './testing.js';

function app() {
  const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/', dbPath: ':memory:' });
  const a = express();
  a.use('/api/fleet', createFleetRouter(fleet, { log: () => {} }));
  return { a, fleet };
}

const post = (a: express.Express, body: string | Buffer, type = 'application/json') =>
  request(a).post('/api/fleet/report').set('Content-Type', type).send(body);

describe('junk input', () => {
  it('malformed JSON, raw control characters, a 1 MB body and 5,000 agents all get a 4xx', async () => {
    const { a, fleet } = app();
    const cases: [string, string | Buffer][] = [
      ['truncated JSON', '{"v":1,"session":'],
      ['not JSON', 'hello'],
      ['raw control characters inside a string', `{"v":1,"x":"a\u0001b"}`],
      ['a 1 MB body', JSON.stringify({ ...fixtureReport(), pad: 'x'.repeat(1024 * 1024) })],
      ['5,000 agents', JSON.stringify({ ...fixtureReport(), agents: Array.from({ length: 5000 }, (_, i) => ({ id: `a${i}` })) })],
      ['an array', '[]'],
      ['null', 'null'],
      ['deeply nested', '['.repeat(5000) + ']'.repeat(5000)],
    ];
    for (const [name, body] of cases) {
      const res = await post(a, body);
      expect(res.status, name).toBeGreaterThanOrEqual(400);
      expect(res.status, name).toBeLessThan(500);
    }
    // the server is still fine
    expect((await request(a).post('/api/fleet/report').send(fixtureReport())).status).toBe(200);
    expect((await request(a).get('/api/fleet/state')).status).toBe(200);
    fleet.close();
  });

  it('invalid UTF-8 never crashes it, and escaped control characters are stripped', async () => {
    const { a, fleet } = app();
    const r = fixtureReport();
    const json = JSON.stringify({ ...r, session: { ...r.session, name: 'NAME_HERE' } });
    const [head, tail] = json.split('NAME_HERE') as [string, string];
    const bad = Buffer.concat([Buffer.from(head), Buffer.from([0xc3, 0x28, 0xff, 0xfe]), Buffer.from(tail)]);
    const res = await post(a, bad);
    expect(res.status).toBeLessThan(500);
    const esc = await request(a)
      .post('/api/fleet/report')
      .send({ ...r, agents: [{ ...r.agents[0]!, description: 'red \u001b[31mtext\u0007' }] });
    expect(esc.status).toBe(200);
    const view = (await request(a).get(`/api/fleet/sessions/${r.session.id}`)).body;
    expect(view.agents.find((x: { id: string }) => x.id === 'a1').description).toBe('red  [31mtext ');
    expect((await request(a).get('/api/fleet/state')).status).toBe(200);
    fleet.close();
  });

  it('a wrong content type is a 400, not a crash', async () => {
    const { a, fleet } = app();
    expect((await post(a, 'v=1', 'application/x-www-form-urlencoded')).status).toBe(400);
    expect((await post(a, JSON.stringify(fixtureReport()), 'text/plain')).status).toBe(400);
    fleet.close();
  });
});
