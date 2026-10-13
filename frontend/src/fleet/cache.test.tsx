import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { SessionCard } from "./components/SessionCard";
import { fleetReducer } from "./store";
import { makeKpis, makeSession } from "./fixtures";
import { stateFrom } from "./testState";
import type { CacheView, SessionView } from "./types";

afterEach(cleanup);

const CFG = { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000, detachedHideAfterMs: 60_000 };
const NOW = 2_000_000;

const OFF = { on: false, state: "off" as const, stopReason: null, pings: 0, costUsdEst: 0, lastPingAt: null, untilAt: null };

function cache(over: Partial<CacheView> = {}): CacheView {
  return { state: "cooling", expiresAt: NOW + 42_000, ttlMs: 300_000, tokens: 410_000, coldCostUsd: 1.968, warming: OFF, alert: "tip", ...over };
}

const idle = (over: Partial<SessionView> = {}) => makeSession({ status: "waiting", waitReason: "input", cache: cache(), ...over });

function card(s: SessionView) {
  return render(<SessionCard s={s} now={NOW} config={CFG} entering={false} leaving={false} onOpen={() => {}} />).container;
}

describe("the cooling alert on a card (#27)", () => {
  it("counts down to the expiry and says what going cold costs, with the tip about cache warming", () => {
    const c = card(idle());
    const alert = c.querySelector(".alert.cache")!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("Prompt cache expires in 42 s");
    expect(alert.textContent).toContain("About 410k tokens would be written to the cache again, roughly $1.97 more.");
    expect(alert.textContent).toContain("/podium warm on");
    expect(alert.textContent).toContain("cacheWarming");
  });

  it("from the third alert on (plain), no tip", () => {
    const alert = card(idle({ cache: cache({ alert: "plain" }) })).querySelector(".alert.cache")!;
    expect(alert.textContent).toContain("Prompt cache expires in 42 s");
    expect(alert.textContent).not.toContain("/podium warm on");
  });

  it("no alert when the counter says none, when the session runs, or when the cache is warm", () => {
    expect(card(idle({ cache: cache({ alert: null }) })).querySelector(".alert.cache")).toBeNull();
    expect(card(idle({ status: "running", waitReason: null })).querySelector(".alert.cache")).toBeNull();
    expect(card(idle({ cache: cache({ state: "warm", alert: null }) })).querySelector(".alert.cache")).toBeNull();
  });

  it("warming on but stopped: the tip says it stopped, why, and what to do, not how to turn it on", () => {
    const warming = { ...OFF, on: true, state: "stopped" as const, stopReason: "max-duration" as const, pings: 7, costUsdEst: 0.05 };
    const alert = card(idle({ cache: cache({ warming }) })).querySelector(".alert.cache")!;
    expect(alert.textContent).toContain("Prompt cache expires in 42 s");
    expect(alert.textContent).toContain("Cache warming has stopped");
    expect(alert.textContent).toContain("reached its time limit");
    expect(alert.textContent).toContain("send that session a prompt");
    expect(alert.textContent).not.toContain("/podium warm on");
    const timeout = card(idle({ cache: cache({ warming: { ...warming, stopReason: "timeout" } }) })).querySelector(".alert.cache")!;
    expect(timeout.textContent).toContain("no answer");
  });

  it("a permission wait: says the cache will expire and that warming only works while it waits for a prompt", () => {
    for (const warming of [OFF, { ...OFF, on: true, state: "ready" as const }]) {
      const alert = card(idle({ waitReason: "permission", cache: cache({ alert: "plain", warming }) })).querySelector(".alert.cache")!;
      expect(alert.textContent).toContain("Prompt cache expires in 42 s");
      expect(alert.textContent).toContain("Cache warming only works while a session waits for your prompt");
      expect(alert.textContent).not.toContain("/podium warm on");
    }
  });

  it("leaves out the cost when the model has no price", () => {
    const alert = card(idle({ cache: cache({ coldCostUsd: null }) })).querySelector(".alert.cache")!;
    expect(alert.textContent).toContain("About 410k tokens would be written to the cache again.");
  });

  it("shows warming instead: the pings sent and what they cost, and when it has stopped", () => {
    const warming = card(idle({ cache: cache({ alert: null, warming: { ...OFF, on: true, state: "warming", pings: 3, costUsdEst: 0.0123, untilAt: NOW + 600_000 } }) }));
    expect(warming.querySelector(".alert.cache")).toBeNull();
    expect(warming.querySelector(".chip.warming")!.textContent).toBe("cache kept warm · 3 pings · $0.01");
    const stopped = card(idle({ cache: cache({ alert: null, warming: { ...OFF, on: true, state: "stopped", stopReason: "max-duration", pings: 7, costUsdEst: 0.05 } }) }));
    expect(stopped.querySelector(".chip.warming")!.textContent).toBe("cache warming stopped · 7 pings · $0.05");
    expect(stopped.querySelector(".chip.warming")!.getAttribute("title")).toContain("reached its time limit");
  });
});

describe("the cooling alert in the rail and the counter (#27)", () => {
  it("the rail row counts down too", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const { container } = render(<FleetView state={stateFrom({ sessions: [idle({ name: "cooling-one" })] })} />);
      const row = [...container.querySelectorAll(".rail .ritem")].find((r) => r.textContent?.includes("cooling-one"))!;
      expect(within(row as HTMLElement).getByTitle(/Prompt cache expires in 42 s/).textContent).toContain("42 s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when alerts are off and offers one action that turns them back on", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const st = stateFrom({ cacheAlerts: { mode: "auto", shown: 2, suppressed: true } });
      render(<FleetView state={st} />);
      expect(screen.getByText(/Prompt cache alerts are off/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Turn cache alerts back on" }));
      expect(fetchMock).toHaveBeenCalledWith("/api/fleet/cache-alerts/reset", { method: "POST" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says nothing while alerts are on", () => {
    render(<FleetView state={stateFrom({ cacheAlerts: { mode: "auto", shown: 1, suppressed: false } })} />);
    expect(screen.queryByText(/Prompt cache alerts are off/)).toBeNull();
  });

  it("the counter follows every tick", () => {
    const st = stateFrom({ cacheAlerts: { mode: "auto", shown: 1, suppressed: false } });
    const next = fleetReducer(st, { type: "tick", serverTime: 3_000_000, kpis: makeKpis(), cacheAlerts: { mode: "auto", shown: 2, suppressed: true }, at: Date.now() });
    expect(next.cacheAlerts).toEqual({ mode: "auto", shown: 2, suppressed: true });
    const older = fleetReducer(next, { type: "tick", serverTime: 3_002_000, kpis: makeKpis(), at: Date.now() });
    expect(older.cacheAlerts).toEqual({ mode: "auto", shown: 2, suppressed: true });
  });
});
