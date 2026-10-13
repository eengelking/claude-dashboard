// Guards for the GPU-load fixes (#81): continuous animations stay compositor-only, and they stop
// while the tab is hidden.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, renderHook, act } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { stateFrom } from "./testState";
import { usePageVisible } from "./usePageVisible";
import { BEAT_MS, useHeartbeat } from "./useHeartbeat";

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

const css = readFileSync(resolve(process.cwd(), "src/fleet/fleet.css"), "utf8");

function keyframes(name: string): string {
  const m = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n(?=\\S)`));
  if (!m) throw new Error(`no @keyframes ${name}`);
  return m[1]!;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("continuous motion", () => {
  it("never uses an infinite CSS animation: it moves on one shared beat instead", () => {
    // Each infinite animation steps at its own phase, so together they change the screen on almost
    // every display refresh. One beat for all of them keeps the page to a few frames a second.
    expect(css).not.toMatch(/animation:[^;}]*infinite/);
  });

  it("draws the pulse ring and the blinks from the beat", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(css).toMatch(new RegExp(`\\.podium\\[data-beat="${n}"\\][^{]*\\.dot\\.running::after`));
    }
    expect(css).toMatch(/\.podium\[data-beat="2"\][^{]*\.crew \.a\.running/);
    expect(css).toMatch(/\.podium\[data-beat="2"\][^{]*\.step\.active \.ic::after/);
  });

  it("does not slide the progress bars, which would redraw them every refresh after each update", () => {
    const rule = css.match(/\.podium \.bar > i\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toMatch(/transition/);
  });
});

describe("useHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(enabled: boolean) {
    const el = document.createElement("div");
    const ref = { current: el };
    const hook = renderHook(({ on }) => useHeartbeat(ref, on), { initialProps: { on: enabled } });
    return { el, hook };
  }

  it("steps data-beat through 0..3 on one timer", () => {
    const { el } = setup(true);
    expect(el.dataset.beat).toBe("0");
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      act(() => void vi.advanceTimersByTime(BEAT_MS));
      seen.push(el.dataset.beat!);
    }
    expect(seen).toEqual(["1", "2", "3", "0", "1"]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("removes the attribute and the timer when disabled, and resumes when enabled", () => {
    const { el, hook } = setup(true);
    hook.rerender({ on: false });
    expect(el.dataset.beat).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    hook.rerender({ on: true });
    expect(el.dataset.beat).toBe("0");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stays still under prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const { el } = setup(true);
    expect(el.dataset.beat).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("usePageVisible", () => {
  it("follows the page visibility", () => {
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
    act(() => setVisibility("hidden"));
    expect(result.current).toBe(false);
    act(() => setVisibility("visible"));
    expect(result.current).toBe(true);
  });
});

describe("FleetView", () => {
  it("marks the console paused while the tab is hidden, and the CSS stops animations for it", () => {
    const { container } = render(<FleetView state={stateFrom({})} />);
    const root = container.querySelector(".podium")!;
    expect(root.classList.contains("paused")).toBe(false);
    act(() => setVisibility("hidden"));
    expect(root.classList.contains("paused")).toBe(true);
    act(() => setVisibility("visible"));
    expect(root.classList.contains("paused")).toBe(false);
    expect(css).toMatch(/\.podium\.paused[^{]*\{[^}]*animation-play-state:\s*paused/);
  });

  it("runs the beat on the console root, and stops it while the tab is hidden", () => {
    const { container } = render(<FleetView state={stateFrom({})} />);
    const root = container.querySelector<HTMLElement>(".podium")!;
    expect(root.dataset.beat).toBe("0");
    act(() => setVisibility("hidden"));
    expect(root.dataset.beat).toBeUndefined();
    act(() => setVisibility("visible"));
    expect(root.dataset.beat).toBe("0");
  });
});
