import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { FailureBox } from "./components/FailureBox";
import { fleetReducer } from "./store";
import { makeAgent, makeEvent, makeSession } from "./fixtures";
import { stateFrom } from "./testState";
import type { Failure } from "./types";

afterEach(cleanup);

const failure: Failure = {
  class: "Tool error", at: 1_500_000, tool: "Bash", call: "npm run backfill:dry", exitCode: 1,
  outputTail: ["Error: connect ECONNREFUSED 127.0.0.1:5432", "backfill: aborted"], evidence: ["same call failed 3 times"],
  explanation: "No database is running.", retriedAs: null,
};

describe("activity list", () => {
  const events = Array.from({ length: 30 }, (_, i) => makeEvent({ id: `e${i}`, t: 1_000_000 + i * 1000, text: `event ${i}` }));
  it("pages 12 at a time with correct counts, and notes the memory cap", () => {
    const { container } = render(<FleetView state={stateFrom({ events })} />);
    const side = () => container.querySelector(".side")!;
    expect(side().querySelectorAll(".ev li")).toHaveLength(12);
    expect(side().textContent).toContain("Showing 12 of 30");
    expect(side().textContent).toContain("Only the latest 150 events are kept in memory.");
    expect(within(side() as HTMLElement).queryByRole("button", { name: "Show fewer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 12 more" }));
    expect(side().querySelectorAll(".ev li")).toHaveLength(24);
    expect(side().textContent).toContain("Showing 24 of 30");
    fireEvent.click(screen.getByRole("button", { name: "Show 6 more" }));
    expect(side().querySelectorAll(".ev li")).toHaveLength(30);
    expect(side().textContent).toContain("Showing 30 of 30");
    expect(screen.queryByRole("button", { name: /more$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(side().querySelectorAll(".ev li")).toHaveLength(12);
    // newest first
    expect(side().querySelector(".ev li")!.textContent).toContain("event 29");
  });

  it("an agent row selects the orchestrator and agent and opens the detail; a failure row shows the failure box", () => {
    const s = makeSession({ agents: [makeAgent({ id: "a9", description: "Backfill dry run", status: "failed", failure })] });
    const st = stateFrom({ sessions: [s], events: [makeEvent({ id: "f", kind: "fail", agentId: "a9", text: "failed: Backfill dry run (Tool error)" })] });
    const { container } = render(<FleetView state={st} />);
    const row = screen.getByRole("button", { name: /failed: Backfill dry run/ });
    expect(row).toHaveTextContent("Show root cause");
    fireEvent.click(row);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("api-refactor");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Backfill dry run");
    expect(container.querySelector(".side .failbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
    expect(screen.getByText(/Activity · api-refactor/)).toBeInTheDocument();
  });

  it("a blowout row opens a detail with the blowout timeline", () => {
    const s = makeSession({
      agents: [makeAgent({ id: "b1", description: "Rewrite renderer", blowouts: 2 })],
      blowouts: { orchestrator: 0, agents: 2, total: 2, level: 2, loopsHit: 1, loopsTotal: 2, log: [
        { t: 1_100_000, agentId: "b1", kind: "auto-compact", tokensBefore: 996_000, tokensAfter: 300_000 },
        { t: 1_200_000, agentId: "b1", kind: "auto-compact", tokensBefore: 1_004_000, tokensAfter: 310_000 },
      ] },
    });
    const st = stateFrom({ sessions: [s], events: [makeEvent({ id: "b", kind: "blow", agentId: "b1", text: "context window exceeded (blowout #2)" })] });
    const { container } = render(<FleetView state={st} />);
    const row = screen.getByRole("button", { name: /context window exceeded/ });
    expect(row).toHaveTextContent("Show context history");
    fireEvent.click(row);
    const items = [...container.querySelectorAll(".side .tl li")].map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("Overflow #1 at 996k tokens, compacted to about 30%");
  });

  it("rows of a session that left are inert and say Session ended", () => {
    const st = stateFrom({ sessions: [makeSession()], events: [makeEvent({ id: "x", sessionId: "s1", text: "something" })] });
    const gone = fleetReducer(fleetReducer(st, { type: "removed", sessionId: "s1", reason: "done", at: Date.now() }), { type: "purge", sessionId: "s1" });
    const { container } = render(<FleetView state={gone} />);
    const li = container.querySelector(".side .ev li")!;
    expect(li.className).toContain("gone");
    expect(li.textContent).toContain("Session ended");
    expect(li.querySelector("button")).toBeNull();
  });

  it("is filtered to the selected orchestrator", () => {
    const st = stateFrom({
      sessions: [makeSession(), makeSession({ id: "s2", name: "other" })],
      events: [makeEvent({ id: "1", text: "mine" }), makeEvent({ id: "2", sessionId: "s2", sessionName: "other", text: "theirs" })],
    });
    const { container } = render(<FleetView state={st} />);
    fireEvent.click([...container.querySelectorAll(".wall .card")].find((c) => c.textContent?.includes("other"))!);
    const side = container.querySelector(".side")!;
    expect(side.textContent).toContain("theirs");
    expect(side.textContent).not.toContain("mine");
  });
});

describe("FailureBox and agent detail", () => {
  it("shows class, call, output as pre text, evidence, explanation and the retry line", () => {
    const { container } = render(<FailureBox f={failure} />);
    expect(container.textContent).toContain("Tool error");
    expect(container.textContent).toContain("Failing call · Bash · exit 1");
    const pres = container.querySelectorAll("pre");
    expect(pres[0]!.textContent).toBe("npm run backfill:dry");
    expect(pres[1]!.textContent).toBe("Error: connect ECONNREFUSED 127.0.0.1:5432\nbackfill: aborted");
    expect(container.textContent).toContain("same call failed 3 times");
    expect(container.textContent).toContain("Likely root cause");
    expect(container.textContent).toContain("No retry is queued.");
    cleanup();
    const r = render(<FailureBox f={{ ...failure, retriedAs: "a2", explanation: null }} />);
    expect(r.container.textContent).toContain("The step went back to the plan.");
    expect(r.container.textContent).not.toContain("Likely root cause");
  });

  it("marks model and effort inherited for a fork", () => {
    const s = makeSession({ agents: [makeAgent({ id: "f", kind: "fork", type: "fork", description: "Fork task", effortSource: "inherited" })] });
    const { container } = render(<FleetView state={stateFrom({ sessions: [s] })} />);
    fireEvent.click(container.querySelector(".wall .card")!);
    fireEvent.click(container.querySelector('button.trow[data-agent="f"]')!);
    const dl = container.querySelector(".side dl")!;
    const dd = (label: string) => [...dl.querySelectorAll("dt")].find((d) => d.textContent === label)!.nextElementSibling!.textContent;
    expect(dd("Model")).toContain("inherited");
    expect(dd("Effort")).toContain("inherited");
  });
});

describe("reported text is never HTML", () => {
  it("renders hostile strings from a description, a failure line and an event as text", () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const s = makeSession({
      name: evil,
      agents: [makeAgent({ id: "a", description: evil, status: "failed", failure: { ...failure, outputTail: [evil], call: evil, evidence: [evil] } })],
    });
    const st = stateFrom({ sessions: [s], events: [makeEvent({ id: "e", text: evil, sessionName: evil, agentId: "a", kind: "fail" })] });
    const { container } = render(<FleetView state={st} />);
    fireEvent.click(container.querySelector(".wall .card")!);
    fireEvent.click(container.querySelector('button.trow[data-agent="a"]')!);
    expect(container.querySelector(".side .failbox")).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.innerHTML).toContain("&lt;img src=x");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
