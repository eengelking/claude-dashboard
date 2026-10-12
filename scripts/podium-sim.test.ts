import { describe, it, expect } from 'vitest';
import { parseArgs, Simulator } from './podium-sim.ts';
import { validateReport, type Report } from '../server/src/fleet/protocol.ts';

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
});
