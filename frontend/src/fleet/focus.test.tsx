import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { MiniChart } from "./components/MiniCharts";
import { PlanPanel } from "./components/PlanPanel";
import { ContextBar } from "./components/Chips";
import { fleetReducer } from "./store";
import { makeAgent, makeSession } from "./fixtures";
import { stateFrom } from "./testState";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const agents = [
  makeAgent({ id: "r1", description: "Root one", modelFamily: "sonnet", effort: "medium", costUsdEst: 1, context: { tokens: 1, window: 1, percent: 20 } }),
  makeAgent({ id: "k1", parentId: "r1", description: "Kid one", modelFamily: "haiku", effort: "low", costUsdEst: 3, context: { tokens: 1, window: 1, percent: 80 }, blowouts: 2 }),
  makeAgent({ id: "f1", kind: "fork", type: "fork", description: "Fork one", modelFamily: "opus", effort: "xhigh", effortSource: "inherited", costUsdEst: 2, status: "failed", failure: { class: "Tool error", at: 1_500_000, tool: "Bash", call: "npm test", exitCode: 1, outputTail: ["FAIL x"], evidence: ["same call failed 3 times"], explanation: null, retriedAs: null } }),
];

function openFocus(sessionOver = {}) {
  const st = stateFrom({ sessions: [makeSession({ agents, ...sessionOver })] });
  const utils = render(<FleetView state={st} />);
  fireEvent.click(utils.container.querySelector(".wall .card")!);
  return { ...utils, st };
}

