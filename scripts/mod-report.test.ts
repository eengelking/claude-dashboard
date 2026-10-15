// Cross-check between the reporter mod and the server: a Report the mod's own reducers build from a
// scripted session must pass the server's validator unchanged and ingest into a sensible view.
// (The mod's tests run in the hooks sandbox, which cannot reach the server code.)
import { describe, it, expect } from 'vitest';
import { scriptedReport, scriptedState, T0 } from '../mod/podium-reporter/hooks/scripted.ts';
import { buildReport } from '../mod/podium-reporter/hooks/report.ts';
import { planAsk, questionAsk, respondInfo, toolAsk } from '../mod/podium-reporter/hooks/respond.ts';
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

  it('validates the responding fields the mod sends (#206) without any clamping', () => {
    const asks = [
      questionAsk('toolu_q', null, { questions: [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b', preview: 'x' }] }] }, T0)!,
      planAsk('toolu_p', null, { plan: '# Plan\n\n1. Go', planFilePath: '/Users/dev/.claude/plans/p.md' }, T0),
      toolAsk('toolu_t', 'agent-1', 'Bash', { command: 'git push', description: 'Push' }, T0),
    ];
    const report = buildReport(scriptedState(), [], { version: '0.14.0', engineVersion: '2.1.301', hostSurface: 'terminal', now: T0, storedName: null, optionName: null, respond: respondInfo('everything', true, true, false), asks, clearedFrom: 'sess-0' });
    const v = validateReport(JSON.parse(JSON.stringify(report)));
    if (!v.ok) throw new Error(`${v.path}: ${v.error}`);
    expect(v.report.session.respond).toEqual({ level: 'everything', accepts: ['question', 'message', 'plan-feedback', 'command'], limits: ['no-permission-hooks'] });
    expect(v.report.session.asks).toEqual(asks);
    expect(v.report.session.clearedFrom).toBe('sess-0');
  });
});
