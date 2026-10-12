import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { FleetView } from "./FleetApp";
import { GitLine } from "./components/Chips";
import { SessionCard } from "./components/SessionCard";
import { fleetReducer } from "./store";
import { makeAgent, makeSession } from "./fixtures";
import { stateFrom } from "./testState";

afterEach(cleanup);

const CFG = { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000 };
const blow = (orch: number, agents: number, level: 0 | 1 | 2) => ({ orchestrator: orch, agents, total: orch + agents, level, loopsHit: 1, loopsTotal: 3, log: [] });

describe("rail and wall", () => {
  it("shows every live session in the rail and the wall, and new ones appear without reload", () => {
    const st = stateFrom({ sessions: [makeSession()] });
    const { rerender, container } = render(<FleetView state={st} />);
    expect(within(screen.getByRole("navigation", { name: "Orchestrators" })).getByText("api-refactor")).toBeInTheDocument();
    expect(container.querySelectorAll(".wall .card")).toHaveLength(1);
    const next = fleetReducer(st, { type: "session", view: makeSession({ id: "s2", name: "new-one" }), at: Date.now() });
    rerender(<FleetView state={next} />);
    expect(container.querySelectorAll(".wall .card")).toHaveLength(2);
    const card = [...container.querySelectorAll(".wall .card")].find((c) => c.textContent?.includes("new-one"))!;
    expect(card.className).toContain("enter");
    const railItem = [...container.querySelectorAll(".rail .ritem")].find((c) => c.textContent?.includes("new-one"))!;
    expect(railItem.className).toContain("enter");
  });

  it("a removed session plays the leave animation in rail and wall", () => {
    const st = stateFrom({ sessions: [makeSession(), makeSession({ id: "s2", name: "two" })] });
    const removed = fleetReducer(st, { type: "removed", sessionId: "s2", reason: "done", at: Date.now() });
    const { container } = render(<FleetView state={removed} />);
    const card = [...container.querySelectorAll(".wall .card")].find((c) => c.textContent?.includes("two"))!;
    expect(card.className).toContain("leave");
    const item = [...container.querySelectorAll(".rail .ritem")].find((c) => c.textContent?.includes("two"))!;
    expect(item.className).toContain("leave");
  });

  it("sorting reorders both rail and wall; filters narrow the wall", () => {
    const st = stateFrom({
      sessions: [
        makeSession({ id: "a", name: "alpha", modelFamily: "sonnet" }),
        makeSession({ id: "b", name: "bravo", modelFamily: "fable", status: "waiting" }),
        makeSession({ id: "c", name: "charlie", modelFamily: "haiku", blowouts: blow(1, 0, 1) }),
      ],
    });
    const { container } = render(<FleetView state={st} />);
    const order = (sel: string) => [...container.querySelectorAll(sel)].map((e) => e.textContent?.match(/alpha|bravo|charlie/)?.[0]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "model" } });
    expect(order(".wall .card .nm")).toEqual(["bravo", "charlie", "alpha"]);
    expect(order(".rail .ritem .nm").slice(1)).toEqual(["bravo", "charlie", "alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Waiting" }));
    expect(order(".wall .card .nm")).toEqual(["bravo"]);
    fireEvent.click(screen.getByRole("button", { name: "Blowouts" }));
    expect(order(".wall .card .nm")).toEqual(["charlie"]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Filter orchestrators"), { target: { value: "ALP" } });
    expect(order(".wall .card .nm")).toEqual(["alpha"]);
    expect(screen.getByText(/1 shown · 0 cleared today/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter orchestrators"), { target: { value: "zzz" } });
    expect(screen.getByText(/No orchestrators match/)).toBeInTheDocument();
  });

  it("shows an instruction, not a blank panel, when nothing reports", () => {
    render(<FleetView state={stateFrom({ sessions: [], events: [] })} />);
    expect(screen.getByText(/No Claude Code sessions are reporting/)).toBeInTheDocument();
    expect(screen.getByText("claude --plugin-dir mod/podium-reporter")).toBeInTheDocument();
  });
});

