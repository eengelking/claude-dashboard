import { describe, it, expect, beforeEach } from 'vitest';
import { FleetDb, openDb } from './db.js';
import { ReporterStore, REPORTING_MS, IDLE_MS, type ReporterSeen } from './reporters.js';

const MIN = 60_000;
const START = 1_000_000_000_000;
let db: ReturnType<typeof openDb>;
let store: ReporterStore;
beforeEach(() => {
  db = openDb(':memory:');
  store = new ReporterStore(db, START);
});

const seen = (over: Partial<ReporterSeen> = {}): ReporterSeen => ({
  kind: 'mod',
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

describe('reporters', () => {
  it('records a reporter on its machine id and keeps its first and last seen times', () => {
    store.record(seen(), START + MIN);
    store.record(seen({ sessionId: 's2', version: '0.13.1' }), START + 5 * MIN);
    const l = store.list({}, START + 5 * MIN);
    expect(l.total).toBe(1);
    expect(l.rows[0]).toMatchObject({
      key: '9f3a1c7d2e40',
      name: 'studio-m2',
      who: 'Dana',
      version: '0.13.1',
      firstSeenAt: START + MIN,
      lastSeenAt: START + 5 * MIN,
      sessions: 2,
    });
  });

  it('counts a session once however often it reports', () => {
    for (let i = 0; i < 4; i++) store.record(seen(), START + i * MIN);
    expect(store.list({}, START + 4 * MIN).rows[0]!.sessions).toBe(1);
  });

  it('matches a reporter that sends no machine id by its source address, apart from hooks-only sessions', () => {
    store.record(seen({ machineId: null, machineName: null, owner: null, credential: 'admin secret' }), START + MIN);
    store.record(seen({ kind: 'hooks', machineId: null, machineName: null, version: 'hooks', engineVersion: null, sessionId: 'h1' }), START + MIN);
    const rows = store.list({}, START + MIN).rows;
    expect(rows.map((r) => r.key).sort()).toEqual(['addr:192.168.1.24', 'hooks:192.168.1.24']);
    expect(rows.find((r) => r.key.startsWith('addr:'))!.name).toBe('Unnamed reporter');
    expect(rows.find((r) => r.key.startsWith('hooks:'))!.name).toBe('Hooks only');
    expect(rows.find((r) => r.key.startsWith('hooks:'))!.compat).toBe('unknown');
  });

  it('keeps a reporter after the sessions it reported are removed', () => {
    store.record(seen(), START + MIN);
    db.prepare(`INSERT INTO sessions (id, name, status, started_at, last_seen_at, ended_at, cwd) VALUES ('s1', 'x', 'done', ?, ?, ?, '/x')`).run(START, START, START);
    const YEAR = 365 * 24 * 60 * MIN;
    expect(new FleetDb(db).retain(START + YEAR, { samplesMs: 1, eventsMs: 1, sessionsMs: 30 * 24 * 60 * MIN }).sessions).toBe(1);
    expect(store.list({}, START + 2 * MIN).total).toBe(1);
  });

  it('works out the state from what the server can see', () => {
    store.record(seen({ machineId: 'aaaaaaaaaaaa', machineName: 'a' }), START + 10 * MIN);
    store.record(seen({ machineId: 'bbbbbbbbbbbb', machineName: 'b' }), START + 10 * MIN);
    store.record(seen({ machineId: 'cccccccccccc', machineName: 'c' }), START + 10 * MIN);
    // Recorded before the server started: known, but not heard from since.
    new ReporterStore(db, START + 1000 * MIN).record(seen({ machineId: 'dddddddddddd', machineName: 'd' }), START - MIN);
    const by = (now: number) => Object.fromEntries(store.list({}, now).rows.map((r) => [r.name, r.state]));
    expect(by(START + 10 * MIN + REPORTING_MS - 1)).toMatchObject({ a: 'reporting', d: 'restart' });
    expect(by(START + 10 * MIN + REPORTING_MS)).toMatchObject({ a: 'idle' });
    expect(by(START + 10 * MIN + IDLE_MS)).toMatchObject({ a: 'silent', b: 'silent' });
    const l = store.list({}, START + 10 * MIN + IDLE_MS);
    expect(l.counts).toEqual({ all: 4, reporting: 0, idle: 0, silent: 3, restart: 1 });
  });

  it('filters by state, searches, sorts and pages', () => {
    store.record(seen({ machineId: 'aaaaaaaaaaaa', machineName: 'alpha', owner: 'Dana' }), START + 10 * MIN);
    store.record(seen({ machineId: 'bbbbbbbbbbbb', machineName: 'bravo', owner: 'Sam', source: '10.0.0.9' }), START + 20 * MIN);
    store.record(seen({ machineId: 'cccccccccccc', machineName: 'charlie', owner: 'Lee', version: '0.9.0' }), START + 30 * MIN);
    const now = START + 30 * MIN;
    expect(store.list({ q: 'sam' }, now).rows.map((r) => r.name)).toEqual(['bravo']);
    expect(store.list({ q: '10.0.0' }, now).rows.map((r) => r.name)).toEqual(['bravo']);
    expect(store.list({ q: '0.9.0' }, now).rows.map((r) => r.name)).toEqual(['charlie']);
    expect(store.list({ state: 'reporting' }, now).rows.map((r) => r.name)).toEqual(['charlie']);
    expect(store.list({ sort: 'name', dir: 1 }, now).rows.map((r) => r.name)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(store.list({ sort: 'last', dir: -1 }, now).rows.map((r) => r.name)).toEqual(['charlie', 'bravo', 'alpha']);
    const p = store.list({ page: 2, pageSize: 2, sort: 'name', dir: 1 }, now);
    expect(p.rows.map((r) => r.name)).toEqual(['charlie']);
    expect(p.total).toBe(3);
  });

  it('treats search characters as text, not as patterns', () => {
    store.record(seen(), START + MIN);
    expect(store.list({ q: '%' }, START + MIN).total).toBe(0);
    expect(store.list({ q: "'; DROP TABLE reporters; --" }, START + MIN).total).toBe(0);
    expect(store.list({}, START + MIN).total).toBe(1);
  });

  it('flags a version outside the supported range', () => {
    store.record(seen({ machineId: 'aaaaaaaaaaaa', version: '0.1.0' }), START + MIN);
    store.record(seen({ machineId: 'bbbbbbbbbbbb', version: '9.0.0' }), START + MIN);
    const c = Object.fromEntries(store.list({}, START + MIN).rows.map((r) => [r.version, r.compat]));
    expect(c).toEqual({ '0.1.0': 'outdated', '9.0.0': 'newer' });
  });

  it('gives the detail: its sessions, live count and credential key id, never a secret', () => {
    store.record(seen(), START + MIN);
    db
      .prepare(
        `INSERT INTO sessions (id, name, status, started_at, last_seen_at, cwd, cost_usd) VALUES ('s1', 'api-gateway', 'running', ?, ?, '/x', 1.5)`,
      )
      .run(START, START + MIN);
    const d = store.get('9f3a1c7d2e40', START + MIN)!;
    expect(d).toMatchObject({ name: 'studio-m2', machineId: '9f3a1c7d2e40', source: '192.168.1.24', credential: 'pdm_3f9a1c07b2e4', engineVersion: '2.1.299', live: 1 });
    expect(d.recent).toEqual([{ id: 's1', name: 'api-gateway', status: 'running', lastSeenAt: START + MIN, costUsd: 1.5 }]);
    expect(store.get('nope', START)).toBeUndefined();
  });

  it('lists recent refusals from the reporter\'s address, newest first, and forgets the oldest', () => {
    store.record(seen(), START);
    store.rejected('192.168.1.24', 'wrong token', START + 1);
    store.rejected('10.9.9.9', 'wrong token', START + 2);
    store.rejected('192.168.1.24', 'unknown person token', START + 3);
    expect(store.get('9f3a1c7d2e40', START + 4)!.rejected).toEqual([
      { t: START + 3, reason: 'unknown person token' },
      { t: START + 1, reason: 'wrong token' },
    ]);
    for (let i = 0; i < 500; i++) store.rejected('1.1.1.1', 'x', START + i);
    expect(store.get('9f3a1c7d2e40', START + 4)!.rejected).toEqual([]);
  });

  it('removes a reporter and its session links, and it returns when it reports again', () => {
    store.record(seen(), START);
    expect(store.remove('9f3a1c7d2e40')).toBe(true);
    expect(store.remove('9f3a1c7d2e40')).toBe(false);
    expect(store.list({}, START).total).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reporter_sessions').get()).toEqual({ n: 0 });
    store.record(seen(), START + MIN);
    expect(store.list({}, START + MIN).total).toBe(1);
  });
});
