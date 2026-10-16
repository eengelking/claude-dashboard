import { describe, it, expect } from 'vitest';
import {
  blowoutLevel,
  buildSeries,
  computeKpis,
  family,
  resumeCommand,
  sessionStatus,
  sessionView,
  shortenHome,
  startOfDay,
} from './derive.js';
import { openDb, FleetDb, type SampleRow } from './db.js';
import { ingestReport } from './ingest.js';
import type { Report } from './protocol.js';
import { fixtureReport } from './testing.js';

const CFG = { staleAfterMs: 15_000, home: '/Users/dev' };

describe('blowoutLevel', () => {
  const cases: [string, number, number[], 0 | 1 | 2][] = [
    ['none at all', 0, [], 0],
    ['none with agents', 0, [0, 0, 0], 0],
    ['one on the orchestrator', 1, [0], 1],
    ['one on an agent', 0, [1, 0], 1],
    ['orchestrator with two', 2, [], 2],
    ['one agent with two', 0, [0, 2], 2],
    ['one agent with five', 0, [5], 2],
    ['three spread over three loops', 1, [1, 1], 2],
    ['two spread over two loops', 1, [1], 1],
    ['two agents with one each', 0, [1, 1], 1],
    ['three agents with one each', 0, [1, 1, 1], 2],
    ['orchestrator one, agent two', 1, [2], 2],
  ];
  it.each(cases)('%s', (_name, orch, agents, level) => {
    expect(blowoutLevel(orch, agents)).toBe(level);
  });
});

describe('family', () => {
  it('maps aliases and ids', () => {
    expect(family('claude-opus-5-5')).toBe('opus');
    expect(family('Sonnet')).toBe('sonnet');
    expect(family('claude-haiku-5-5')).toBe('haiku');
    expect(family('fable')).toBe('fable');
    expect(family('gpt')).toBe('other');
    expect(family(null)).toBe('other');
  });

  it('does not take a non-Claude model for a Claude family because of its name', () => {
    expect(family('my-sonnet-finetune:latest')).toBe('other');
    expect(family('llama3.1:8b')).toBe('other');
    expect(family('opus[1m]')).toBe('opus');
    expect(family('opusplan')).toBe('opus');
    expect(family('us.anthropic.claude-sonnet-5-5')).toBe('sonnet');
  });
});

describe('paths and commands', () => {
  it('replaces the home prefix with ~', () => {
    expect(shortenHome('/Users/dev/billing', '/Users/dev')).toBe('~/billing');
    expect(shortenHome('/Users/dev', '/Users/dev/')).toBe('~');
    expect(shortenHome('/Users/developer/x', '/Users/dev')).toBe('/Users/developer/x');
    expect(shortenHome('/opt/x', '/Users/dev')).toBe('/opt/x');
  });

  it('builds the resume command from resumeId, else the session id, quoting odd paths', () => {
    expect(resumeCommand('/Users/dev/app', null, 'abc')).toBe('cd /Users/dev/app && claude --resume abc');
    expect(resumeCommand('/Users/dev/app', 'r-1', 'abc')).toBe('cd /Users/dev/app && claude --resume r-1');
    expect(resumeCommand('/Users/dev/my app', null, 'abc')).toBe("cd '/Users/dev/my app' && claude --resume abc");
    expect(resumeCommand("/tmp/it's", null, 'abc')).toBe("cd '/tmp/it'\\''s' && claude --resume abc");
  });
});

