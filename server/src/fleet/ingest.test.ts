import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, FleetDb } from './db.js';
import { ingestReport } from './ingest.js';
import type { Report } from './protocol.js';
import { fixtureReport } from './testing.js';

let f: FleetDb;
beforeEach(() => {
  f = new FleetDb(openDb(':memory:'));
});

const T0 = 1_791_648_000_000;

function withTokens(r: Report, input: number): Report {
  return { ...r, agents: [], session: { ...r.session, tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0 } } };
}

describe('ingestReport', () => {
  it('creates the session, its agents, events and blowout rows', () => {
    const res = ingestReport(f, fixtureReport(), T0);
    expect(res.created).toBe(true);
    expect(res.newEvents).toHaveLength(3);
    const s = f.getSession(res.sessionId)!;
    expect(s.name).toBe('invoice-v2');
    expect(f.getAgents(s.id).map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(f.countEvents(s.id)).toBe(3);
    const blows = f.getBlowouts(s.id);
    expect(blows).toHaveLength(1);
    expect(blows[0]).toMatchObject({ agent_id: 'a4', kind: 'auto-compact', tokens_before: 1004000, tokens_after: 300000 });
  });

  it('stores the full prompt and answer apart from the agent, and keeps them when a later report leaves them out', () => {
    const r = fixtureReport();
    r.agents[0]!.promptText = '# Task\n\nDo it.';
    ingestReport(f, r, T0);
    expect(f.getAgentTexts(r.session.id, r.agents[0]!.id)).toEqual({ prompt: '# Task\n\nDo it.', answer: null });
    const later = fixtureReport();
    later.agents[0]!.answerText = '## Done';
    ingestReport(f, later, T0 + 1000);
    expect(f.getAgentTexts(r.session.id, r.agents[0]!.id)).toEqual({ prompt: '# Task\n\nDo it.', answer: '## Done' });
    expect(f.getAgentTexts(r.session.id, 'nope')).toBeNull();
    const rows = f.getAgents(r.session.id);
    expect(rows.find((a) => a.id === r.agents[0]!.id)).toMatchObject({ prompt_chars: 14, answer_chars: 7 });
    expect(rows.find((a) => a.id === r.agents[1]!.id)).toMatchObject({ prompt_chars: null, answer_chars: null });
  });

  it('deleting the session deletes its texts', () => {
    const r = fixtureReport();
    r.agents[0]!.promptText = 'x';
    ingestReport(f, r, T0);
    f.deleteSession(r.session.id);
    expect(f.getAgentTexts(r.session.id, r.agents[0]!.id)).toBeNull();
  });

  it('stores the per-tool counts, and null for a reporter that sends none', () => {
    const r = fixtureReport();
    delete (r.agents[1] as { toolCounts?: unknown }).toolCounts;
    ingestReport(f, r, T0);
    const rows = f.getAgents(r.session.id);
    const json = (id: string) => rows.find((a) => a.id === id)!.tool_counts_json;
    expect(JSON.parse(json('a1')!)).toEqual({ Grep: 14, Read: 11, Glob: 6 });
    expect(json(r.agents[1]!.id)).toBeNull();
  });

  it('stores the main loop block, and null for a reporter that sends none', () => {
    const r = fixtureReport();
    ingestReport(f, r, T0);
    expect(JSON.parse(f.getSession(r.session.id)!.loop_json!)).toMatchObject({ toolCalls: 19, steps: { done: 23, total: null } });
    const old = fixtureReport();
    old.session.loop = null;
    ingestReport(f, old, T0 + 1000);
    expect(f.getSession(old.session.id)!.loop_json).toBeNull();
  });

  it('stores the changed files, and null for a reporter that sends none', () => {
    const r = fixtureReport();
    ingestReport(f, r, T0);
    expect(JSON.parse(f.getSession(r.session.id)!.files_json!)).toMatchObject({ total: 4, added: 85, removed: 119, since: 'start' });
    const old = fixtureReport();
    old.session.files = null;
    ingestReport(f, old, T0 + 1000);
    expect(f.getSession(old.session.id)!.files_json).toBeNull();
  });

  it('is idempotent: a repeat changes only last_seen_at', () => {
    const r = fixtureReport();
    ingestReport(f, r, T0);
    const before = { ...f.getSession(r.session.id)! };
    const agentsBefore = f.getAgents(r.session.id);
    const res = ingestReport(f, r, T0 + 3000);
    expect(res.newEvents).toHaveLength(0);
    const after = f.getSession(r.session.id)!;
    expect(after.last_seen_at).toBe(T0 + 3000);
    expect({ ...after, last_seen_at: before.last_seen_at }).toEqual(before);
    expect(f.getAgents(r.session.id)).toEqual(agentsBefore);
    expect(f.countEvents()).toBe(3);
    expect(f.countBlowouts()).toBe(1);
  });

  describe('start time (#43)', () => {
    const at = (r: Report, startedAt: number): Report => ({ ...r, session: { ...r.session, startedAt } });

    it('keeps the reported start when it is near the first sighting', () => {
      const r = at(fixtureReport(), T0 - 30_000);
      ingestReport(f, r, T0);
      expect(f.getSession(r.session.id)!.started_at).toBe(T0 - 30_000);
    });

    it('uses its own first-seen time when the report claims a start long before it was first seen', () => {
      const r = at(fixtureReport(), T0 - 20 * 60_000);
      ingestReport(f, r, T0);
      expect(f.getSession(r.session.id)!.started_at).toBe(T0);
    });

    it('does not let two sessions that report the same start share it', () => {
      const a = at(fixtureReport(), T0 - 3_600_000);
      const b = { ...a, session: { ...a.session, id: 'other-session' } };
      ingestReport(f, a, T0);
      ingestReport(f, b, T0 + 5 * 60_000);
      expect(f.getSession(a.session.id)!.started_at).toBe(T0);
      expect(f.getSession('other-session')!.started_at).toBe(T0 + 5 * 60_000);
    });

    it('uses its own first-seen time when the report claims a start in the future', () => {
      const r = at(fixtureReport(), T0 + 20 * 60_000);
      ingestReport(f, r, T0);
      expect(f.getSession(r.session.id)!.started_at).toBe(T0);
    });

    it('keeps the stored start when later reports change their claim', () => {
      const r = at(fixtureReport(), T0 - 10_000);
      ingestReport(f, r, T0);
      ingestReport(f, at(r, T0 + 1_000), T0 + 3_000);
      expect(f.getSession(r.session.id)!.started_at).toBe(T0 - 10_000);
    });
  });

  it('keeps an agent a later report omits, and aborts running agents when the session ends', () => {
    const r = fixtureReport();
    ingestReport(f, r, T0);
    const later: Report = { ...r, agents: r.agents.filter((a) => a.id !== 'a2'), events: [] };
    ingestReport(f, later, T0 + 1000);
    expect(f.getAgents(r.session.id).find((a) => a.id === 'a2')?.status).toBe('running');
    const done: Report = { ...later, session: { ...later.session, status: 'done', endReason: 'other' } };
    ingestReport(f, done, T0 + 2000);
    const agents = f.getAgents(r.session.id);
    expect(agents.find((a) => a.id === 'a2')).toMatchObject({ status: 'aborted', ended_at: T0 + 2000 });
    expect(agents.find((a) => a.id === 'a4')?.status).toBe('aborted');
    expect(agents.find((a) => a.id === 'a1')?.status).toBe('done');
    expect(agents.find((a) => a.id === 'a3')?.status).toBe('failed');
  });

  it('sets ended_at on done and clears it when the session reports running again', () => {
    const r = fixtureReport();
    const done: Report = { ...r, session: { ...r.session, status: 'done' } };
    const res = ingestReport(f, done, T0);
    expect(res.ended).toBe(true);
    expect(f.getSession(r.session.id)?.ended_at).toBe(T0);
    // a repeated done report keeps the first end time
    ingestReport(f, done, T0 + 5000);
    expect(f.getSession(r.session.id)?.ended_at).toBe(T0);
    const back = ingestReport(f, r, T0 + 9000);
    expect(back.revived).toBe(true);
    expect(f.getSession(r.session.id)).toMatchObject({ ended_at: null, status: 'running' });
  });

  it('revives a dropped session', () => {
    const r = fixtureReport();
    ingestReport(f, r, T0);
    f.setDropped(r.session.id, T0 + 80_000);
    const res = ingestReport(f, r, T0 + 90_000);
    expect(res.revived).toBe(true);
    expect(f.getSession(r.session.id)?.dropped_at).toBeNull();
  });

  it('samples: deltas against the previous second, never negative, one row per second', () => {
    const r = fixtureReport();
    ingestReport(f, withTokens(r, 1000), T0);
    ingestReport(f, withTokens(r, 4000), T0 + 1000);
    let rows = f.samplesSince(r.session.id, 0);
    expect(rows.map((x) => [x.tokens_total, x.tokens_delta])).toEqual([[1000, 0], [4000, 3000]]);
    ingestReport(f, withTokens(r, 2000), T0 + 2000);
    rows = f.samplesSince(r.session.id, 0);
    expect(rows[2]).toMatchObject({ tokens_total: 2000, tokens_delta: 0 });
    // two reports inside the same second leave one sample, recomputed against the second before
    ingestReport(f, withTokens(r, 5000), T0 + 3100);
    ingestReport(f, withTokens(r, 6000), T0 + 3900);
    rows = f.samplesSince(r.session.id, 0);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({ tokens_total: 6000, tokens_delta: 4000 });
  });

  it('samples peak context over the session and running agents, and the running count', () => {
    const r = fixtureReport();
    ingestReport(f, r, T0);
    const [s] = f.samplesSince(r.session.id, 0);
    expect(s!.peak_context).toBeCloseTo(0.93);
    expect(s!.running_agents).toBe(2);
    expect(s!.cost_usd).toBe(12.84);
  });

  it('uses server time, not the reporter clock, for last_seen_at', () => {
    const r = { ...fixtureReport(), sentAt: 42 };
    const res = ingestReport(f, r, T0);
    expect(f.getSession(r.session.id)?.last_seen_at).toBe(T0);
    expect(res.clockSkewMs).toBe(42 - T0);
  });
});

describe('ingestReport with a model that has no price (#66)', () => {
  it('drops a cost an older reporter priced as Sonnet, and keeps a Claude model\'s cost', () => {
    const r = fixtureReport();
    const local: Report = {
      ...r,
      agents: r.agents.map((a) => ({ ...a, model: 'llama3.1:8b', costUsdEst: 0.4 })),
      session: { ...r.session, model: 'llama3.1:8b', costUsd: 3.2 },
    };
    ingestReport(f, local, T0);
    expect(f.getSession(r.session.id)!.cost_usd).toBeNull();
    expect(f.getAgents(r.session.id).every((a) => a.cost_usd_est === null)).toBe(true);
    const f2 = new FleetDb(openDb(':memory:'));
    ingestReport(f2, r, T0);
    expect(f2.getSession(r.session.id)!.cost_usd).toBe(r.session.costUsd);
  });
});
