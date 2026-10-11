import { describe, it, expect } from "vitest";
import { agentCounts, buildTree, currentStep, filterSessions, planProgress, sortAgents, sortSessions, type SortKey } from "./logic";
import { makeAgent, makeSession } from "./fixtures";
import type { SessionView } from "./types";

const blow = (total: number, level: 0 | 1 | 2 = total ? 1 : 0): SessionView["blowouts"] => ({ orchestrator: total, agents: 0, total, level, loopsHit: total ? 1 : 0, loopsTotal: 1, log: [] });

const S = [
  makeSession({ id: "a", name: "alpha", status: "waiting", modelFamily: "sonnet", context: { tokens: 1, window: 1, percent: 20 }, costUsd: 5, startedAt: 3, blowouts: blow(0) }),
  makeSession({ id: "b", name: "bravo", status: "running", modelFamily: "opus", context: { tokens: 1, window: 1, percent: 80 }, costUsd: 1, startedAt: 9, blowouts: blow(3, 2) }),
  makeSession({ id: "c", name: "charlie", status: "stale", modelFamily: "fable", context: { tokens: 1, window: 1, percent: 50 }, costUsd: 9, startedAt: 1, blowouts: blow(1) }),
  makeSession({ id: "d", name: "delta", status: "running", modelFamily: "haiku", context: { tokens: 1, window: 1, percent: 10 }, costUsd: null, startedAt: 5, blowouts: blow(0) }),
  makeSession({ id: "e", name: "echo", status: "running", modelFamily: "opus", context: { tokens: 1, window: 1, percent: 10 }, costUsd: 2, startedAt: 7, blowouts: blow(1) }),
];

describe("sortSessions", () => {
  const names = (k: SortKey) => sortSessions(S, k).map((s) => s.name);
  it("by status, then name", () => expect(names("status")).toEqual(["bravo", "delta", "echo", "alpha", "charlie"]));
  it("by model: Fable, Haiku, Opus, Sonnet, ties by status then name", () => expect(names("model")).toEqual(["charlie", "delta", "bravo", "echo", "alpha"]));
  it("by context blowouts, most first", () => expect(names("blow")).toEqual(["bravo", "echo", "charlie", "delta", "alpha"]));
  it("by context used, fullest first", () => expect(names("ctx")).toEqual(["bravo", "charlie", "alpha", "delta", "echo"]));
  it("by cost, highest first, unknown last", () => expect(names("cost")).toEqual(["charlie", "alpha", "echo", "bravo", "delta"]));
  it("by newest", () => expect(names("newest")).toEqual(["bravo", "echo", "delta", "alpha", "charlie"]));
});

describe("filterSessions", () => {
  const ids = (status: Parameters<typeof filterSessions>[1]["status"], q = "") => filterSessions(S, { status, q }).map((s) => s.id);
  it("filters by each status segment", () => {
    expect(ids("all")).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids("running")).toEqual(["b", "d", "e"]);
    expect(ids("waiting")).toEqual(["a"]);
    expect(ids("stale")).toEqual(["c"]);
    expect(ids("blow")).toEqual(["b", "c", "e"]);
  });
  it("matches name, project and branch case-insensitively", () => {
    const list = [
      makeSession({ id: "n", name: "Payments" }),
      makeSession({ id: "p", name: "x", project: "~/dev/Mobile-App" }),
      makeSession({ id: "g", name: "y", git: { branch: "feat/OIDC-login", detached: false, isWorktree: false, worktreePath: null, ahead: 0, behind: 0, dirty: 0 } }),
      makeSession({ id: "z", name: "z", project: "~/q", git: null }),
    ];
    const f = (q: string) => filterSessions(list, { status: "all", q }).map((s) => s.id);
    expect(f("payMENTS")).toEqual(["n"]);
    expect(f("mobile")).toEqual(["p"]);
    expect(f("oidc")).toEqual(["g"]);
    expect(f("  ")).toEqual(["n", "p", "g", "z"]);
    expect(f("nothing")).toEqual([]);
  });
});

describe("plan and agents", () => {
  it("computes plan progress and the current step", () => {
    const s = makeSession();
    expect(planProgress(s.plan)).toEqual({ done: 1, total: 4, pct: 0.25 });
    expect(currentStep(s.plan)).toBe("Port invoice endpoints");
    expect(planProgress(null)).toBeNull();
  });
  it("counts agents by status", () => {
    const c = agentCounts([makeAgent({ status: "running" }), makeAgent({ status: "done" }), makeAgent({ status: "failed" }), makeAgent({ status: "queued" }), makeAgent({ status: "aborted" })]);
    expect(c).toEqual({ running: 1, done: 1, failed: 1, queued: 1, aborted: 1, all: 5 });
  });
});

describe("buildTree", () => {
  const A = [
    makeAgent({ id: "r1" }),
    makeAgent({ id: "c1", parentId: "r1" }),
    makeAgent({ id: "c2", parentId: "r1" }),
    makeAgent({ id: "g1", parentId: "c1" }),
    makeAgent({ id: "r2" }),
    makeAgent({ id: "orphan", parentId: "missing" }),
  ];
  it("nests children under parents with guides for last and non-last children", () => {
    const rows = buildTree(A).map((r) => [r.agent.id, r.guides.join(",")]);
    expect(rows).toEqual([
      ["r1", "mid"],
      ["c1", "mid,mid"],
      ["g1", "mid,mid,last"],
      ["c2", "mid,last"],
      ["r2", "mid"],
      ["orphan", "last"],
    ]);
  });
  it("draws blank guides under a last child", () => {
    const rows = buildTree([makeAgent({ id: "r" }), makeAgent({ id: "k", parentId: "r" }), makeAgent({ id: "gk", parentId: "k" })]).map((r) => r.guides.join(","));
    expect(rows).toEqual(["last", "blank,last", "blank,blank,last"]);
  });
  it("survives a parent cycle", () => {
    const rows = buildTree([makeAgent({ id: "x", parentId: "y" }), makeAgent({ id: "y", parentId: "x" })]);
    expect(rows.map((r) => r.agent.id).sort()).toEqual(["x", "y"]);
  });
});

describe("sortAgents", () => {
  const now = 10_000;
  const A = [
    makeAgent({ id: "1", modelFamily: "sonnet", effort: "high", context: { tokens: 1, window: 1, percent: 30 }, costUsdEst: 2, startedAt: 0, endedAt: 4000, status: "done" }),
    makeAgent({ id: "2", modelFamily: "fable", effort: "low", context: { tokens: 1, window: 1, percent: 90 }, costUsdEst: 5, startedAt: 5000, status: "running", tokens: { input: 9e6, output: 0, cacheRead: 0, cacheWrite: 0 } }),
    makeAgent({ id: "3", modelFamily: "haiku", effort: "max", context: { tokens: 1, window: 1, percent: 10 }, costUsdEst: 1, startedAt: 1000, status: "failed" }),
  ];
  const ids = (k: Parameters<typeof sortAgents>[1], dir: 1 | -1) => sortAgents(A, k, dir, now).map((a) => a.id).join("");
  it("sorts by each column and reverses", () => {
    expect(ids("model", 1)).toBe("231");
    expect(ids("model", -1)).toBe("132");
    expect(ids("effort", 1)).toBe("213");
    expect(ids("ctx", -1)).toBe("213");
    expect(ids("tok", -1)).toBe("213");
    expect(ids("cost", -1)).toBe("213");
    expect(ids("time", -1)).toBe("321");
    expect(ids("status", 1)).toBe("231");
  });
});