describe("orchestrator page", () => {
  it("opens from a card or the rail, and Back (All orchestrators) returns to the wall", () => {
    const { container } = openFocus();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("api-refactor");
    fireEvent.click(screen.getByRole("button", { name: /All orchestrators/ }));
    expect(container.querySelector(".wall")).toBeInTheDocument();
    fireEvent.click([...container.querySelectorAll(".rail .ritem")][1]!);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("api-refactor");
  });

  it("keeps the selection through session updates and clears it with a message when the session leaves", () => {
    const { st, rerender } = openFocus();
    const updated = fleetReducer(st, { type: "session", view: makeSession({ agents, name: "api-refactor", costUsd: 99 }), at: Date.now() });
    rerender(<FleetView state={updated} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("api-refactor");
    expect(screen.getByText("$99.00", { selector: ".fact .v" })).toBeInTheDocument();
    const gone = fleetReducer(updated, { type: "removed", sessionId: "s1", reason: "done", at: Date.now() });
    rerender(<FleetView state={gone} />);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText(/api-refactor ended and left the fleet/)).toBeInTheDocument();
  });

  it("has the facts bar with Copy resume command as the last cell", () => {
    const { container } = openFocus();
    const cells = [...container.querySelectorAll(".facts > .fact")];
    expect(cells.map((c) => c.querySelector(".k")?.textContent ?? c.textContent)).toEqual([
      "Orchestrator model", "Context", "Agents", "Est. cost", "Tokens", "Running for", "Copy resume command",
    ]);
    expect(container.querySelector(".facts .blow.l2")?.textContent).toContain("1 failed");
  });

  it("the failed button opens the first failure", () => {
    const { container } = openFocus();
    fireEvent.click(container.querySelector(".facts .blow.l2")!);
    expect(container.querySelector(".side .failbox")).toBeInTheDocument();
  });

  it("builds the tree from parentId; header sort flattens and reverses; Show as tree restores", () => {
    const { container } = openFocus();
    const rows = () => [...container.querySelectorAll("button.trow:not(.root)")].map((r) => r.getAttribute("data-agent"));
    const guides = () => [...container.querySelectorAll("button.trow:not(.root)")].map((r) => r.querySelectorAll(".indent s").length);
    expect(rows()).toEqual(["r1", "k1", "f1"]);
    expect(guides()).toEqual([1, 2, 1]);
    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    expect(rows()).toEqual(["k1", "f1", "r1"]);
    expect(guides()).toEqual([0, 0, 0]);
    fireEvent.click(screen.getByRole("button", { name: /Cost/ }));
    expect(rows()).toEqual(["r1", "f1", "k1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Model/ }));
    expect(rows()).toEqual(["k1", "f1", "r1"]);
    fireEvent.click(screen.getByRole("button", { name: "Show as tree" }));
    expect(rows()).toEqual(["r1", "k1", "f1"]);
  });

  it("centres the model, effort and status cells in every table row (#31)", () => {
    // jsdom has no layout, so this pins the class that does the centring (.trow .cell in fleet.css)
    // rather than the pixels. The pixel check is manual: see the PR for #31.
    const { container } = openFocus();
    const rows = [...container.querySelectorAll(".trow:not(.hd)")];
    expect(rows).toHaveLength(agents.length + 1); // orchestrator row + one per agent
    for (const row of rows) {
      for (const sel of [".chip", ".eff", ".st"]) {
        expect(row.querySelector(sel)!.parentElement, sel).toHaveClass("cell");
      }
    }
  });

  it("the orchestrator row is a button that opens the orchestrator panel, and Back returns to the activity list (#63)", () => {
    const { container } = openFocus();
    const row = container.querySelector("button.trow.root")!;
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-current", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-current", "true");
    const side = container.querySelector(".side") as HTMLElement;
    expect(side.querySelector("h3")).toHaveTextContent("api-refactor");
    expect(side.textContent).toContain("Opus");
    expect(side.textContent).toContain("$12.84");
    expect(side.querySelector(".det")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
    expect(row).toHaveAttribute("aria-current", "false");
    expect(screen.getByText(/Activity · api-refactor/)).toBeInTheDocument();
  });

  it("switches the panel and the highlighted row between the orchestrator and an agent, both ways (#63)", () => {
    const { container } = openFocus();
    const orch = () => container.querySelector("button.trow.root")!;
    const agent = () => container.querySelector('button.trow[data-agent="f1"]')!;
    fireEvent.click(agent());
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Fork one");
    fireEvent.click(orch());
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("api-refactor");
    expect(orch()).toHaveAttribute("aria-current", "true");
    expect(agent()).toHaveAttribute("aria-current", "false");
    fireEvent.click(agent());
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Fork one");
    expect(orch()).toHaveAttribute("aria-current", "false");
    expect(agent()).toHaveAttribute("aria-current", "true");
  });

  it("the orchestrator row is reachable and activated from the keyboard (#63)", () => {
    const { container } = openFocus();
    const row = container.querySelector("button.trow.root") as HTMLButtonElement;
    row.focus();
    expect(row).toHaveFocus();
    // A button turns Enter into a click; jsdom does not, so assert it is a real, enabled button.
    expect(row.tagName).toBe("BUTTON");
    expect(row).not.toBeDisabled();
    expect(row).toHaveAttribute("type", "button");
  });

  it("opens the orchestrator panel for a session reported by settings hooks, with the fields that exist (#63)", () => {
    const { container } = openFocus({ reporter: "hooks", effort: null, costUsd: null, tokensTotal: 0, git: null, plan: null });
    fireEvent.click(container.querySelector("button.trow.root")!);
    const side = container.querySelector(".side") as HTMLElement;
    expect(side.querySelector("h3")).toHaveTextContent("api-refactor");
    expect(side.textContent).toContain("settings hooks");
  });

  describe("orchestrator panel steps, tools and skills (#75)", () => {
    const loop = {
      skills: ["frontend-design", "code-review"],
      lastTool: "Agent",
      toolCalls: 19,
      toolCounts: { Agent: 4, Read: 8, Edit: 5, TaskUpdate: 2 },
      steps: { done: 23, total: null },
    };
    const panel = (over = {}) => {
      const { container } = openFocus(over);
      fireEvent.click(container.querySelector("button.trow.root")!);
      return container.querySelector(".side") as HTMLElement;
    };

    it("shows Steps, the tool chips most used first, and Skills loaded, as the agent panel does", () => {
      const side = panel({ loop });
      expect(side.textContent).toContain("23 model requests");
      expect(side.textContent).toContain("Tools used (19 calls)");
      expect([...side.querySelectorAll(".chip.tool")].map((c) => c.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Read 8", "Edit 5", "Agent 4 (last used)", "TaskUpdate 2"]);
      expect(side.textContent).toContain("Skills loaded");
      expect([...side.querySelectorAll(".chip.skill:not(.tool)")].map((c) => c.textContent)).toEqual(["frontend-design", "code-review"]);
      expect(side.textContent).not.toContain("podium-reporter 0.4.0");
    });

    it("says None seen for a loop that has used no tools and loaded no skills", () => {
      const side = panel({ loop: { ...loop, toolCalls: 0, toolCounts: {}, skills: [], lastTool: null } });
      expect(side.textContent?.match(/None seen/g)).toHaveLength(2);
    });

    it("leaves the rows out and names the update for a mod older than 0.4.0", () => {
      const side = panel({ loop: null, reporterVersion: "0.3.0" });
      expect(side.querySelector("dt")?.textContent).toBe("Role");
      expect([...side.querySelectorAll("dt")].map((d) => d.textContent)).not.toContain("Steps");
      expect(side.textContent).not.toContain("Tools used");
      expect(side.textContent).not.toContain("Skills loaded");
      expect(side.textContent).toContain("need podium-reporter 0.4.0 or later");
      expect(side.textContent).toContain("This session reports 0.3.0");
    });

    it("does not tell an ended session to update, since there is nothing left to update", () => {
      const side = panel({ loop: null, reporterVersion: "0.3.0", status: "done" });
      expect(side.textContent).not.toContain("need podium-reporter 0.4.0");
    });

    it("shows neither the rows nor the update note for a settings-hooks session or an unparsable version", () => {
      for (const over of [{ reporter: "hooks", reporterVersion: null }, { reporterVersion: "0.1.0-sim" }]) {
        const side = panel({ loop: null, ...over });
        expect(side.textContent).not.toContain("Skills loaded");
        expect(side.textContent).not.toContain("need podium-reporter 0.4.0");
      }
    });
  });

  it("selecting a row opens the agent panel and does not flash it; the selected background marks it (#70)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
    const { container } = openFocus();
    fireEvent.click(container.querySelector('button.trow[data-agent="f1"]')!);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    const row = container.querySelector('button.trow[data-agent="f1"]')!;
    expect(row.className).not.toContain("flash");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Fork one");
  });

  it("shows the blowout callout with links at level 2", () => {
    const { container } = openFocus({ blowouts: { orchestrator: 1, agents: 2, total: 3, level: 2, loopsHit: 2, loopsTotal: 4, log: [] } });
    const callout = container.querySelector(".callout.l2")!;
    expect(callout.textContent).toContain("Repeated context blowouts");
    expect(callout.textContent).toContain("Orchestrator: 1×");
    fireEvent.click(screen.getByRole("button", { name: "Kid one" }));
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Kid one");
  });
});

describe("MiniChart", () => {
  const values = Array.from({ length: 60 }, (_, i) => i / 100);
  it("draws 60 points, markers per blowout, the caption and the limit line", () => {
    const { container } = render(<MiniChart label="Peak context, any loop" values={values} max={1} format={(v) => `${Math.round(v * 100)}%`} marks={[0, 9, 33]} limit endTime={Date.now()} />);
    expect(container.querySelectorAll("polyline")[1]!.getAttribute("points")!.split(" ")).toHaveLength(60);
    expect(container.querySelectorAll("[data-testid=blow-mark]")).toHaveLength(3);
    expect(container.textContent).toContain("3 blowouts in 60s");
    expect(container.querySelector(".lim")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Peak context, any loop, last 60 seconds: now 59%/);
  });
  it("shows a crosshair and the value under the pointer, then the live value again", () => {
    const { container } = render(<MiniChart label="Agents running" values={values.map((_, i) => i)} max={59} format={(v) => String(v)} endTime={new Date(2026, 0, 1, 10, 0, 59).getTime()} />);
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, width: 118, top: 0, height: 46, right: 118, bottom: 46, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseMove(svg, { clientX: 20 });
    expect(container.querySelector(".xh")).toBeInTheDocument();
    expect(container.querySelector(".hv")!.textContent).toBe("00:10  10");
    fireEvent.mouseLeave(svg);
    expect(container.querySelector(".xh")).not.toBeInTheDocument();
    expect(container.querySelector(".hv")!.textContent).toBe("59");
  });
});

describe("PlanPanel and context bars", () => {
  it("shows state icons, owner labels, and the empty text", () => {
    const { container } = render(<PlanPanel plan={makeSession().plan} />);
    expect([...container.querySelectorAll(".step")].map((s) => s.className)).toEqual(["step done", "step active", "step blocked", "step pending"]);
    expect(container.textContent).toContain("Explore · Haiku low");
    expect(container.textContent).toContain("blocked by an unfinished step");
    cleanup();
    render(<PlanPanel plan={null} />);
    expect(screen.getByText(/No plan reported. Agents were launched ad hoc/)).toBeInTheDocument();
  });
  it("turns amber at 75% and striped red at two blowouts", () => {
    const amber = render(<ContextBar percent={75} blowouts={0} />).container.firstElementChild!;
    expect(amber.className).toContain("hot");
    cleanup();
    const cool = render(<ContextBar percent={74} blowouts={0} />).container.firstElementChild!;
    expect(cool.className).not.toContain("hot");
    cleanup();
    expect(render(<ContextBar percent={10} blowouts={2} />).container.firstElementChild!.className).toContain("bx2");
  });
});
