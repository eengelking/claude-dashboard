// The console's update interval (#138): the stored choice, what counts as urgent, and holding state between updates.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, fireEvent } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { makeAgent, makeSession } from "./fixtures";
import { fleetReducer } from "./store";
import { stateFrom } from "./testState";
import { isUrgentChange, readUpdateEvery, UPDATE_CHOICES, UPDATE_KEY, writeUpdateEvery } from "./updateInterval";
import { useHeldState } from "./useHeldState";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the stored interval", () => {
  it("offers 2, 5, 10, 20, 30 and 60 seconds, 2 first", () => {
    expect(UPDATE_CHOICES).toEqual([2, 5, 10, 20, 30, 60]);
  });

  it("defaults to 2 seconds when nothing is stored", () => {
    expect(readUpdateEvery()).toBe(2);
  });

  it("returns a stored choice and keeps it across a reload", () => {
    writeUpdateEvery(30);
    expect(JSON.parse(localStorage.getItem(UPDATE_KEY)!)).toBe(30);
    expect(readUpdateEvery()).toBe(30);
  });

  it("falls back to 2 seconds for a value that is not offered", () => {
    for (const bad of [0, 3, 90, "10", null, {}]) {
      localStorage.setItem(UPDATE_KEY, JSON.stringify(bad));
      expect(readUpdateEvery()).toBe(2);
    }
    localStorage.setItem(UPDATE_KEY, "not json");
    expect(readUpdateEvery()).toBe(2);
  });
});

describe("isUrgentChange", () => {
  const base = () => stateFrom({ sessions: [makeSession({ id: "a", status: "running" })] });

  it("is false when only numbers move", () => {
    const held = base();
    const next = fleetReducer(held, { type: "session", view: makeSession({ id: "a", status: "running", costUsd: 9 }) });
    expect(isUrgentChange(held, next)).toBe(false);
  });

  it("is true when a session starts waiting for you", () => {
    const held = base();
    const next = fleetReducer(held, { type: "session", view: makeSession({ id: "a", status: "waiting", waitReason: "input" }) });
    expect(isUrgentChange(held, next)).toBe(true);
  });

  it("is true when a session goes stale or a new one arrives already waiting", () => {
    const held = base();
    const stale = fleetReducer(held, { type: "session", view: makeSession({ id: "a", status: "stale" }) });
    expect(isUrgentChange(held, stale)).toBe(true);
    const fresh = fleetReducer(held, { type: "session", view: makeSession({ id: "b", status: "waiting", waitReason: "permission" }) });
    expect(isUrgentChange(held, fresh)).toBe(true);
  });

  it("is false for a session that was already waiting", () => {
    const held = stateFrom({ sessions: [makeSession({ id: "a", status: "waiting", waitReason: "input" })] });
    const next = fleetReducer(held, { type: "session", view: makeSession({ id: "a", status: "waiting", waitReason: "input", costUsd: 3 }) });
    expect(isUrgentChange(held, next)).toBe(false);
  });

  it("is true when an agent fails", () => {
    const held = stateFrom({ sessions: [makeSession({ id: "a", agents: [makeAgent({ id: "g1" })] })] });
    const failed = makeAgent({ id: "g1", status: "failed", failure: { class: "error", at: 1 } as never });
    const next = fleetReducer(held, { type: "session", view: makeSession({ id: "a", agents: [failed] }) });
    expect(isUrgentChange(held, next)).toBe(true);
  });

  it("is true for the viewer's own clicks: a wall setting, a feature flag or a removed session", () => {
    const held = base();
    const wall = fleetReducer(held, { type: "wall", wall: { ...held.wall, showBackgroundSessions: !held.wall.showBackgroundSessions } });
    expect(isUrgentChange(held, wall)).toBe(true);
    expect(isUrgentChange(held, { ...held, features: { ...held.features, "activity-feed": false } })).toBe(true);
    const removed = fleetReducer(held, { type: "removed", sessionId: "a", reason: "dropped" as never, at: 1 });
    expect(isUrgentChange(held, removed)).toBe(true);
  });

  it("is true when the connection phase changes", () => {
    const held = base();
    expect(isUrgentChange(held, fleetReducer(held, { type: "disconnected", at: 1 }))).toBe(true);
  });
});

describe("useHeldState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const never = () => false;

  it("shows a new value only on the next interval", () => {
    const { result, rerender } = renderHook(({ v }) => useHeldState(v, 10_000, never), { initialProps: { v: 1 } });
    rerender({ v: 2 });
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(9_999));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(2);
  });

  it("shows the newest value, not each one in between", () => {
    const { result, rerender } = renderHook(({ v }) => useHeldState(v, 10_000, never), { initialProps: { v: 1 } });
    rerender({ v: 2 });
    rerender({ v: 3 });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(3);
  });

  it("shows an urgent change at once", () => {
    const { result, rerender } = renderHook(({ v }) => useHeldState(v, 60_000, (_held, next) => next === 99), { initialProps: { v: 1 } });
    rerender({ v: 2 });
    expect(result.current).toBe(1);
    rerender({ v: 99 });
    expect(result.current).toBe(99);
  });

  it("catches up when the interval changes", () => {
    const { result, rerender } = renderHook(({ v, ms }) => useHeldState(v, ms, never), { initialProps: { v: 1, ms: 60_000 } });
    rerender({ v: 2, ms: 60_000 });
    expect(result.current).toBe(1);
    rerender({ v: 2, ms: 2_000 });
    expect(result.current).toBe(2);
  });
});

describe("the Refresh every control", () => {
  it("sits left of the Theme controls and lists the six choices", () => {
    const onChange = vi.fn();
    render(<FleetView state={stateFrom()} updateEvery={2} onUpdateEvery={onChange} />);
    const select = screen.getByLabelText("Refresh every") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["2s", "5s", "10s", "20s", "30s", "60s"]);
    expect(select.value).toBe("2");
    const theme = screen.getByLabelText("Theme");
    expect(select.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(select, { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(30);
  });
});