describe("git line", () => {
  it("worktree with ahead, behind and dirty", () => {
    const { container } = render(<GitLine git={{ branch: "refactor/x", detached: false, isWorktree: true, worktreePath: "/r/.claude/worktrees/x-wt", ahead: 7, behind: 2, dirty: 3 }} />);
    expect(container.textContent).toContain("refactor/x");
    expect(container.textContent).toContain("worktree · x-wt");
    expect(container.textContent).toContain("7 ahead");
    expect(container.textContent).toContain("2 behind");
    expect(container.textContent).toContain("3 modified");
  });
  it("main checkout, clean", () => {
    const { container } = render(<GitLine git={{ branch: "main", detached: false, isWorktree: false, worktreePath: null, ahead: 0, behind: 0, dirty: 0 }} />);
    expect(container.querySelector(".wt.no")?.textContent).toBe("main checkout");
    expect(container.textContent).toContain("clean");
    expect(container.textContent).not.toContain("ahead");
  });
  it("detached head", () => {
    const { container } = render(<GitLine git={{ branch: "1a2b3c4", detached: true, isWorktree: false, worktreePath: null, ahead: 0, behind: 0, dirty: 1 }} />);
    expect(container.textContent).toContain("1a2b3c4 (detached)");
  });
  it("a long branch name sits in its own truncating element and its tooltip carries the full name", () => {
    const branch = "chore/marketplace-description-and-name-fixes";
    const { container } = render(<GitLine git={{ branch, detached: false, isWorktree: true, worktreePath: "/r/.claude/worktrees/x", ahead: 1, behind: 2, dirty: 3 }} />);
    expect(container.querySelector(".br .brn")?.textContent).toBe(branch);
    expect(container.querySelector(".br")?.getAttribute("title")).toBe(`Branch: ${branch}`);
    expect(container.textContent).toContain("3 modified");
  });
  it("a detached head's tooltip still says so and carries the full value", () => {
    const { container } = render(<GitLine git={{ branch: "1a2b3c4", detached: true, isWorktree: false, worktreePath: null, ahead: 0, behind: 0, dirty: 0 }} />);
    expect(container.querySelector(".br")?.getAttribute("title")).toBe("Detached HEAD: 1a2b3c4");
  });
  it("git: null shows nothing", () => {
    const { container } = render(<GitLine git={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("session card", () => {
  const renderCard = (s = makeSession()) => render(<SessionCard s={s} now={2_000_000} config={CFG} entering={false} leaving={false} onOpen={() => {}} />);

  it("the project path's tooltip is the full path", () => {
    const project = "/Users/someone/dev/a/very/long/path/to/some/deeply-nested/project-folder";
    const { container } = renderCard(makeSession({ project }));
    expect(container.querySelector(".path")?.getAttribute("title")).toBe(project);
  });

  it("level 1: amber badge, no red edge, no callout", () => {
    const { container } = renderCard(makeSession({ blowouts: blow(1, 0, 1) }));
    const badge = container.querySelector(".blow")!;
    expect(badge.className).not.toContain("l2");
    expect(container.querySelector(".card")!.className).not.toContain("risk");
    expect(container.textContent).not.toContain("Likely losing context");
  });

  it("level 2: red badge, red edge and the callout", () => {
    const { container } = renderCard(makeSession({ blowouts: blow(0, 2, 2) }));
    expect(container.querySelector(".blow")!.className).toContain("l2");
    expect(container.querySelector(".card")!.className).toContain("risk");
    expect(container.textContent).toContain("Context exceeded 2× (1 of 3 loops). Likely losing context");
  });

  it("agent strip: fork circle, done faded, failed outline, queued dashed, running blinks", () => {
    const { container } = renderCard(
      makeSession({
        agents: [
          makeAgent({ id: "f", kind: "fork", status: "running" }),
          makeAgent({ id: "d", status: "done" }),
          makeAgent({ id: "x", status: "failed" }),
          makeAgent({ id: "q", status: "queued" }),
        ],
      }),
    );
    const sq = [...container.querySelectorAll(".crew .a")].map((e) => e.className);
    expect(sq).toEqual(["a running fork", "a done", "a failed", "a queued"]);
    expect(container.querySelector(".crew")!.getAttribute("aria-label")).toBe("1 running, 1 done of 4 agents");
    expect(container.textContent).toContain("1 failed");
  });

  it("waiting and stale callouts", () => {
    const w = renderCard(makeSession({ status: "waiting", waitReason: "permission", waitNote: "Bash(npm run e2e)" }));
    expect(w.container.querySelector(".alert")!.textContent).toBe("Waiting for your input.");
    expect(w.container.textContent).not.toContain("Bash(npm run e2e)");
    cleanup();
    const q = renderCard(makeSession({ status: "waiting", waitReason: "input", waitNote: "Which branch should I use?" }));
    expect(q.container.querySelector(".alert")!.textContent).toBe("Waiting for your input.");
    expect(q.container.textContent).not.toContain("Which branch should I use?");
    cleanup();
    const s = renderCard(makeSession({ status: "stale", lastSeenAt: 2_000_000 - 38_000 }));
    expect(s.container.textContent).toContain("Last heartbeat 0:38 ago. Dropped from the fleet at 1:15.");
  });

  it("footer keeps the cost, tokens and duration each in one unbreakable value (#18)", () => {
    const { container } = renderCard(makeSession({ costUsd: 8.55, tokensTotal: 28_320_000, startedAt: 2_000_000 - (15 * 3600 + 54 * 60) * 1000 }));
    const values = [...container.querySelectorAll(".foot .v")].map((e) => e.textContent?.replace(/\s*·$/, ""));
    expect(values).toHaveLength(3);
    expect(values[0]).toBe("$8.55");
    expect(values[1]).toBe("28.32M tok");
    expect(values[2]).toMatch(/^15h\s?54m$/);
  });

  it("shows the no-plan text and plan progress", () => {
    const { container } = renderCard(makeSession({ plan: null }));
    expect(container.textContent).toContain("No plan reported. Agents were launched ad hoc.");
    cleanup();
    const p = renderCard();
    expect(p.container.textContent).toContain("Migrate invoices to v2 schema · Port invoice endpoints");
    expect(p.container.textContent).toContain("1/4");
  });
});

describe("a waiting session", () => {
  it("keeps the card short and the orchestrator page shows the full note (#50)", () => {
    const note = "Bash(npm run e2e -- --grep long-running-suite)";
    const { container } = render(<FleetView state={stateFrom({ sessions: [makeSession({ status: "waiting", waitReason: "permission", waitNote: note })] })} />);
    expect(container.querySelector(".wall .card")!.textContent).not.toContain(note);
    fireEvent.click(container.querySelector(".wall .card")!);
    expect(container.textContent).toContain(`Permission prompt: ${note}`);
  });
});

describe("sessions reported by settings hooks", () => {
  it("are marked on the card and the orchestrator page says what is unavailable", () => {
    const { container } = render(<FleetView state={stateFrom({ sessions: [makeSession({ reporter: "hooks", costUsd: null, plan: null, context: { tokens: null, window: null, percent: null } })] })} />);
    expect(container.querySelector(".wall .card")!.textContent).toContain("settings hooks");
    fireEvent.click(container.querySelector(".wall .card")!);
    expect(screen.getByRole("note").textContent).toContain("context, cost, tokens and the plan are unavailable");
  });
});
