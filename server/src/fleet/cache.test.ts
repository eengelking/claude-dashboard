// The prompt cache (issue #27): warm, cooling and cold from what the reporter says about the main thread's
// last request, the cooling alert, and the counter that shows the cache-warming tip twice and then stops.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { configFromEnv, DEFAULT_CONFIG, Fleet, type FleetConfig } from './fleet.js';
import { createFleetRouter } from './routes.js';
import { validateReport, type CacheReport, type Report, type StateBody } from './protocol.js';
import { fixtureReport, loadFixture } from './testing.js';

const T0 = 1_791_648_000_000;
const CFG: FleetConfig = { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' };
const MIN = 60_000;

let clock = T0;
let db: FleetDb;
const fleets: Fleet[] = [];
beforeEach(() => {
  clock = T0;
  db = new FleetDb(openDb(':memory:'));
});
afterEach(() => {
  for (const f of fleets.splice(0)) f.close();
});

function makeFleet(cfg: Partial<FleetConfig> = {}): Fleet {
  const f = new Fleet(db, { ...CFG, ...cfg }, () => clock);
  fleets.push(f);
  return f;
}

/** An open dashboard: an SSE client that keeps what it is sent. */
function viewer(fleet: Fleet) {
  const msgs: { event: string; data: unknown }[] = [];
  const id = fleet.hub.add({
    write(chunk: string) {
      for (const block of chunk.split('\n\n')) {
        const m = /^event: (\w+)\ndata: (.*)$/s.exec(block);
        if (m) msgs.push({ event: m[1]!, data: JSON.parse(m[2]!) });
      }
    },
  });
  return { msgs, close: () => fleet.hub.remove(id!) };
}

interface Opts {
  id?: string;
  /** The main thread's last request start, in the reporter's clock. */
  last: number | null;
  /** How far the reporter's clock runs ahead of the server's. */
  skewMs?: number;
  warming?: boolean;
  status?: 'running' | 'waiting';
}

function cacheOf(o: Opts): CacheReport {
  return {
    lastRequestAt: o.last,
    ttlMs: 300_000,
    tokens: 410_000,
    coldCostUsd: 1.968,
    warming: { on: !!o.warming, state: o.warming ? 'warming' : 'off', stopReason: null, pings: 0, costUsdEst: 0, lastPingAt: null, untilAt: null },
  };
}

function report(o: Opts): Report {
  const r = fixtureReport();
  const status = o.status ?? 'waiting';
  return {
    ...r,
    sentAt: clock + (o.skewMs ?? 0),
    agents: [],
    events: [],
    session: { ...r.session, id: o.id ?? r.session.id, status, waitReason: status === 'waiting' ? 'input' : null, cache: cacheOf(o) },
  };
}

/** Moves time a second at a time, sweeping each second; the session reports every 5 s, as an idle reporter does. */
function run(fleet: Fleet, ms: number, beat: () => Report | null) {
  const end = clock + ms;
  while (clock < end) {
    clock += 1000;
    if ((clock - T0) % 5000 === 0) {
      const r = beat();
      if (r) fleet.ingest(r);
    }
    fleet.sweep();
  }
}

const SID = 'sess-cache';
const cache = (fleet: Fleet, id = SID) => fleet.view(id)!.cache;

describe('warm, cooling and cold', () => {
  it('counts from the start of the last request in the server clock, whatever the reporter clock says', () => {
    const fleet = makeFleet();
    const skewMs = 30_000;
    const last = clock + skewMs; // the request started just now, as the reporter's clock reads it
    const beat = () => report({ id: SID, last, skewMs });
    fleet.ingest(beat());
    expect(cache(fleet)).toMatchObject({ state: 'warm', expiresAt: T0 + 300_000, ttlMs: 300_000, tokens: 410_000, coldCostUsd: 1.968, alert: null });
    run(fleet, 4 * MIN - 1000, beat);
    expect(cache(fleet)!.state).toBe('warm');
    run(fleet, 1000, beat);
    expect(cache(fleet)!.state).toBe('cooling');
    run(fleet, MIN, beat);
    expect(cache(fleet)!.state).toBe('cold');
  });

  it('a running session is warm: it sends its own requests', () => {
    const fleet = makeFleet();
    const last = clock;
    const beat = () => report({ id: SID, last, status: 'running' });
    fleet.ingest(beat());
    run(fleet, 6 * MIN, beat);
    expect(cache(fleet)).toMatchObject({ state: 'warm', alert: null });
  });

  it('a reporter that sends no cache gives no cache at all', () => {
    const fleet = makeFleet();
    const r = fixtureReport();
    fleet.ingest({ ...r, session: { ...r.session, cache: null } });
    expect(fleet.view(r.session.id)!.cache).toBeNull();
  });

  it('the sweeper sends the session when it starts cooling, and when it goes cold', () => {
    const fleet = makeFleet();
    const v = viewer(fleet);
    const last = clock;
    const beat = () => report({ id: SID, last });
    fleet.ingest(beat());
    run(fleet, 4 * MIN + 1000, beat);
    const states = v.msgs.filter((m) => m.event === 'session').map((m) => (m.data as { cache: { state: string } }).cache.state);
    expect(states).toContain('cooling');
    run(fleet, MIN, beat);
    const after = v.msgs.filter((m) => m.event === 'session').map((m) => (m.data as { cache: { state: string } }).cache.state);
    expect(after.at(-1)).toBe('cold');
  });
});

describe('the cooling alert and its counter', () => {
  /** One idle period that cools: a fresh request now, then 4 minutes of waiting. */
  function coolOnce(fleet: Fleet, id = SID, warming = false) {
    const last = clock;
    const beat = () => report({ id, last, warming });
    fleet.ingest(report({ id, last, status: 'running', warming }));
    fleet.ingest(beat());
    run(fleet, 4 * MIN + 2000, beat);
    return beat;
  }

  it('shows the tip with the first two alerts, then no alert, and the count survives a restart', () => {
    const fleet = makeFleet();
    viewer(fleet);
    expect(fleet.cacheAlerts()).toEqual({ mode: 'auto', shown: 0, suppressed: false });
    coolOnce(fleet);
    expect(cache(fleet)!.alert).toBe('tip');
    expect(fleet.cacheAlerts().shown).toBe(1);
    // more sweeps in the same cooling minute count nothing more
    run(fleet, 10_000, () => null);
    expect(fleet.cacheAlerts().shown).toBe(1);
    coolOnce(fleet);
    expect(cache(fleet)!.alert).toBe('tip');
    expect(fleet.cacheAlerts().shown).toBe(2);
    // the count is for the person, not per session: another session's third alert is not shown
    coolOnce(fleet, 'sess-other');
    expect(cache(fleet, 'sess-other')).toMatchObject({ state: 'cooling', alert: null });
    expect(fleet.cacheAlerts()).toEqual({ mode: 'auto', shown: 2, suppressed: true });
    const again = makeFleet();
    expect(again.cacheAlerts()).toEqual({ mode: 'auto', shown: 2, suppressed: true });
  });

  it('an alert with no dashboard open is not counted; one that is open when it cools counts it', () => {
    const fleet = makeFleet();
    const beat = coolOnce(fleet);
    expect(cache(fleet)!.alert).toBe('tip');
    run(fleet, 20_000, beat);
    expect(fleet.cacheAlerts().shown).toBe(0);
    const v = viewer(fleet);
    fleet.sweep();
    expect(fleet.cacheAlerts().shown).toBe(1);
    v.close();
    coolOnce(fleet);
    expect(fleet.cacheAlerts().shown).toBe(1);
  });

  it('no alert while cache warming is on: the cache is being kept warm', () => {
    const fleet = makeFleet();
    viewer(fleet);
    coolOnce(fleet, SID, true);
    expect(cache(fleet)).toMatchObject({ state: 'cooling', alert: null, warming: { on: true, state: 'warming' } });
    expect(fleet.cacheAlerts().shown).toBe(0);
  });

  it('turning them back on resets the counter and shows the tip again', () => {
    const fleet = makeFleet();
    viewer(fleet);
    coolOnce(fleet);
    coolOnce(fleet);
    coolOnce(fleet);
    expect(cache(fleet)!.alert).toBeNull();
    fleet.resetCacheAlerts();
    expect(fleet.cacheAlerts()).toEqual({ mode: 'auto', shown: 1, suppressed: false });
    expect(cache(fleet)!.alert).toBe('tip');
  });

  it('PODIUM_CACHE_ALERTS=on shows every alert, the tip only twice; off shows none and counts none', () => {
    const on = makeFleet({ cacheAlerts: 'on' });
    viewer(on);
    coolOnce(on);
    coolOnce(on);
    coolOnce(on);
    expect(cache(on)!.alert).toBe('plain');
    expect(on.cacheAlerts()).toEqual({ mode: 'on', shown: 3, suppressed: false });
    db = new FleetDb(openDb(':memory:'));
    const off = makeFleet({ cacheAlerts: 'off' });
    viewer(off);
    coolOnce(off);
    expect(cache(off)).toMatchObject({ state: 'cooling', alert: null });
    expect(off.cacheAlerts()).toEqual({ mode: 'off', shown: 0, suppressed: false });
  });

  it('the state and every tick carry the counter', () => {
    const fleet = makeFleet();
    const v = viewer(fleet);
    expect(fleet.state().cacheAlerts).toEqual({ mode: 'auto', shown: 0, suppressed: false });
    fleet.tick();
    expect(v.msgs.find((m) => m.event === 'tick')!.data).toMatchObject({ cacheAlerts: { mode: 'auto', shown: 0, suppressed: false } });
  });
});

describe('settings and routes', () => {
  it('reads PODIUM_CACHE_ALERTS and CACHE_WARN_MS', () => {
    const base = { home: '/home/node', dbPath: ':memory:' };
    expect(configFromEnv({}, base)).toMatchObject({ cacheAlerts: 'auto', cacheWarnMs: 60_000 });
    expect(configFromEnv({ PODIUM_CACHE_ALERTS: 'ON', CACHE_WARN_MS: '90000' }, base)).toMatchObject({ cacheAlerts: 'on', cacheWarnMs: 90_000 });
    expect(configFromEnv({ PODIUM_CACHE_ALERTS: 'off' }, base).cacheAlerts).toBe('off');
    expect(configFromEnv({ PODIUM_CACHE_ALERTS: 'sometimes' }, base).cacheAlerts).toBe('auto');
  });

  it('POST /cache-alerts/reset turns the alerts back on, without a token', async () => {
    db.setSetting('cache_alerts_shown', '5');
    const fleet = makeFleet();
    const app = express();
    app.use('/api/fleet', createFleetRouter(fleet, { token: 'secret', log: () => {} }));
    const before = await request(app).get('/api/fleet/state');
    expect((before.body as StateBody).cacheAlerts).toEqual({ mode: 'auto', shown: 5, suppressed: true });
    const res = await request(app).post('/api/fleet/cache-alerts/reset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, cacheAlerts: { mode: 'auto', shown: 0, suppressed: false } });
  });
});

describe('validation', () => {
  it('accepts the fixture cache block', () => {
    const r = validateReport(loadFixture());
    expect(r.ok && r.report.session.cache).toEqual({
      lastRequestAt: 1791647990000,
      ttlMs: 300_000,
      tokens: 410_000,
      coldCostUsd: 1.968,
      warming: { on: false, state: 'off', stopReason: null, pings: 0, costUsdEst: 0, lastPingAt: null, untilAt: null },
    });
  });

  it('a reporter older than 0.11.0 sends none: null', () => {
    const f = loadFixture() as { session: Record<string, unknown> };
    delete f.session.cache;
    const r = validateReport(f);
    expect(r.ok && r.report.session.cache).toBeNull();
  });

  it('rejects an unknown warming state or stop reason, and a lifetime that is not positive', () => {
    const bad = (mutate: (c: Record<string, unknown>) => void) => {
      const f = loadFixture() as { session: { cache: Record<string, unknown> } };
      mutate(f.session.cache);
      return validateReport(f);
    };
    expect(bad((c) => ((c.warming as Record<string, unknown>).state = 'boiling'))).toMatchObject({ ok: false, path: '$.session.cache.warming.state' });
    expect(bad((c) => ((c.warming as Record<string, unknown>).stopReason = 'bored'))).toMatchObject({ ok: false, path: '$.session.cache.warming.stopReason' });
    expect(bad((c) => (c.ttlMs = 0))).toMatchObject({ ok: false, path: '$.session.cache.ttlMs' });
    expect(bad((c) => (c.lastRequestAt = 'soon'))).toMatchObject({ ok: false, path: '$.session.cache.lastRequestAt' });
  });

  it('clamps a lifetime past one hour and negative costs', () => {
    const f = loadFixture() as { session: { cache: Record<string, unknown> } };
    f.session.cache.ttlMs = 86_400_000;
    f.session.cache.coldCostUsd = -1;
    const r = validateReport(f);
    expect(r.ok && r.report.session.cache).toMatchObject({ ttlMs: 3_600_000, coldCostUsd: 0 });
  });
});
