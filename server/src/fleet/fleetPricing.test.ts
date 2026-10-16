import { describe, it, expect } from 'vitest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import type { ModelUsage, Report } from './protocol.js';
import { fixtureReport } from './testing.js';

// Issue #117: the Admin's model prices change every cost figure at once, and the figures still add up.
const NOW = 1_791_648_000_000;
const M = 1_000_000;
const S = { input: 3, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 };
const use = (model: string, input: number, output = 0): ModelUsage[] => [
  { model, tier: 'std', tokens: { input, output, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } },
];

function setup() {
  const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, () => NOW);
  const r: Report = fixtureReport();
  r.sentAt = NOW;
  r.session.startedAt = NOW - 60_000;
  r.session.model = 'claude-sonnet-5-5';
  // The whole session: 2M Sonnet input, of which the four agents used 0.25M each and the orchestrator 1M.
  r.session.usageByModel = use('claude-sonnet-5-5', 2 * M);
  r.session.costUsd = 99; // the ledger: must be ignored once usage is present
  for (const a of r.agents) {
    a.model = 'claude-sonnet-5-5';
    a.usageByModel = use('claude-sonnet-5-5', M / 4);
  }
  return { fleet, r };
}

const cost = (f: Fleet) => {
  const v = f.liveViews()[0]!;
  return { session: v.costUsd!, agents: v.agents.map((a) => a.costUsdEst), v };
};

