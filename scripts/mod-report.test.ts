// Cross-check between the reporter mod and the server: a Report the mod's own reducers build from a
// scripted session must pass the server's validator unchanged and ingest into a sensible view.
// (The mod's tests run in the hooks sandbox, which cannot reach the server code.)
import { describe, it, expect } from 'vitest';
import { scriptedReport } from '../mod/podium-reporter/hooks/scripted.ts';
import { validateReport } from '../server/src/fleet/protocol.ts';
import { FleetDb, openDb } from '../server/src/fleet/db.ts';
import { DEFAULT_CONFIG, Fleet } from '../server/src/fleet/fleet.ts';

describe('mod report -> server', () => {
  it('validates without any clamping', () => {
    const report = scriptedReport();
    const v = validateReport(JSON.parse(JSON.stringify(report)));
    if (!v.ok) throw new Error(`${v.path}: ${v.error}`);
    expect(v.report).toEqual(report);
  });

  it('ingests into a view with the plan, agents, failure and blowout level', () => {
    const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, () => 1_800_000_016_000);
    fleet.ingest(scriptedReport());
    const view = fleet.view('sess-1')!;
    expect(view.project).toBe('~/app');
    expect(view.agents.map((a) => [a.id, a.status, a.modelFamily])).toEqual([['a1', 'done', 'haiku'], ['a2', 'running', 'opus'], ['a3', 'failed', 'sonnet']]);
    expect(view.blowouts).toMatchObject({ orchestrator: 2, agents: 1, total: 3, level: 2 });
    expect(view.blowouts.log).toHaveLength(3);
    expect(view.plan?.title).toBe('Migrate');
    fleet.close();
  });
});
