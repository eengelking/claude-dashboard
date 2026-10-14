import { describe, it, expect } from "vitest";
import { EVENT_CAP, fleetReducer, initialState, type FleetState } from "./store";
import { makeEvent, makeKpis, makeSession, makeState } from "./fixtures";

function snap(over = {}): FleetState {
  return fleetReducer(initialState, { type: "snapshot", body: makeState(over), at: 100 });
}

describe("fleetReducer", () => {
  it("snapshot replaces everything and goes live", () => {
    const s = snap();
    expect(s.phase).toBe("live");
    expect(Object.keys(s.sessions)).toEqual(["s1"]);
    expect(s.events).toHaveLength(1);
    expect(s.kpis?.live).toBe(1);
    expect(s.lastMessageAt).toBe(100);
    // a later snapshot without s1 marks it gone
    const s2 = fleetReducer(s, { type: "snapshot", body: makeState({ sessions: [], events: [] }), at: 200 });
    expect(s2.sessions).toEqual({});
    expect(s2.gone.s1).toBe("done");
  });

  it("snapshot carries the Admin's feature flags, and keeps the last ones when a body has none", () => {
    expect(initialState.features).toEqual({});
    let s = snap({ features: { "activity-feed": false } });
    expect(s.features).toEqual({ "activity-feed": false });
    s = fleetReducer(s, { type: "snapshot", body: { ...makeState(), features: undefined as never }, at: 200 });
    expect(s.features).toEqual({ "activity-feed": false });
  });

  it("session upserts and revives a gone session", () => {
    let s = snap();
    s = fleetReducer(s, { type: "session", view: makeSession({ id: "s2", name: "two" }), at: 110 });
    s = fleetReducer(s, { type: "session", view: makeSession({ name: "renamed" }), at: 120 });
    expect(Object.keys(s.sessions).sort()).toEqual(["s1", "s2"]);
    expect(s.sessions.s1!.name).toBe("renamed");
    s = fleetReducer(s, { type: "removed", sessionId: "s1", reason: "done", at: 130 });
    expect(s.gone.s1).toBe("done");
    s = fleetReducer(s, { type: "session", view: makeSession(), at: 140 });
    expect(s.gone.s1).toBeUndefined();
    expect(s.leaving.s1).toBeUndefined();
  });

  it("activity prepends, dedupes and caps at 150", () => {
    let s = snap({ events: [] });
    for (let i = 0; i < EVENT_CAP + 30; i++) {
      s = fleetReducer(s, { type: "activity", event: makeEvent({ id: `e${i}`, t: 1000 + i }), at: 100 + i });
    }
    expect(s.events).toHaveLength(EVENT_CAP);
    expect(s.events[0]!.id).toBe(`e${EVENT_CAP + 29}`);
    s = fleetReducer(s, { type: "activity", event: makeEvent({ id: `e${EVENT_CAP + 29}`, t: 1000 }), at: 999 });
    expect(s.events.filter((e) => e.id === `e${EVENT_CAP + 29}`)).toHaveLength(1);
    // an out-of-order event lands by time
    s = fleetReducer(s, { type: "activity", event: makeEvent({ id: "late", t: 1100 }), at: 1000 });
    expect(s.events.findIndex((e) => e.id === "late")).toBeGreaterThan(0);
  });

  it("removed starts the leave animation, then purge drops the session", () => {
    let s = snap();
    s = fleetReducer(s, { type: "removed", sessionId: "s1", reason: "dropped", at: 150 });
    expect(s.leaving.s1).toBe(150);
    expect(s.sessions.s1).toBeDefined();
    expect(s.clearedToday).toBe(1);
    s = fleetReducer(s, { type: "purge", sessionId: "s1" });
    expect(s.sessions.s1).toBeUndefined();
    expect(s.gone.s1).toBe("dropped");
  });

  it("tick updates KPIs and server time; disconnected flips the phase until the next message", () => {
    let s = snap();
    s = fleetReducer(s, { type: "tick", serverTime: 5000, kpis: makeKpis({ live: 9 }), at: 300 });
    expect(s.kpis?.live).toBe(9);
    expect(s.serverTime).toBe(5000);
    s = fleetReducer(s, { type: "disconnected", at: 400 });
    expect(s.phase).toBe("disconnected");
    s = fleetReducer(s, { type: "tick", serverTime: 6000, kpis: makeKpis(), at: 500 });
    expect(s.phase).toBe("live");
  });
});
