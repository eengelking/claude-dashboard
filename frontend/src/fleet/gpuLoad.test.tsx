// Guards for the GPU-load fixes (#81): continuous animations stay compositor-only, and they stop
// while the tab is hidden.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, renderHook, act } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { stateFrom } from "./testState";
import { usePageVisible } from "./usePageVisible";

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

describe("continuous animations", () => {
  it.each(["podium-pulse", "podium-blink"])("%s animates only transform and opacity", (name) => {
    const body = keyframes(name);
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(["transform", "opacity"]).toContain(p);
  });

  it("never runs an infinite animation on a smooth timing function", () => {
    // A smooth infinite animation draws a frame every display refresh, forever (see fleet.css).
    const infinite = [...css.matchAll(/animation:\s*[^;}]*infinite[^;}]*/g)].map((m) => m[0]);
    expect(infinite.length).toBeGreaterThan(0);
    for (const a of infinite) expect(a).toMatch(/steps\(/);
  });

  it("does not slide the progress bars, which would redraw them every refresh after each update", () => {
    const rule = css.match(/\.podium \.bar > i\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toMatch(/transition/);
  });

  it("hands blinking elements their own layer so they do not repaint", () => {
    expect(css).toMatch(/\.crew \.a\.running\s*\{[^}]*will-change:\s*opacity/);
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
});
