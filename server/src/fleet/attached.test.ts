// Issue #45: after /exit under the Claude Code daemon a background job keeps running with no client attached.
// The reporter says whether any client is attached; the server keeps when that last became false and puts
// the moment the card leaves the wall on the view. A reporter that sends nothing counts as attached.
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet, type FleetConfig } from './fleet.js';
import type { Report } from './protocol.js';
import { fixtureReport } from './testing.js';

const CFG: FleetConfig = { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' };
const T0 = 1_791_648_000_000;

let clock = T0;
let db: FleetDb;
beforeEach(() => {
  clock = T0;
  db = new FleetDb(openDb(':memory:'));
});
const makeFleet = (cfg: FleetConfig = CFG) => new Fleet(db, cfg, () => clock);

/** The fixture session, reported with the given attach state (undefined = a reporter that predates the field). */
function report(attached: boolean | null | undefined): Report {
  const r = structuredClone(fixtureReport());
  const s = r.session as unknown as Record<string, unknown>;
  if (attached === undefined) delete s.attached;
  else s.attached = attached;
  return r;
}

describe('attached', () => {
  it('is on the view as reported, true or false', () => {
    const fleet = makeFleet();
    fleet.ingest(report(true));
    expect(fleet.view(fixtureReport().session.id)?.attached).toBe(true);
    fleet.ingest(report(false));
    expect(fleet.view(fixtureReport().session.id)?.attached).toBe(false);
  });

  it('counts a report with no field, from an older reporter, as attached and never hides it', () => {
    const fleet = makeFleet();
    fleet.ingest(report(undefined));
    const v = fleet.view(fixtureReport().session.id)!;
    expect(v.attached).toBeNull();
    expect(v.hideAt).toBeNull();
  });
});

describe('hideAt (when a card nobody is attached to leaves the wall)', () => {
  const id = fixtureReport().session.id;

  it('is null while a client is attached', () => {
    const fleet = makeFleet();
    fleet.ingest(report(true));
    expect(fleet.view(id)?.hideAt).toBeNull();
  });

  it('is the first report with nobody attached plus the delay (60 s by default)', () => {
    const fleet = makeFleet();
    fleet.ingest(report(false));
    expect(fleet.view(id)?.hideAt).toBe(T0 + 60_000);
  });

  it('keeps counting from the first detached report, not the latest', () => {
    const fleet = makeFleet();
    fleet.ingest(report(false));
    clock += 20_000;
    fleet.ingest(report(false));
    expect(fleet.view(id)?.hideAt).toBe(T0 + 60_000);
    expect(db.getSession(id)?.detached_at).toBe(T0);
  });

  it('follows DETACHED_HIDE_AFTER_MS', () => {
    const fleet = makeFleet({ ...CFG, detachedHideAfterMs: 5_000 });
    fleet.ingest(report(false));
    expect(fleet.view(id)?.hideAt).toBe(T0 + 5_000);
  });

  it('clears when someone attaches again, and starts over at the next detach', () => {
    const fleet = makeFleet();
    fleet.ingest(report(false));
    clock += 30_000;
    fleet.ingest(report(true));
    expect(fleet.view(id)?.hideAt).toBeNull();
    expect(db.getSession(id)?.detached_at).toBeNull();
    clock += 30_000;
    fleet.ingest(report(false));
    expect(fleet.view(id)?.hideAt).toBe(T0 + 60_000 + 60_000);
  });

  it('survives a settings-hook event, which carries no attach state', () => {
    const fleet = makeFleet();
    fleet.ingest(report(false));
    fleet.ingestHook({ hook_event_name: 'UserPromptSubmit', session_id: id, cwd: '/Users/dev/x', prompt: 'hi' });
    const v = fleet.view(id)!;
    expect(v.attached).toBe(false);
    expect(v.hideAt).toBe(T0 + 60_000);
  });

  it('does not take the session out of the live set or the totals', () => {
    const fleet = makeFleet();
    fleet.ingest(report(false));
    clock += 10 * 60_000;
    expect(fleet.isLive(id)).toBe(true);
  });
});
