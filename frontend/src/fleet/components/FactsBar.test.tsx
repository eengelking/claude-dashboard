import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FactsBar } from "./FactsBar";
import { makeAgent, makeSession } from "../fixtures";
import { versionNote } from "./SessionCard";

afterEach(cleanup);

function agentsTile(agents: ReturnType<typeof makeAgent>[]) {
  const { container } = render(<FactsBar s={makeSession({ agents })} now={Date.now()} onAgent={() => {}} />);
  return [...container.querySelectorAll(".fact")].find((f) => f.querySelector(".k")?.textContent === "Agents")!;
}

describe("FactsBar Agents tile (#100, #109)", () => {
  const states: [string, ReturnType<typeof makeAgent>[], string][] = [
    ["no agents", [], "1 running / 0 done"],
    ["running only", [makeAgent({ id: "a", status: "running" }), makeAgent({ id: "b", status: "running" }), makeAgent({ id: "c", status: "running" })], "4 running / 0 done"],
    ["done only", Array.from({ length: 12 }, (_, i) => makeAgent({ id: `d${i}`, status: "done" })), "1 running / 12 done"],
  ];

  it.each(states)("shows %s as one line, counts joined by a slash", (_n, agents, text) => {
    const tile = agentsTile(agents);
    expect(tile.querySelector(".v")!.textContent).toBe(text);
    expect(tile.querySelector(".n-done")).toHaveClass("n-done");
  });

  it("sizes the tile to its content and never wraps its text, so a narrow bar moves the whole tile instead", () => {
    expect(agentsTile([])).toHaveClass("agents");
  });

  it("starts the short tiles at their content width so the Agents tile gets their spare room", () => {
    const { container } = render(<FactsBar s={makeSession()} now={Date.now()} onAgent={() => {}} />);
    const slim = [...container.querySelectorAll(".fact.slim .k")].map((k) => k.textContent);
    expect(slim).toEqual(["Est. cost", "Tokens", "Running for", "Agent time", "Reporter"]);
  });

  it("keeps the failed button on the same line after the counts", () => {
    const v = agentsTile([makeAgent({ id: "a", status: "running" }), makeAgent({ id: "f", status: "failed" })]).querySelector(".v")!;
    expect(v.textContent).toBe("2 running / 0 done1 failed");
    expect(v.querySelector("button.blow")!.textContent).toBe("1 failed");
  });
});

describe("FactsBar cells (#109)", () => {
  const cell = (container: HTMLElement, k: string) => [...container.querySelectorAll(".fact")].find((f) => f.querySelector(".k")?.textContent === k) as HTMLElement | undefined;

  it("counts the orchestrator done when its session is done", () => {
    const { container } = render(<FactsBar s={makeSession({ status: "done", agents: [makeAgent({ status: "done" })] })} now={Date.now()} onAgent={() => {}} />);
    expect(cell(container, "Agents")!.querySelector(".v")!.textContent).toBe("0 running / 2 done");
  });

  it("says the orchestrator is counted, in the Agents tooltip", () => {
    expect(agentsTile([]).getAttribute("title")).toMatch(/orchestrator/i);
  });

  it("has no Orchestrator model cell, the agent table's first row shows it", () => {
    const { container } = render(<FactsBar s={makeSession()} now={Date.now()} onAgent={() => {}} />);
    expect(cell(container, "Orchestrator model")).toBeUndefined();
  });

  it("sums the orchestrator's time and every agent's in Agent time, apart from the wall-clock Running for", () => {
    const s = makeSession({ status: "running", startedAt: 0, agents: [makeAgent({ startedAt: 0, endedAt: 60_000 }), makeAgent({ id: "b", startedAt: 0, endedAt: 60_000 })] });
    const { container } = render(<FactsBar s={s} now={60_000} onAgent={() => {}} />);
    expect(cell(container, "Running for")!.querySelector(".v")!.textContent).toBe("1:00");
    expect(cell(container, "Agent time")!.querySelector(".v")!.textContent).toBe("3:00");
    expect(cell(container, "Agent time")!.getAttribute("title")).toMatch(/can be longer than/i);
  });

  it("keeps the session's cost and says how it is made", () => {
    const s = makeSession({ costUsd: 0.87, agents: [makeAgent({ costUsdEst: 0.21 })] });
    const { container } = render(<FactsBar s={s} now={Date.now()} onAgent={() => {}} />);
    expect(cell(container, "Est. cost")!.querySelector(".v")!.textContent).toBe("$0.87");
    expect(cell(container, "Est. cost")!.getAttribute("title")).toMatch(/every agent/i);
  });

  it("has no Context cell, the orchestrator's row in the agent table shows its context", () => {
    const { container } = render(<FactsBar s={makeSession()} now={Date.now()} onAgent={() => {}} />);
    expect(cell(container, "Context")).toBeUndefined();
    expect(container.querySelector(".facts .bar")).toBeNull();
  });
});

describe("FactsBar Reporter cell (#124)", () => {
  const reporter = (over: Parameters<typeof makeSession>[0]) => {
    const { container } = render(<FactsBar s={makeSession(over)} now={Date.now()} onAgent={() => {}} />);
    const cells = [...container.querySelectorAll(".fact")];
    return { cells, cell: cells.find((f) => f.querySelector(".k")?.textContent === "Reporter") as HTMLElement | undefined };
  };

  it("shows the reporter's version", () => {
    const { cell } = reporter({ reporterVersion: "0.11.0", compat: "ok" });
    expect(cell!.querySelector(".v")!.textContent).toBe("0.11.0");
  });

  it("says Settings hooks for a session with no mod", () => {
    const { cell } = reporter({ reporterVersion: null });
    expect(cell!.querySelector(".v")!.textContent).toBe("Settings hooks");
    expect(cell!.getAttribute("title")).toMatch(/settings hooks/i);
  });

  it.each([["outdated", "0.3.0 · update"], ["newer", "0.99.0 · upgrade server"]] as const)("says so when the reporter is %s, in the card chip's words and tooltip", (compat, text) => {
    const v = compat === "outdated" ? "0.3.0" : "0.99.0";
    const s = makeSession({ reporterVersion: v, compat });
    const { container } = render(<FactsBar s={s} now={Date.now()} onAgent={() => {}} />);
    const cell = [...container.querySelectorAll(".fact")].find((f) => f.querySelector(".k")?.textContent === "Reporter")!;
    expect(cell.querySelector(".v")!.textContent).toBe(text);
    expect(cell.getAttribute("title")).toBe(versionNote(s)!.text);
  });

  it("sits just before Copy resume command, which stays the last cell", () => {
    const { cells } = reporter({ reporterVersion: "0.11.0" });
    expect(cells[cells.length - 1].querySelector("button")!.textContent).toBe("Copy resume command");
    expect(cells[cells.length - 2].querySelector(".k")!.textContent).toBe("Reporter");
  });
});
