import { describe, it, expect } from 'vitest';
import { ACTIVITY_LEASE_SLACK_MS, ActivityStore, everyOf } from './activity.js';
import { MAIN_LOOP, type ActivityEntry, type Report } from './protocol.js';
import { fixtureReport } from './testing.js';

const T0 = 1_800_000_000_000;

function setup() {
  let t = T0;
  const store = new ActivityStore(() => t);
  return { store, advance: (ms: number) => (t += ms), now: () => t };
}

const tool = (at: number, text = `Read f${at}`): ActivityEntry => ({ at, kind: 'tool', text });

/** The fixture with a feed on the session's first agent and on the orchestrator. */
function report(agent: ActivityEntry[], main: ActivityEntry[] = [], feed = true): Report {
  const r = fixtureReport();
  r.session.activityFeed = feed;
  if (main.length) r.session.activity = main;
  r.agents[0]!.activity = agent;
  return r;
}

describe('ActivityStore', () => {
  it('keeps nothing for a loop nobody watches', () => {
    const { store } = setup();
    const r = report([tool(T0 + 1)]);
    store.ingest(r, 0);
    expect(store.watched(r.session.id)).toEqual([]);
    expect(store.watch(r.session.id, r.agents[0]!.id, 5).entries).toEqual([]);
  });

  it('a watch lists the loop in the reply and keeps what arrives from then on, in order, numbered', () => {
    const { store, advance } = setup();
    const r = report([]);
    const sid = r.session.id;
    const aid = r.agents[0]!.id;
    expect(store.watch(sid, aid, 5)).toMatchObject({ entries: [], since: T0 });
    expect(store.watched(sid)).toEqual([aid]);
    advance(1000);
    store.ingest(report([tool(T0 + 500), tool(T0 + 900)]), 0);
    // the next report repeats the snapshot and adds one: only the new one is added
    store.ingest(report([tool(T0 + 500), tool(T0 + 900), tool(T0 + 1000)]), 0);
    const got = store.watch(sid, aid, 5).entries;
    expect(got.map((e) => [e.seq, e.at])).toEqual([
      [1, T0 + 500],
      [2, T0 + 900],
      [3, T0 + 1000],
    ]);
  });

  it('never backfills: an entry from before the watch began is not kept', () => {
    const { store } = setup();
    const r = report([]);
    store.watch(r.session.id, r.agents[0]!.id, 5);
    store.ingest(report([tool(T0 - 5000), tool(T0 + 10)]), 0);
    expect(store.watch(r.session.id, r.agents[0]!.id, 5).entries.map((e) => e.at)).toEqual([T0 + 10]);
  });

  it('reads the reporter clock through the skew, so a reporter ahead of the server is not cut off', () => {
    const { store } = setup();
    const r = report([]);
    store.watch(r.session.id, r.agents[0]!.id, 5);
    // the reporter's clock is 3 s ahead: its T0 + 3010 is the server's T0 + 10
    store.ingest(report([tool(T0 + 3010)]), 3000);
    expect(store.watch(r.session.id, r.agents[0]!.id, 5).entries).toHaveLength(1);
    store.ingest(report([tool(T0 + 3010), tool(T0 + 2000)]), 3000);
    expect(store.watch(r.session.id, r.agents[0]!.id, 5).entries).toHaveLength(1);
  });

  it('keeps the last 20 per loop', () => {
    const { store } = setup();
    const r = report([]);
    store.watch(r.session.id, r.agents[0]!.id, 5);
    for (let i = 1; i <= 25; i++) store.ingest(report([tool(T0 + i)]), 0);
    const got = store.watch(r.session.id, r.agents[0]!.id, 5).entries;
    expect(got).toHaveLength(20);
    expect(got[0]!.at).toBe(T0 + 6);
    expect(got.at(-1)!.seq).toBe(25);
  });

  it('keeps the orchestrator under MAIN_LOOP, apart from its agents', () => {
    const { store } = setup();
    const r = report([]);
    store.watch(r.session.id, MAIN_LOOP, 5);
    store.ingest(report([tool(T0 + 1, 'Read agent')], [tool(T0 + 2, 'Agent Map call sites')]), 0);
    expect(store.watched(r.session.id)).toEqual([MAIN_LOOP]);
    expect(store.watch(r.session.id, MAIN_LOOP, 5).entries.map((e) => e.text)).toEqual(['Agent Map call sites']);
  });

  it('drops a loop when its lease lapses, and a later watch starts empty', () => {
    const { store, advance } = setup();
    const r = report([]);
    const sid = r.session.id;
    const aid = r.agents[0]!.id;
    store.watch(sid, aid, 5);
    store.ingest(report([tool(T0 + 1)]), 0);
    advance(5000 + ACTIVITY_LEASE_SLACK_MS - 1);
    expect(store.watched(sid)).toEqual([aid]);
    advance(2);
    store.expire();
    expect(store.watched(sid)).toEqual([]);
    expect(store.size).toBe(0);
    expect(store.watch(sid, aid, 5).entries).toEqual([]);
  });

  it('each fetch renews the lease for its own interval', () => {
    const { store, advance } = setup();
    const r = report([]);
    const sid = r.session.id;
    const aid = r.agents[0]!.id;
    store.watch(sid, aid, 60);
    advance(60_000);
    expect(store.watched(sid)).toEqual([aid]);
    store.watch(sid, aid, 60);
    advance(60_000);
    expect(store.watched(sid)).toEqual([aid]);
    advance(ACTIVITY_LEASE_SLACK_MS + 1);
    expect(store.watched(sid)).toEqual([]);
  });

  it('a second viewer on a shorter interval does not cut the first one short', () => {
    const { store, advance } = setup();
    const r = report([]);
    store.watch(r.session.id, r.agents[0]!.id, 60);
    store.watch(r.session.id, r.agents[0]!.id, 5);
    advance(30_000);
    expect(store.watched(r.session.id)).toHaveLength(1);
  });

  it('drops everything about a session that leaves or is deleted', () => {
    const { store } = setup();
    const r = report([]);
    store.watch(r.session.id, r.agents[0]!.id, 5);
    store.watch(r.session.id, MAIN_LOOP, 5);
    store.ingest(report([tool(T0 + 1)]), 0);
    store.dropSession(r.session.id);
    expect(store.size).toBe(0);
    expect(store.feedOn(r.session.id)).toBeNull();
  });

  it('remembers whether the reporter has the option on; null until a reporter says', () => {
    const { store } = setup();
    const r = report([], [], false);
    expect(store.feedOn(r.session.id)).toBeNull();
    store.ingest(r, 0);
    expect(store.feedOn(r.session.id)).toBe(false);
    store.ingest(report([], [], true), 0);
    expect(store.feedOn(r.session.id)).toBe(true);
  });
});

describe('everyOf', () => {
  it('takes the five intervals the panel offers and falls back to 5 s for anything else', () => {
    expect([5, 10, 20, 30, 60].map((n) => everyOf(String(n)))).toEqual([5, 10, 20, 30, 60]);
    expect(everyOf(undefined)).toBe(5);
    expect(everyOf('7')).toBe(5);
    expect(everyOf('3600')).toBe(5);
    expect(everyOf(['5', '60'])).toBe(5);
  });
});
