import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet, type FleetConfig } from './fleet.js';
import { startSweeper } from './sweeper.js';
import type { Report } from './protocol.js';
import { fixtureReport } from './testing.js';

const CFG: FleetConfig = { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' };
const T0 = 1_791_648_000_000;

interface Msg {
  event: string;
  data: unknown;
}

function collect(fleet: Fleet): Msg[] {
  const msgs: Msg[] = [];
  fleet.hub.add({
    write(chunk: string) {
      for (const block of chunk.split('\n\n')) {
        const m = /^event: (\w+)\ndata: (.*)$/s.exec(block);
        if (m) msgs.push({ event: m[1]!, data: JSON.parse(m[2]!) });
      }
    },
  });
  return msgs;
}

let clock = T0;
let db: FleetDb;
beforeEach(() => {
  clock = T0;
  db = new FleetDb(openDb(':memory:'));
});
afterEach(() => {
  vi.useRealTimers();
});

function makeFleet() {
  return new Fleet(db, CFG, () => clock);
}

/** Advances the clock one second at a time, sweeping each second as the timer would. */
function advance(fleet: Fleet, ms: number) {
  const end = clock + ms;
  while (clock < end) {
    clock = Math.min(end, clock + 1000);
    fleet.sweep();
  }
}

describe('lifecycle', () => {
  it('a silent session goes stale at 15 s and is dropped at 75 s with removed:dropped', () => {
    const fleet = makeFleet();
    const msgs = collect(fleet);
    const r = fixtureReport();
    fleet.ingest(r);
    advance(fleet, 15_000);
    expect(fleet.view(r.session.id)?.status).toBe('running');
    advance(fleet, 1000);
    expect(fleet.view(r.session.id)?.status).toBe('stale');
    expect(msgs.some((m) => m.event === 'session' && (m.data as { status: string }).status === 'stale')).toBe(true);
    advance(fleet, 58_000);
    expect(fleet.isLive(r.session.id)).toBe(true);
    advance(fleet, 1000);
    expect(fleet.isLive(r.session.id)).toBe(false);
    expect(msgs.filter((m) => m.event === 'removed')).toEqual([{ event: 'removed', data: { sessionId: r.session.id, reason: 'dropped' } }]);
    expect(db.getSession(r.session.id)?.dropped_at).toBe(clock);
    expect(msgs.some((m) => m.event === 'activity' && (m.data as { text: string }).text === 'heartbeat lost')).toBe(true);
  });

  it('a done session lingers 8 s, then removed:done', () => {
    const fleet = makeFleet();
    const msgs = collect(fleet);
    const r = fixtureReport();
    fleet.ingest({ ...r, session: { ...r.session, status: 'done', endReason: 'prompt_input_exit' } });
    advance(fleet, 7000);
    expect(fleet.isLive(r.session.id)).toBe(true);
    advance(fleet, 1000);
    expect(fleet.isLive(r.session.id)).toBe(false);
    expect(msgs.filter((m) => m.event === 'removed')).toEqual([{ event: 'removed', data: { sessionId: r.session.id, reason: 'done' } }]);
    expect(fleet.clearedToday()).toBe(1);
  });

  it('a dropped session that reports again returns to the live set', () => {
    const fleet = makeFleet();
    const r = fixtureReport();
    fleet.ingest(r);
    advance(fleet, 80_000);
    expect(fleet.isLive(r.session.id)).toBe(false);
    fleet.ingest({ ...r, events: [] });
    expect(fleet.isLive(r.session.id)).toBe(true);
    expect(fleet.view(r.session.id)?.status).toBe('running');
    expect(db.getSession(r.session.id)?.dropped_at).toBeNull();
  });

  it('a repeated final report does not bring an ended session back', () => {
    const fleet = makeFleet();
    const r = fixtureReport();
    const done: Report = { ...r, session: { ...r.session, status: 'done' } };
    fleet.ingest(done);
    advance(fleet, 9000);
    fleet.ingest(done);
    expect(fleet.isLive(r.session.id)).toBe(false);
  });

  it('after a restart, stored sessions are stale until they report, then recover', () => {
    const first = makeFleet();
    const r = fixtureReport();
    first.ingest(r);
    clock += 2000;
    const second = makeFleet();
    expect(second.liveIds()).toEqual([r.session.id]);
    expect(second.view(r.session.id)?.status).toBe('stale');
    second.ingest({ ...r, events: [] });
    expect(second.view(r.session.id)?.status).toBe('running');
  });

  it('after a restart, an unheard session gets the full drop window from the restart', () => {
    const first = makeFleet();
    const r = fixtureReport();
    first.ingest(r);
    clock += 10 * 60_000; // server was down ten minutes
    const second = makeFleet();
    advance(second, 59_000);
    expect(second.isLive(r.session.id)).toBe(true);
    advance(second, 1000);
    expect(second.isLive(r.session.id)).toBe(false);
  });

  it('writes a carry-forward sample each second for a quiet live session', () => {
    const fleet = makeFleet();
    const r = fixtureReport();
    fleet.ingest(r);
    advance(fleet, 3000);
    const samples = db.samplesSince(r.session.id, 0);
    expect(samples).toHaveLength(4);
    expect(samples.slice(1).every((s) => s.tokens_delta === 0 && s.peak_context === samples[0]!.peak_context)).toBe(true);
  });
});

describe('retention', () => {
  it('deletes samples older than 24 h, events older than 30 d and sessions ended 30 d ago', () => {
    const fleet = makeFleet();
    const r = fixtureReport();
    fleet.ingest(r);
    const day = 24 * 3600_000;
    db.upsertSample({ session_id: r.session.id, t: Math.floor((clock - day - 5000) / 1000), tokens_total: 1, tokens_delta: 1, peak_context: 0, running_agents: 0, cost_usd: null });
    db.insertEvent({ id: 'old', session_id: r.session.id, agent_id: null, t: clock - 31 * day, kind: 'note', text: 'old', data_json: null });
    const old: Report = { ...r, agents: [r.agents[0]!], events: [], session: { ...r.session, id: 'old-session', status: 'done' } };
    clock -= 31 * day;
    fleet.ingest(old);
    clock += 31 * day;
    const before = db.samplesSince(r.session.id, 0).length;
    const res = fleet.retain();
    expect(res.samples).toBeGreaterThanOrEqual(1);
    expect(db.samplesSince(r.session.id, 0).length).toBe(before - 1);
    expect(res.events).toBe(1);
    expect(res.sessions).toBe(1);
    expect(db.getSession('old-session')).toBeUndefined();
    expect(db.getAgents('old-session')).toEqual([]);
    expect(db.getSession(r.session.id)).toBeDefined();
  });
});

describe('startSweeper', () => {
  it('runs sweep every second and tick every 2 s, and survives a throwing sweep', () => {
    vi.useFakeTimers();
    const fleet = makeFleet();
    const sweep = vi.spyOn(fleet, 'sweep').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const tick = vi.spyOn(fleet, 'tick');
    const logs: string[] = [];
    const stop = startSweeper(fleet, { sweepMs: 1000, tickMs: 2000, retentionMs: 3600_000 }, (l) => logs.push(l));
    vi.advanceTimersByTime(4000);
    expect(sweep).toHaveBeenCalledTimes(4);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(logs).toEqual(['podium sweeper: sweep failed: boom']);
    stop();
    vi.advanceTimersByTime(4000);
    expect(sweep).toHaveBeenCalledTimes(4);
  });
});
