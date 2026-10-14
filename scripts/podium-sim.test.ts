import { describe, it, expect } from 'vitest';
import { parseArgs, Simulator } from './podium-sim.ts';
import { MAIN_LOOP, validateReport, type Report } from '../server/src/fleet/protocol.ts';

function run(seed: number, ticks: number, chaos = false): Report[] {
  let t = 1_800_000_000_000;
  const sim = new Simulator({ sessions: 5, seed, chaos, extraAgents: 0, now: () => t, home: '/Users/sim' });
  const out: Report[] = [];
  for (let i = 0; i < ticks; i++) {
    t += 1000;
    for (const r of sim.step()) {
      out.push(r);
      sim.ack(r.session.id, r.events.length);
    }
  }
  out.push(...sim.endAll());
  return out;
}

/** Drops every timestamp so runs on different clocks compare. */
function untimed(reports: Report[]): string {
  return JSON.stringify(reports, (k, v) => (['t', 'sentAt', 'startedAt', 'endedAt', 'at', 'id'].includes(k) && typeof v !== 'object' ? (k === 'id' && typeof v === 'string' ? v.replace(/:\d{13}:/, ':T:') : 0) : v));
}

describe('podium-sim', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(untimed(run(7, 200, true))).toBe(untimed(run(7, 200, true)));
    expect(untimed(run(7, 50))).not.toBe(untimed(run(8, 50)));
  });

  it('produces reports the server accepts, with forks, failures, blowouts and replacements', () => {
    const reports = run(3, 600, true);
    for (const r of reports) {
      const v = validateReport(JSON.parse(JSON.stringify(r)));
      if (!v.ok) throw new Error(`${v.path}: ${v.error}`);
    }
    const agents = reports.flatMap((r) => r.agents);
    expect(agents.some((a) => a.kind === 'fork')).toBe(true);
    expect(agents.some((a) => a.status === 'failed' && a.failure)).toBe(true);
    expect(agents.some((a) => a.blowouts > 0)).toBe(true);
    expect(agents.some((a) => a.skills.length > 0)).toBe(true);
    const sessionIds = new Set(reports.map((r) => r.session.id));
    expect(sessionIds.size).toBeGreaterThan(5);
    expect(reports.some((r) => r.session.status === 'done')).toBe(true);
  });

  it('ends every session it started', () => {
    const reports = run(5, 120, true);
    const last = new Map<string, Report>();
    for (const r of reports) last.set(r.session.id, r);
    for (const r of last.values()) expect(r.session.status).toBe('done');
  });

  it('parses its flags', () => {
    expect(parseArgs(['--help'])).toBe('help');
    expect(parseArgs(['--sessions', '3', '--speed', '2', '--seed', '9', '--duration', '20', '--chaos', '--token', 'x', '--url', 'http://h:1/'])).toMatchObject({
      sessions: 3, speed: 2, seed: 9, duration: 20, chaos: true, token: 'x', url: 'http://h:1',
    });
    expect(parseArgs(['--reporter-version', '0.1.0'])).toMatchObject({ reporterVersion: '0.1.0' });
    expect(() => parseArgs(['--sessions', 'many'])).toThrow();
    expect(() => parseArgs(['--bogus'])).toThrow();
  });

  it('parses people and the unnamed share', () => {
    expect(parseArgs(['--person', 'Ed E.=pdm_a_b', '--person', 'Priya N.', '--unnamed'])).toMatchObject({
      people: [{ name: 'Ed E.', token: 'pdm_a_b' }, { name: 'Priya N.', token: null }],
      unnamed: true,
    });
    expect(parseArgs([])).toMatchObject({ people: [], unnamed: false });
    expect(() => parseArgs(['--person', '=tok'])).toThrow();
  });

  it('reports as people in turn, each on a laptop and a build box, with their own token, plus unnamed sessions', () => {
    let t = 1_800_000_000_000;
    const sim = new Simulator({
      sessions: 9, seed: 2, chaos: false, extraAgents: 0, now: () => t, home: '/Users/sim',
      people: [{ name: 'Ed E.', token: 'tok-ed' }, { name: 'Priya N.', token: null }], unnamed: true,
    });
    t += 1000;
    const reports = sim.step();
    for (const r of reports) {
      const v = validateReport(JSON.parse(JSON.stringify(r)));
      if (!v.ok) throw new Error(`${v.path}: ${v.error}`);
    }
    expect(reports.map((r) => r.userName ?? null)).toEqual(['Ed E.', 'Priya N.', null, 'Ed E.', 'Priya N.', null, 'Ed E.', 'Priya N.', null]);
    const ed = reports.filter((r) => r.userName === 'Ed E.');
    expect(ed.map((r) => r.machine!.name)).toEqual(['ed-e-laptop', 'ed-e-laptop', 'ed-e-build']);
    expect(new Set(ed.map((r) => r.machine!.id)).size).toBe(2);
    for (const r of reports) if (r.machine) expect(r.machine.id).toMatch(/^[0-9a-f]{12}$/);
    expect(reports.find((r) => !r.userName)!.machine).toBeUndefined();
    expect(sim.tokenFor(ed[0]!.session.id)).toBe('tok-ed');
    expect(sim.tokenFor(reports[1]!.session.id)).toBeNull();
    expect(sim.tokenFor(reports[2]!.session.id)).toBeNull();
  });

  it('with --nested keeps a session whose agents launch agents, in every shape a real run produced (#101)', () => {
    expect(parseArgs(['--nested'])).toMatchObject({ nested: true });
    expect(parseArgs([])).toMatchObject({ nested: false });
    let t = 1_800_000_000_000;
    const sim = new Simulator({ sessions: 3, seed: 11, chaos: false, extraAgents: 0, now: () => t, home: '/Users/sim', nested: true });
    const reports: Report[] = [];
    for (let i = 0; i < 240; i++) {
      t += 1000;
      for (const r of sim.step()) {
        reports.push(r);
        sim.ack(r.session.id, r.events.length);
      }
    }
    const nested = reports.filter((r) => r.session.git?.branch === 'feat/adapter-rewrite');
    expect(nested.length).toBeGreaterThan(0);
    let deepest = 0;
    const shapes = new Set<string>();
    for (const r of nested) {
      const v = validateReport(JSON.parse(JSON.stringify(r)));
      if (!v.ok) throw new Error(`${v.path}: ${v.error}`);
      const byId = new Map(r.agents.map((a) => [a.id, a]));
      for (const a of r.agents) {
        if (!a.parentId) continue;
        const p = byId.get(a.parentId);
        // Every parent is in the same report, and a parent never finishes while a child it launched runs.
        expect(p, `${a.description} has its parent`).toBeDefined();
        if (a.status === 'running') expect(['running', 'failed']).toContain(p!.status);
        shapes.add(`${a.kind} under ${p!.kind}`);
        if (a.kind === 'fork') expect([a.model, a.effort]).toEqual([p!.model, p!.effort]);
        let d = 1;
        for (let q: typeof a | undefined = a; q?.parentId; q = byId.get(q.parentId)) d++;
        deepest = Math.max(deepest, d);
      }
    }
    expect([...shapes].sort()).toEqual(['fork under subagent', 'subagent under fork', 'subagent under subagent']);
    expect(deepest).toBe(4);
  });

  it('sends a feed only for the loops the reply says are watched, and none from a reporter older than 0.13.0 (#118)', () => {
    let t = 1_800_000_000_000;
    const sim = new Simulator({ sessions: 2, seed: 4, chaos: false, extraAgents: 1, now: () => t, home: '/Users/sim' });
    t += 1000;
    const first = sim.step()[0]!;
    expect(first.session.activityFeed).toBe(true);
    expect(first.agents.some((a) => a.activity) || !!first.session.activity).toBe(false);
    const running = first.agents.find((a) => a.status === 'running')!;
    sim.watch(first.session.id, [running.id, MAIN_LOOP]);
    let last: Report | undefined;
    for (let i = 0; i < 25; i++) {
      t += 1000;
      last = sim.step().find((r) => r.session.id === first.session.id);
    }
    const v = validateReport(JSON.parse(JSON.stringify(last)));
    if (!v.ok) throw new Error(`${v.path}: ${v.error}`);
    const feed = last!.agents.find((a) => a.id === running.id)?.activity ?? [];
    if (last!.agents.find((a) => a.id === running.id)!.status === 'running') expect(feed).toHaveLength(20);
    expect(last!.agents.filter((a) => a.id !== running.id).every((a) => !a.activity)).toBe(true);
    sim.watch(first.session.id, []);
    t += 1000;
    const after = sim.step().find((r) => r.session.id === first.session.id)!;
    expect(after.agents.some((a) => a.activity) || !!after.session.activity).toBe(false);
    const old = new Simulator({ sessions: 1, seed: 4, chaos: false, extraAgents: 0, reporterVersion: '0.12.0', now: () => t, home: '/Users/sim' });
    t += 1000;
    expect('activityFeed' in old.step()[0]!.session).toBe(false);
  });

  it('sends no name or machine without --person', () => {
    expect(run(4, 20).some((r) => 'userName' in r || 'machine' in r)).toBe(false);
  });
});
