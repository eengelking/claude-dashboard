import { describe, it, expect } from 'vitest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { startOfDay } from './derive.js';
import type { ModelUsage, Report } from './protocol.js';
import { fixtureReport } from './testing.js';

// Issue #276: a cost that is not known reads as a dash, not $0.00, and priced spend stays visible next to unpriced spend.
const NOW = 1_791_648_000_000;
const M = 1_000_000;
const use = (model: string, input: number): ModelUsage[] => [
  { model, tier: 'std', tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } },
];
const S = { input: 3, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 };

function fleetAt(now: () => number) {
  return new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, now);
}

describe('an unknown cost is not $0.00 (#276)', () => {
  it('a loop that has not reported a model yet has no cost, and one with a model and no spend costs 0', () => {
    const fleet = fleetAt(() => NOW);
    const r: Report = fixtureReport();
    r.sentAt = NOW;
    r.agents = r.agents.slice(0, 2);
    r.agents[0]!.model = null;
    r.agents[0]!.costUsdEst = 0;
    r.agents[1]!.model = 'claude-sonnet-5-5';
    r.agents[1]!.costUsdEst = 0;
    for (const a of r.agents) delete a.usageByModel; // nothing priced from tokens: the cost is whatever the reporter sent
    fleet.ingest(r);
    const byId = new Map(fleet.liveViews()[0]!.agents.map((a) => [a.id, a.costUsdEst]));
    expect(byId.get(r.agents[0]!.id)).toBeNull();
    expect(byId.get(r.agents[1]!.id)).toBe(0);
  });
});

describe('the unpriced caption follows the Admin prices (#276)', () => {
  it('counts a local-model session until the Admin prices that model', () => {
    const fleet = fleetAt(() => NOW);
    const r: Report = fixtureReport();
    r.sentAt = NOW;
    r.session.model = 'qwen3-coder';
    r.session.usageByModel = use('qwen3-coder', M);
    r.agents = [];
    fleet.ingest(r);
    expect(fleet.kpis().unpricedSessions).toBe(1);
    expect(fleet.prices.set('qwen3-coder', { std: S })).toBeNull();
    expect(fleet.liveViews()[0]!.costUsd).toBeCloseTo(3, 9);
    expect(fleet.kpis().unpricedSessions).toBe(0);
  });

  it('does not count a session that switched from Claude to a local model, whose Claude spend still shows', () => {
    const fleet = fleetAt(() => NOW);
    const r: Report = fixtureReport();
    r.sentAt = NOW;
    r.session.model = 'qwen3-coder';
    r.session.usageByModel = [...use('claude-sonnet-5-5', M), ...use('qwen3-coder', M)];
    r.agents = [];
    fleet.ingest(r);
    expect(fleet.liveViews()[0]!.costUsd).toBeCloseTo(2, 9);
    expect(fleet.kpis().unpricedSessions).toBe(0);
  });
});

describe('a session first heard after the day began (#276)', () => {
  it('counts what it spent since the server first heard of it', () => {
    const midnight = startOfDay(NOW);
    let clock = midnight + 30_000;
    const fleet = fleetAt(() => clock);
    const send = (cost: number) => {
      const r: Report = fixtureReport();
      r.sentAt = clock;
      // Claimed to have started a minute before midnight, close enough to the first sighting to be believed.
      r.session.startedAt = midnight - 60_000;
      r.session.costUsd = cost;
      delete r.session.usageByModel; // the ledger prices it, as for a reporter older than 0.12.0
      r.agents = [];
      fleet.ingest(r);
    };
    send(5);
    clock = midnight + 3_600_000;
    send(8);
    expect(fleet.kpis().costToday).toBeCloseTo(3, 9);
  });
});

describe('a session that started before midnight and now reports no ledger cost (#286)', () => {
  const send = (fleet: Fleet, at: number, ledger: number | null, usage: ModelUsage[] | undefined) => {
    const r: Report = fixtureReport();
    r.sentAt = at;
    r.session.startedAt = startOfDay(NOW) - 3_600_000;
    r.session.costUsd = ledger;
    if (usage) r.session.usageByModel = usage;
    else delete r.session.usageByModel;
    r.agents = [];
    fleet.ingest(r);
  };

  it('counts the priced spend that came after midnight, from the usage on the last sample before it', () => {
    const midnight = startOfDay(NOW);
    let clock = midnight - 60_000;
    const fleet = fleetAt(() => clock);
    send(fleet, clock, 2, use('claude-sonnet-5-5', M)); // 1M tokens, $2 on Claude before midnight
    clock = midnight + 3_600_000;
    // It then switched to a local model: the mod sends no ledger cost, and the Claude usage has grown to 2M tokens ($4).
    send(fleet, clock, null, [...use('claude-sonnet-5-5', 2 * M), ...use('qwen3-coder', M)]);
    expect(fleet.kpis().costToday).toBeCloseTo(2, 9);
    expect(fleet.kpis().costTodayByOwner.reduce((n, o) => n + o.costUsd, 0)).toBeCloseTo(2, 9);
  });

  it('still counts nothing when no sample has usage and there is no ledger cost', () => {
    const midnight = startOfDay(NOW);
    let clock = midnight - 60_000;
    const fleet = fleetAt(() => clock);
    send(fleet, clock, 3, undefined);
    clock = midnight + 3_600_000;
    send(fleet, clock, null, undefined);
    expect(fleet.kpis().costToday).toBe(0);
  });
});