describe('buildSeries', () => {
  const now = 1_000_000_500;
  const nowSec = Math.floor(now / 1000);
  const sample = (t: number, over: Partial<SampleRow> = {}): SampleRow => ({
    session_id: 's', t, tokens_total: 0, tokens_delta: 10, peak_context: 0.5, running_agents: 2, cost_usd: null, ...over,
  });

  it('has 60 zero-filled points per array, oldest first, ending at the last complete second', () => {
    const s = buildSeries([sample(nowSec, { tokens_delta: 99 }), sample(nowSec - 1), sample(nowSec - 60, { tokens_delta: 7 }), sample(nowSec - 61), sample(nowSec - 11, { peak_context: 4 })], [], now);
    for (const arr of [s.tokensPerSec, s.peakContext, s.running]) expect(arr).toHaveLength(60);
    // the second still in progress is left out: its sample is partial
    expect(s.tokensPerSec).not.toContain(99);
    expect(s.tokensPerSec[59]).toBe(10);
    expect(s.tokensPerSec[0]).toBe(7);
    expect(s.tokensPerSec[30]).toBe(0);
    expect(s.peakContext[49]).toBe(1);
    expect(s.peakContext.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('lists the age in seconds of each blowout in the last 60 s', () => {
    const s = buildSeries([], [{ t: now - 9_000 }, { t: now - 33_000 }, { t: now - 90_000 }, { t: now }], now);
    // ages count back from the newest point (the last complete second); a blowout this second is age 0
    expect(s.blowoutSecondsAgo).toEqual([0, 8, 32]);
  });
});

describe('sessionView', () => {
  function viewOf(report: Report, now: number, heard = true) {
    const f = new FleetDb(openDb(':memory:'));
    ingestReport(f, report, now - 1000);
    const id = report.session.id;
    return sessionView(
      { row: f.getSession(id)!, agents: f.getAgents(id), blowouts: f.getBlowouts(id), samples: f.samplesSince(id, 0), heard },
      now,
      CFG,
    );
  }

  it('derives the fixture', () => {
    const v = viewOf(fixtureReport(), 1_791_648_001_000);
    expect(v.project).toBe('~/billing-service');
    expect(v.modelFamily).toBe('opus');
    expect(v.status).toBe('running');
    expect(v.blowouts).toMatchObject({ orchestrator: 0, agents: 2, total: 2, level: 2, loopsHit: 1, loopsTotal: 5 });
    expect(v.blowouts.log).toHaveLength(1);
    expect(v.agents.find((a) => a.id === 'a3')?.failure?.class).toBe('Tool error');
    expect(v.agents.find((a) => a.id === 'a1')?.skills).toEqual(['repo-map']);
    expect(v.agents.find((a) => a.id === 'a1')?.toolCounts).toEqual({ Grep: 14, Read: 11, Glob: 6 });
    expect(v.series.tokensPerSec).toHaveLength(60);
    expect(v.resumeCommand).toBe('cd /Users/dev/billing-service/.claude/worktrees/invoice-v2 && claude --resume 5f0c2a8e-1b7d-4c3e-9a51-2d6f8e0b4c11');
    expect(v.secondsSinceSeen).toBe(1);
  });

  it('exposes the changed files, and null when the reporter sent none', () => {
    const v = viewOf(fixtureReport(), 1_791_648_001_000);
    expect(v.files).toMatchObject({ total: 4, added: 85, removed: 119, since: 'start' });
    expect(v.files?.files[3]).toEqual({ path: 'src/invoice/totals.ts', status: 'renamed', added: 3, removed: 1, from: 'src/invoice/sum.ts' });
    const old = fixtureReport();
    old.session.files = null;
    expect(viewOf(old, 1_791_648_001_000).files).toBeNull();
  });

  it('exposes the main loop block, and null when the reporter sent none', () => {
    const v = viewOf(fixtureReport(), 1_791_648_001_000);
    expect(v.loop).toMatchObject({ skills: ['frontend-design', 'code-review'], lastTool: 'Agent', toolCalls: 19, steps: { done: 23, total: null } });
    expect(v.loop?.toolCounts).toEqual({ Agent: 4, Read: 8, Edit: 5, TaskUpdate: 2 });
    const old = fixtureReport();
    old.session.loop = null;
    expect(viewOf(old, 1_791_648_001_000).loop).toBeNull();
  });

  it('carries the reporter version and where it sits against the supported range', () => {
    const at = (version: string) => {
      const r = fixtureReport();
      r.reporter.version = version;
      const v = viewOf(r, 1_791_648_001_000);
      return [v.reporterVersion, v.compat];
    };
    expect(at('0.1.0')).toEqual(['0.1.0', 'outdated']);
    expect(at('0.3.1')).toEqual(['0.3.1', 'ok']);
    expect(at('99.0.0')).toEqual(['99.0.0', 'newer']);
    expect(at('0.1.0-sim')).toEqual(['0.1.0-sim', 'unknown']);
  });

  it('is stale past STALE_AFTER_MS unless done, and stale until heard after a restart', () => {
    const r = fixtureReport();
    const f = new FleetDb(openDb(':memory:'));
    ingestReport(f, r, 1000);
    const row = f.getSession(r.session.id)!;
    expect(sessionStatus(row, true, 16_000, 15_000)).toBe('running');
    expect(sessionStatus(row, true, 16_001, 15_000)).toBe('stale');
    expect(sessionStatus(row, false, 2_000, 15_000)).toBe('stale');
    expect(sessionStatus({ ...row, status: 'done' }, true, 99_000, 15_000)).toBe('done');
    expect(sessionStatus({ ...row, status: 'waiting' }, true, 2_000, 15_000)).toBe('waiting');
  });
});

describe('computeKpis', () => {
  it('matches hand-computed values for three sessions', () => {
    const now = 1_791_648_100_000;
    const f = new FleetDb(openDb(':memory:'));
    const base = fixtureReport();
    // A: the fixture (running, 2 running agents of 4, plan 1/4, cost 12.84, blowouts 2 at level 2)
    ingestReport(f, base, now - 2000);
    // B: waiting, no agents, plan null, cost 1.00, orchestrator blowout 1, tokens 1,000 then 4,000
    const b: Report = {
      ...base,
      agents: [],
      events: [],
      session: { ...base.session, id: 'b', status: 'waiting', plan: null, costUsd: 1, blowouts: 1, tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 } },
    };
    ingestReport(f, b, now - 2000);
    ingestReport(f, { ...b, session: { ...b.session, tokens: { input: 4000, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 1.5 } }, now - 1000);
    // C: running, started yesterday (cost not counted today), one done agent
    const c: Report = {
      ...base,
      agents: [base.agents[0]!],
      events: [],
      session: { ...base.session, id: 'c', startedAt: startOfDay(now) - 3600_000, plan: null, costUsd: 9, blowouts: 0 },
    };
    // first heard of yesterday, when it started; the server keeps that start (#43)
    ingestReport(f, c, c.session.startedAt + 1000);
    ingestReport(f, c, now - 1000);

    const views = ['5f0c2a8e-1b7d-4c3e-9a51-2d6f8e0b4c11', 'b', 'c'].map((id) =>
      sessionView({ row: f.getSession(id)!, agents: f.getAgents(id), blowouts: f.getBlowouts(id), samples: f.samplesSince(id, 0), heard: true }, now, CFG),
    );
    const startSec = Math.floor(now / 1000) - 59;
    const k = computeKpis(
      {
        views,
        costToday: f.costSince(startOfDay(now)),
        tokensPerSecond: f.fleetTokensPerSecond(startSec),
        costPerMinute: f.fleetCostPerMinute(startSec - 3600),
      },
      now,
    );
    expect(k).toMatchObject({
      live: 3, running: 2, waiting: 1, stale: 0,
      agentsRunning: 2, agentsTotal: 5,
      planDone: 1, planTotal: 4,
      blowoutsTotal: 3, sessionsAtLevel2: 1,
      tokensLastMinute: 3000,
    });
    expect(k.costToday).toBeCloseTo(12.84 + 1.5);
    expect(k.tokensPerSec).toHaveLength(60);
    expect(k.tokensPerSec[59]).toBe(3000);
    expect(k.costPerMinute).toHaveLength(60);
    expect(k.costPerMinute.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5);
  });
});

describe('agents launched by other agents (#101)', () => {
  // The shape of a real nested run: a subagent that launched a subagent and a fork, a grandchild under
  // that subagent, and a top-level fork that launched a subagent.
  function nestedReport(): Report {
    const base = fixtureReport();
    const agent = base.agents[0]!;
    const mk = (id: string, parentId: string | null, kind: 'subagent' | 'fork', status: 'running' | 'done', blowouts = 0) => ({
      ...agent,
      id,
      parentId,
      kind,
      type: kind === 'fork' ? 'fork' : 'general-purpose',
      description: id,
      status,
      endedAt: status === 'done' ? agent.startedAt + 1000 : null,
      blowouts,
      failure: null,
      tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    });
    return {
      ...base,
      events: [],
      session: { ...base.session, blowouts: 0, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
      agents: [mk('p', null, 'subagent', 'running'), mk('f', null, 'fork', 'running'), mk('c', 'p', 'subagent', 'running', 1), mk('pf', 'p', 'fork', 'done'), mk('g', 'c', 'subagent', 'running', 1), mk('fc', 'f', 'subagent', 'done')],
    };
  }

  it('keeps every parent through ingest and counts each agent once in the view and the KPIs', () => {
    const now = 1_791_648_100_000;
    const f = new FleetDb(openDb(':memory:'));
    const r = nestedReport();
    ingestReport(f, r, now - 1000);
    const id = r.session.id;
    const v = sessionView({ row: f.getSession(id)!, agents: f.getAgents(id), blowouts: f.getBlowouts(id), samples: f.samplesSince(id, 0), heard: true }, now, CFG);
    expect(Object.fromEntries(v.agents.map((a) => [a.id, a.parentId]))).toEqual({ p: null, f: null, c: 'p', pf: 'p', g: 'c', fc: 'f' });
    expect(v.tokensTotal).toBe(4 + 6 * 100);
    expect(v.blowouts).toMatchObject({ orchestrator: 0, agents: 2, total: 2, loopsHit: 2, loopsTotal: 7 });
    const k = computeKpis({ views: [v], costToday: f.costSince(startOfDay(now)), tokensPerSecond: f.fleetTokensPerSecond(0), costPerMinute: f.fleetCostPerMinute(0) }, now);
    expect(k).toMatchObject({ agentsRunning: 4, agentsTotal: 6 });
  });

  it('keeps a finished nested agent the engine no longer lists, and aborts the running ones when the session ends', () => {
    const now = 1_791_648_100_000;
    const f = new FleetDb(openDb(':memory:'));
    const r = nestedReport();
    ingestReport(f, r, now - 2000);
    // Claude Code's agent list drops finished nested agents; a report that leaves them out deletes nothing.
    ingestReport(f, { ...r, session: { ...r.session, status: 'done', endReason: 'other' }, agents: r.agents.filter((a) => a.parentId === null) }, now - 1000);
    const agents = f.getAgents(r.session.id);
    expect(agents.map((a) => a.id).sort()).toEqual(['c', 'f', 'fc', 'g', 'p', 'pf']);
    expect(agents.find((a) => a.id === 'g')!.status).toBe('aborted');
    expect(agents.find((a) => a.id === 'g')!.parent_id).toBe('c');
  });
});

describe('computeKpis with a model that has no price (#66)', () => {
  it('leaves the unpriced session out of cost today and counts it', () => {
    const now = 1_791_648_100_000;
    const f = new FleetDb(openDb(':memory:'));
    const base = fixtureReport();
    ingestReport(f, base, now - 2000);
    const local: Report = {
      ...base,
      agents: [],
      events: [],
      session: { ...base.session, id: 'local', model: 'llama3.1:8b', plan: null, costUsd: null, context: { tokens: 5000, window: null, percent: null }, blowouts: 0 },
    };
    ingestReport(f, local, now - 1000);
    const views = ['5f0c2a8e-1b7d-4c3e-9a51-2d6f8e0b4c11', 'local'].map((id) =>
      sessionView({ row: f.getSession(id)!, agents: f.getAgents(id), blowouts: f.getBlowouts(id), samples: f.samplesSince(id, 0), heard: true }, now, CFG),
    );
    const local_ = views[1]!;
    expect(local_.modelFamily).toBe('other');
    expect(local_.costUsd).toBeNull();
    expect(local_.context.percent).toBeNull();
    const k = computeKpis({ views, costToday: f.costSince(startOfDay(now)), tokensPerSecond: [], costPerMinute: [] }, now);
    expect(k.costToday).toBeCloseTo(12.84);
    expect(k.unpricedSessions).toBe(1);
  });

  it('does not count a session idle on background work as waiting on you (#119)', () => {
    const now = 1_791_648_100_000;
    const f = new FleetDb(openDb(':memory:'));
    const base = fixtureReport();
    const idle = (id: string, background?: { tasks: { type: 'shell'; description: string; status: string }[]; wakeAt: number | null }): Report => ({
      ...base,
      agents: [],
      events: [],
      session: { ...base.session, id, status: 'waiting', waitReason: background ? null : 'input', plan: null, ...(background ? { background } : {}) },
    });
    ingestReport(f, idle('you'), now - 1000);
    ingestReport(f, idle('bg', { tasks: [{ type: 'shell', description: 'nightly build', status: 'running' }], wakeAt: null }), now - 1000);
    const views = ['you', 'bg'].map((id) => sessionView({ row: f.getSession(id)!, agents: f.getAgents(id), blowouts: f.getBlowouts(id), samples: f.samplesSince(id, 0), heard: true }, now, CFG));
    expect(views[1]).toMatchObject({ status: 'waiting', waitReason: null, background: { tasks: [{ type: 'shell', description: 'nightly build', status: 'running' }], wakeAt: null } });
    expect(views[0]!.background ?? null).toBeNull();
    const k = computeKpis({ views, costToday: 0, tokensPerSecond: [], costPerMinute: [] }, now);
    expect(k.waiting).toBe(1);
    expect(k.live).toBe(2);
  });
});