describe('Fleet prices model usage (#117)', () => {
  it('prices the session and agents from usage with the built-in table, ignoring the ledger', () => {
    const { fleet, r } = setup();
    fleet.ingest(r);
    const c = cost(fleet);
    expect(c.session).toBeCloseTo(4, 9);
    expect(c.agents[0]).toBeCloseTo(0.5, 9);
    expect(c.agents[1]).toBeCloseTo(0.5, 9);
  });

  it('an Admin price changes the card, the agents, Est. cost today and the owner split at once, and they add up', () => {
    const { fleet, r } = setup();
    fleet.ingest(r, 'Dana K.');
    expect(fleet.kpis().costToday).toBeCloseTo(4, 9);
    expect(fleet.prices.set('sonnet-5-5', { std: S })).toBeNull();
    const c = cost(fleet);
    expect(c.session).toBeCloseTo(6, 9);
    expect(c.agents[0]).toBeCloseTo(0.75, 9);
    expect(fleet.kpis().costToday).toBeCloseTo(6, 9);
    expect(fleet.kpis().costTodayByOwner).toEqual([{ owner: 'Dana K.', group: null, costUsd: expect.closeTo(6, 9) }]);
    // The orchestrator's own share is the session total minus its agents (1M input at 3 USD), so it adds up.
    const agentsSum = c.agents.reduce<number>((n, a) => n + (a ?? 0), 0);
    expect(c.session - agentsSum).toBeCloseTo(3, 9);
  });

  it('reset brings the built-in figures back', () => {
    const { fleet, r } = setup();
    fleet.ingest(r);
    fleet.prices.set('sonnet-5-5', { std: S });
    fleet.prices.reset('sonnet-5-5');
    expect(cost(fleet).session).toBeCloseTo(4, 9);
  });

  it('keeps the stored cost when the reporter sends an empty usage list', () => {
    const { fleet, r } = setup();
    r.session.usageByModel = [];
    r.session.costUsd = 7;
    fleet.ingest(r);
    expect(cost(fleet).session).toBe(7);
  });

  it('keeps the stored cost for a reporter that sends no usage', () => {
    const { fleet, r } = setup();
    delete r.session.usageByModel;
    delete r.agents[0]!.usageByModel;
    r.session.costUsd = 7;
    r.agents[0]!.costUsdEst = 1.5;
    fleet.ingest(r);
    fleet.prices.set('sonnet-5-5', { std: S });
    const c = cost(fleet);
    expect(c.session).toBe(7);
    expect(c.agents[0]).toBe(1.5);
    expect(fleet.kpis().costToday).toBe(7);
  });

  it('a non-Claude model reads n/a until the Admin prices it, then is priced', () => {
    const { fleet, r } = setup();
    r.session.model = 'llama3.1:8b';
    r.session.costUsd = null;
    r.session.usageByModel = use('llama3.1:8b', M);
    for (const a of r.agents) {
      delete a.usageByModel;
      a.costUsdEst = null;
      a.model = 'llama3.1:8b';
    }
    fleet.ingest(r);
    expect(cost(fleet).session).toBeNull();
    expect(fleet.prices.set('llama3.1:8b', { std: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } })).toBeNull();
    expect(cost(fleet).session).toBeCloseTo(1, 9);
  });

  it('History follows the prices too', () => {
    const { fleet, r } = setup();
    r.session.status = 'done';
    fleet.ingest(r);
    const hist = () => fleet.history(NOW - 3_600_000, NOW + 3_600_000)[0]!.costUsd;
    expect(hist()).toBeCloseTo(4, 9);
    fleet.prices.set('sonnet-5-5', { std: S });
    expect(hist()).toBeCloseTo(6, 9);
  });

  it('a price change reaches open browsers', () => {
    const { fleet, r } = setup();
    fleet.ingest(r);
    const seen: string[] = [];
    fleet.hub.add({ write: (c: string) => { seen.push(c); return true; } } as never);
    fleet.prices.set('sonnet-5-5', { std: S });
    expect(seen.join('')).toContain('event: snapshot');
  });

  // Issue #270: the cost-per-minute sparkline is drawn from the same priced figures as the card.
  describe('cost per minute (#270)', () => {
    const minuteSum = (f: Fleet) => f.kpis().costPerMinute.reduce((a, b) => a + b, 0);
    function twoReports(opts: { usage: boolean }) {
      let now = NOW - 30_000;
      const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, () => now);
      const send = (input: number, ledger: number) => {
        const r: Report = fixtureReport();
        r.sentAt = now;
        r.session.startedAt = NOW - 60_000;
        r.session.model = 'claude-sonnet-5-5';
        if (opts.usage) r.session.usageByModel = use('claude-sonnet-5-5', input);
        else delete r.session.usageByModel;
        r.session.costUsd = ledger;
        r.agents = [];
        fleet.ingest(r);
      };
      send(M, 10); // the ledger runs 10 -> 15, a step of 5, whatever the prices say
      now += 10_000;
      send(2 * M, 15);
      now = NOW;
      return fleet;
    }

    it('follows the priced figures, not the ledger, and moves with an Admin price', () => {
      const fleet = twoReports({ usage: true });
      const step = fleet.liveViews()[0]!.costUsd! - fleet.prices.pricing().costOf(use('claude-sonnet-5-5', M))!;
      expect(step).toBeGreaterThan(0);
      expect(minuteSum(fleet)).toBeCloseTo(step, 9);
      expect(fleet.prices.set('sonnet-5-5', { std: S })).toBeNull();
      expect(minuteSum(fleet)).toBeCloseTo(3, 9); // 1M more input at the Admin's 3 USD
    });

    it('stores a sample\'s usage only when it changes or a minute starts, and the series still adds up', () => {
      const db = new FleetDb(openDb(':memory:'));
      let now = NOW - 130_000; // a few seconds into a minute
      now -= now % 60_000;
      now += 5_000;
      const fleet = new Fleet(db, { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, () => now);
      const send = (input: number) => {
        const r: Report = fixtureReport();
        r.sentAt = now;
        r.session.startedAt = NOW - 300_000;
        r.session.model = 'claude-sonnet-5-5';
        r.session.usageByModel = use('claude-sonnet-5-5', input);
        r.agents = [];
        fleet.ingest(r);
      };
      send(M); // minute 0: stored
      for (let i = 0; i < 4; i++) { now += 1_000; send(M); } // unchanged: marked, not stored
      now += 1_000; send(2 * M); // changed: stored
      now += 1_000; send(2 * M); // unchanged: marked
      now += 60_000; send(2 * M); // a new minute starts: stored again
      const rows = db.db.prepare('SELECT usage_json FROM samples ORDER BY t').all() as { usage_json: string | null }[];
      expect(rows).toHaveLength(8);
      expect(rows.filter((r) => r.usage_json !== '=')).toHaveLength(3);
      now = NOW;
      expect(minuteSum(fleet)).toBeCloseTo(fleet.prices.pricing().costOf(use('claude-sonnet-5-5', M))!, 9);
      fleet.prices.set('sonnet-5-5', { std: S });
      expect(minuteSum(fleet)).toBeCloseTo(3, 9);
    });

    it('keeps the ledger samples for a reporter that sends no usage', () => {
      const fleet = twoReports({ usage: false });
      expect(minuteSum(fleet)).toBeCloseTo(5, 9);
    });
  });
});
