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

  it('keeps one row per account when two accounts report from one machine id (issue #221)', () => {
    const ana = { owner: 'Ana', credential: 'pdm_aaaaaaaaaaaa' };
    const ben = { owner: 'Ben', credential: 'pdm_bbbbbbbbbbbb' };
    store.record(seen({ ...ana, sessionId: 'a1' }), START + MIN);
    store.record(seen({ ...ben, sessionId: 'b1' }), START + 2 * MIN);
    store.record(seen({ ...ana, sessionId: 'a2' }), START + 3 * MIN);
    store.record(seen({ ...ben, sessionId: 'b2' }), START + 4 * MIN);
    const rows = store.list({ sort: 'who' }, START + 4 * MIN).rows;
    expect(rows.map((r) => [r.who, r.credential, r.sessions])).toEqual([
      ['Ana', 'pdm_aaaaaaaaaaaa', 2],
      ['Ben', 'pdm_bbbbbbbbbbbb', 2],
    ]);
    // The first account keeps the machine id as its key, so rows and ignore rules made before this fix still match.
    expect(rows[0]!.key).toBe('9f3a1c7d2e40');
    expect(rows[1]!.key).not.toBe(rows[0]!.key);
  });

  it('files a report under the account row after the first account is removed, not under a second copy (issue #221)', () => {
    store.record(seen({ owner: 'Ana', sessionId: 'a1' }), START + MIN);
    store.record(seen({ owner: 'Ben', sessionId: 'b1' }), START + MIN);
    store.remove('9f3a1c7d2e40');
    store.record(seen({ owner: 'Ben', sessionId: 'b2' }), START + 2 * MIN);
    store.record(seen({ owner: 'Ana', sessionId: 'a2' }), START + 3 * MIN);
    const rows = store.list({ sort: 'who' }, START + 3 * MIN).rows;
    expect(rows.map((r) => r.who)).toEqual(['Ana', 'Ben']);
  });

  it('matches a reporter that sends no machine id by its source address, apart from hooks-only sessions', () => {
    store.record(seen({ machineId: null, machineName: null, owner: null, credential: 'admin secret' }), START + MIN);
    store.record(seen({ kind: 'hooks', machineId: null, machineName: null, version: 'hooks', engineVersion: null, sessionId: 'h1' }), START + MIN);
    const rows = store.list({}, START + MIN).rows;
    expect(rows.map((r) => r.key).sort()).toEqual(['addr:192.168.1.24', 'hooks:192.168.1.24']);
    expect(rows.find((r) => r.key.startsWith('addr:'))!.name).toBe('192.168.1.24');
    expect(rows.find((r) => r.key.startsWith('hooks:'))!.name).toBe('Hooks only');
    expect(rows.find((r) => r.key.startsWith('hooks:'))!.compat).toBe('unknown');
  });

  it('keeps one row for a reporter with no machine id that moves to a new source address (issue #166)', () => {
    const anon = (over: Partial<ReporterSeen> = {}) => seen({ machineId: null, machineName: null, owner: null, ...over });
    store.record(anon({ source: '10.88.0.133', sessionId: 's1' }), START + MIN);
    // The container restarted and came back on another address, still reporting the same session.
    store.record(anon({ source: '10.88.0.134', sessionId: 's1' }), START + 2 * MIN);
    store.record(anon({ source: '10.88.0.135', sessionId: 's2' }), START + 3 * MIN);
    store.record(anon({ source: '10.88.0.135', sessionId: 's1' }), START + 4 * MIN);
    const rows = store.list({}, START + 4 * MIN).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'addr:10.88.0.133', firstSeenAt: START + MIN, lastSeenAt: START + 4 * MIN, sessions: 2 });
    expect(store.get('addr:10.88.0.133', START + 4 * MIN)!.source).toBe('10.88.0.135');
  });

  it('calls an unnamed reporter by its newest project, else its address, and says it is not named', () => {
    store.record(seen({ machineId: null, machineName: null, source: '10.88.0.133', sessionId: 's1' }), START + MIN);
    expect(store.list({}, START + MIN).rows[0]).toMatchObject({ name: '10.88.0.133', named: false });
    const add = db.prepare(`INSERT INTO sessions (id, name, status, started_at, last_seen_at, cwd, repo_name) VALUES (?, ?, 'running', ?, ?, '/x', ?)`);
    add.run('s1', 'older', START, START, null);
    expect(store.list({}, START + MIN).rows[0]!.name).toBe('older');
    store.record(seen({ machineId: null, machineName: null, source: '10.88.0.133', sessionId: 's2' }), START + 2 * MIN);
    add.run('s2', 'newer', START, START + MIN, 'podium');
    expect(store.list({ q: 'podium' }, START + 2 * MIN).rows[0]).toMatchObject({ name: 'podium', named: false });
    expect(store.get('addr:10.88.0.133', START + 2 * MIN)!.serverStartedAt).toBe(START);
    store.record(seen({ sessionId: 's3' }), START + 2 * MIN);
    expect(store.list({ q: 'studio' }, START + 2 * MIN).rows[0]).toMatchObject({ name: 'studio-m2', named: true });
  });

  it('flags a reporter that uses the admin secret, counts them and filters to them (issue #166)', () => {
    store.record(seen({ machineId: null, machineName: null, owner: 'Admin', credential: 'admin secret', source: '10.88.0.1', sessionId: 'a1' }), START + MIN);
    store.record(seen({ machineId: null, machineName: null, owner: 'Admin', credential: 'admin secret', source: '10.88.0.2', sessionId: 'a2' }), START + MIN);
    store.record(seen(), START + MIN);
    store.record(seen({ machineId: 'bbbbbbbbbbbb', machineName: 'open', owner: null, credential: null, sessionId: 's9' }), START + MIN);
    const l = store.list({}, START + MIN);
    expect(l.adminSecret).toBe(2);
    const by = Object.fromEntries(l.rows.map((r) => [r.key, r]));
    expect(by['addr:10.88.0.1']).toMatchObject({ adminSecret: true, credential: 'admin secret' });
    expect(by['9f3a1c7d2e40']).toMatchObject({ adminSecret: false, credential: 'pdm_3f9a1c07b2e4' });
    // With authentication off there is no credential, so there is nothing to warn about.
    expect(by['bbbbbbbbbbbb']).toMatchObject({ adminSecret: false, credential: null });
    const only = store.list({ admin: true }, START + MIN);
    expect(only.rows.map((r) => r.key).sort()).toEqual(['addr:10.88.0.1', 'addr:10.88.0.2']);
    expect(only.total).toBe(2);
    expect(only.adminSecret).toBe(2);
    expect(store.list({ sort: 'token', dir: 1 }, START + MIN).rows.slice(0, 2).every((r) => r.adminSecret)).toBe(true);
    expect(store.get('addr:10.88.0.1', START + MIN)!.adminSecret).toBe(true);
  });

  it('does not fold a hooks-only report into a mod reporter that shares its session', () => {
    store.record(seen({ machineId: null, machineName: null, source: '10.88.0.133' }), START + MIN);
    store.record(seen({ kind: 'hooks', machineId: null, machineName: null, source: '10.88.0.134', version: 'hooks', engineVersion: null }), START + MIN);
    expect(store.list({}, START + MIN).total).toBe(2);
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

  it('pages the sessions it holds for a reporter, newest first, with the total (issue #188)', () => {
    const add = db.prepare(`INSERT INTO sessions (id, name, status, started_at, last_seen_at, cwd, cost_usd) VALUES (?, ?, 'ended', ?, ?, '/x', NULL)`);
    for (let i = 1; i <= 30; i++) {
      store.record(seen({ sessionId: `s${i}` }), START + i);
      add.run(`s${i}`, `n${i}`, START, START + i);
    }
    const one = store.get('9f3a1c7d2e40', START + MIN, { page: 1, pageSize: 25 })!;
    expect(one).toMatchObject({ recentTotal: 30, recentPage: 1, recentPageSize: 25 });
    expect(one.recent.map((s) => s.id)).toEqual(Array.from({ length: 25 }, (_, i) => `s${30 - i}`));
    const two = store.get('9f3a1c7d2e40', START + MIN, { page: 2, pageSize: 25 })!;
    expect(two.recent.map((s) => s.id)).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect(store.get('9f3a1c7d2e40', START + MIN)!).toMatchObject({ recentPage: 1, recentPageSize: 50, recentTotal: 30 });
    expect(store.get('9f3a1c7d2e40', START + MIN, { page: 1, pageSize: 5000 })!.recentPageSize).toBeLessThanOrEqual(100);
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

const DAY = 24 * 60 * MIN;

describe('removing many reporters (issue #167)', () => {
  const three = () => {
    store.record(seen({ machineId: 'aaaa', machineName: 'a', sessionId: 'a1' }), START + MIN);
    store.record(seen({ machineId: 'bbbb', machineName: 'b', sessionId: 'b1' }), START - 5 * MIN);
    store.record(seen({ machineId: 'cccc', machineName: 'c', sessionId: 'c1' }), START - 9 * MIN);
  };

  it('removes the keys it is given in one step, skips unknown ones, and says how many went', () => {
    three();
    expect(store.removeMany(['aaaa', 'bbbb', 'nope'])).toBe(2);
    expect(store.list({}, START + MIN).rows.map((r) => r.key)).toEqual(['cccc']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reporter_sessions').get()).toEqual({ n: 1 });
  });

  it('removes every reporter in one state', () => {
    three();
    expect(store.removeState('restart', START + MIN)).toBe(2);
    expect(store.list({}, START + MIN).rows.map((r) => r.key)).toEqual(['aaaa']);
    expect(store.removeState('restart', START + MIN)).toBe(0);
  });

  it('lists the keys of a filtered view, so "select all in this filter" can reach past one page', () => {
    three();
    expect(store.keys({ state: 'restart' }, START + MIN).sort()).toEqual(['bbbb', 'cccc']);
    expect(store.keys({ q: 'bbb' }, START + MIN)).toEqual(['bbbb']);
  });
});

describe('ignore rules (issue #167)', () => {
  it('matches a reporter by key, by address pattern and by version pattern', () => {
    const k = store.addIgnore('key', 'aaaa', START);
    const a = store.addIgnore('address', '10.88.*', START);
    const v = store.addIgnore('version', '*-sim', START);
    expect(store.ignoredBy({ key: 'aaaa', source: null, version: '0.13.0' })?.id).toBe(k.id);
    expect(store.ignoredBy({ key: 'x', source: '10.88.0.133', version: '0.13.0' })?.id).toBe(a.id);
    expect(store.ignoredBy({ key: 'x', source: '192.168.1.24', version: '0.1.0-sim' })?.id).toBe(v.id);
    expect(store.ignoredBy({ key: 'x', source: '192.168.1.24', version: '0.13.0' })).toBeUndefined();
    // A pattern is text with * for "anything", never a regular expression.
    store.addIgnore('address', '1.2.3.4', START);
    expect(store.ignoredBy({ key: 'x', source: '1x2y3z4', version: '1' })).toBeUndefined();
  });

  it('keeps one copy of a rule, lists rules oldest first, and removes one by id', () => {
    const first = store.addIgnore('key', 'aaaa', START);
    expect(store.addIgnore('key', 'aaaa', START + MIN).id).toBe(first.id);
    store.addIgnore('version', '*-sim', START + 2 * MIN);
    expect(store.listIgnores().map((r) => [r.kind, r.pattern])).toEqual([['key', 'aaaa'], ['version', '*-sim']]);
    expect(store.removeIgnore(first.id)).toBe(true);
    expect(store.removeIgnore(first.id)).toBe(false);
    expect(store.ignoredBy({ key: 'aaaa', source: null, version: '1' })).toBeUndefined();
  });

  it('matches * without backtracking on a long value', () => {
    store.addIgnore('version', 'a*a*a*a*a*a*b', START);
    const t0 = Date.now();
    expect(store.ignoredBy({ key: 'k', source: null, version: 'a'.repeat(60) })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(50);
    expect(store.ignoredBy({ key: 'k', source: null, version: 'aaaaaaaaaaaab' })).toBeDefined();
  });

  it('matches a key rule on the row a session already belongs to, after the reporter changes address (#166)', () => {
    const anon = (over: Partial<ReporterSeen>) => seen({ machineId: null, machineName: null, owner: null, ...over });
    store.record(anon({ source: '10.88.0.133', sessionId: 's1' }), START + MIN);
    const s = anon({ source: '10.88.0.134', sessionId: 's1' });
    expect(store.keysFor(s)).toEqual(['addr:10.88.0.134', 'addr:10.88.0.133']);
    store.addIgnore('key', 'addr:10.88.0.133', START + 2 * MIN);
    expect(store.ignoredBy({ key: 'addr:10.88.0.134', otherKeys: ['addr:10.88.0.133'], source: '10.88.0.134', version: '1' })).toBeDefined();
  });

  it('lets a key rule on a machine id cover every account on it, and a rule on one account cover only that account (#221)', () => {
    store.record(seen({ owner: 'Ana', sessionId: 'a1' }), START + MIN);
    store.record(seen({ owner: 'Ben', sessionId: 'b1' }), START + MIN);
    const ben = { kind: 'mod' as const, machineId: '9f3a1c7d2e40', source: null, owner: 'Ben', sessionId: 'b1' };
    const target = (keys: string[]) => ({ key: keys[0]!, otherKeys: keys.slice(1), source: null, version: '1' });
    const benRow = store.list({}, START + MIN).rows.find((r) => r.who === 'Ben')!;
    store.addIgnore('key', benRow.key, START + 2 * MIN);
    expect(store.list({}, START + 2 * MIN).rows.map((r) => r.who)).toEqual(['Ana']);
    expect(store.ignoredBy(target(store.keysFor(ben)))).toBeDefined();
    expect(store.ignoredBy(target(store.keysFor({ ...ben, owner: 'Ana' })))).toBeUndefined();
    store.addIgnore('key', '9f3a1c7d2e40', START + 3 * MIN);
    expect(store.list({}, START + 3 * MIN).total).toBe(0);
    expect(store.ignoredBy(target(store.keysFor({ ...ben, owner: 'Ana' })))).toBeDefined();
    expect(store.ignoredBy(target(store.keysFor(ben)))).toBeDefined();
  });

  it('matches a rule on <machine id>#<owner> even when that account\'s row is keyed on the bare machine id (#221)', () => {
    store.record(seen({ owner: 'Ben', sessionId: 'b1' }), START + MIN);
    store.addIgnore('key', '9f3a1c7d2e40#Ben', START + 2 * MIN);
    const keys = store.keysFor({ kind: 'mod', machineId: '9f3a1c7d2e40', source: null, owner: 'Ben', sessionId: 'b2' });
    expect(store.ignoredBy({ key: keys[0]!, otherKeys: keys.slice(1), source: null, version: '1' })).toBeDefined();
  });

  it('refuses a rule made only of *, which would turn every reporter away', () => {
    expect(() => store.addIgnore('address', '*', START)).toThrow(/besides \*/);
    expect(() => store.addIgnore('version', '**', START)).toThrow();
    expect(store.addIgnore('version', '*-sim', START).pattern).toBe('*-sim');
  });

  it('refuses a rule that is empty, too long, or of an unknown kind', () => {
    expect(() => store.addIgnore('key', '  ', START)).toThrow();
    expect(() => store.addIgnore('key', 'x'.repeat(200), START)).toThrow();
    expect(() => store.addIgnore('who' as 'key', 'x', START)).toThrow();
  });

  it('removes an ignored reporter\'s row when the rule is made', () => {
    store.record(seen(), START);
    store.addIgnore('key', '9f3a1c7d2e40', START);
    expect(store.list({}, START).total).toBe(0);
  });
});

describe('forgetting reporters by age (issue #167)', () => {
  it('is off, at 30 days, until the Admin turns it on', () => {
    expect(store.forgetSetting()).toEqual({ enabled: false, days: 30 });
    store.record(seen(), START - 90 * DAY);
    expect(store.forgetStale(START + 2 * 60 * MIN)).toBe(0);
    expect(store.list({}, START).total).toBe(1);
  });

  it('removes reporters not heard from for N days and keeps the rest', () => {
    store.record(seen({ machineId: 'old', sessionId: 'o' }), START - 31 * DAY);
    store.record(seen({ machineId: 'new', sessionId: 'n' }), START - 29 * DAY);
    store.setForgetSetting({ enabled: true, days: 30 });
    expect(store.forgetStale(START + 2 * 60 * MIN)).toBe(1);
    expect(store.list({}, START).rows.map((r) => r.key)).toEqual(['new']);
  });

  it('waits an hour after the server starts, so a long outage does not empty the list', () => {
    store.record(seen({ machineId: 'old', sessionId: 'o' }), START - 90 * DAY);
    store.setForgetSetting({ enabled: true, days: 30 });
    expect(store.forgetStale(START + 59 * MIN)).toBe(0);
    expect(store.list({}, START).total).toBe(1);
    expect(store.forgetStale(START + 61 * MIN)).toBe(1);
  });

  it('keeps the days when it is switched off and on, and refuses days outside 1 to 3650', () => {
    store.setForgetSetting({ enabled: true, days: 7 });
    store.setForgetSetting({ enabled: false });
    expect(store.forgetSetting()).toEqual({ enabled: false, days: 7 });
    expect(() => store.setForgetSetting({ days: 0 })).toThrow();
    expect(() => store.setForgetSetting({ days: 1.5 })).toThrow();
    expect(() => store.setForgetSetting({ days: 4000 })).toThrow();
  });
});
