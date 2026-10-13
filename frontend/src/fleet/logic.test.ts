import { describe, it, expect } from "vitest";
import { delegateText, waitingOnByRow, ORCHESTRATOR_ROW, agentCounts, sessionCounts, orchestratorCostUsd, sessionAgentSec, agentOrder, agentTokens, branchTotals, sessionTokens, buildTree, currentStep, filterSessions, parentOf, planProgress, splitDetached, sortAgents, sortSessions, treeDepth, treeOrder, type SortKey } from "./logic";
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

// The shape a real nested run produced (#101): a subagent that launched a subagent and a fork, a
// grandchild under that subagent, and a fork at the top level that launched a subagent of its own.
/** The output tokens every fixture agent has written (fixtures.ts), which now count toward its Tokens (#108). */
const OUT = 500;

const NESTED = [
  makeAgent({ id: "p", description: "level1 parent", costUsdEst: 0.05, context: { tokens: 17_000, window: 1, percent: 2 } }),
  makeAgent({ id: "f", kind: "fork", type: "fork", description: "level1 fork", costUsdEst: 0.02, context: { tokens: 25_000, window: 1, percent: 3 } }),
  makeAgent({ id: "c", parentId: "p", description: "level2 child", costUsdEst: 0.04, context: { tokens: 18_000, window: 1, percent: 2 } }),
  makeAgent({ id: "pf", parentId: "p", kind: "fork", type: "fork", description: "level2 fork", costUsdEst: 0.01, context: { tokens: 15_000, window: 1, percent: 2 } }),
  makeAgent({ id: "g", parentId: "c", description: "level3 grandchild", costUsdEst: 0.003, context: { tokens: 14_000, window: 1, percent: 1 } }),
  makeAgent({ id: "fc", parentId: "f", description: "fork child", costUsdEst: null, modelFamily: "other", context: { tokens: 15_000, window: null, percent: null } }),
];

describe("nested agents (#101)", () => {
  it("the tree puts each nested agent under its real parent, three levels deep", () => {
    expect(buildTree(NESTED).map((r) => [r.agent.id, r.guides.length])).toEqual([
      ["p", 1], ["c", 2], ["g", 3], ["pf", 2], ["f", 1], ["fc", 2],
    ]);
  });

  it("a sorted tree keeps every child under its parent and orders the siblings", () => {
    const byCost = buildTree(NESTED, agentOrder("cost", -1, 0)).map((r) => [r.agent.id, r.guides.join(",")]);
    expect(byCost).toEqual([
      ["p", "mid"], ["c", "mid,mid"], ["g", "mid,mid,last"], ["pf", "mid,last"], ["f", "last"], ["fc", "blank,last"],
    ]);
    const cheapFirst = buildTree(NESTED, agentOrder("cost", 1, 0)).map((r) => r.agent.id);
    expect(cheapFirst).toEqual(["f", "fc", "p", "pf", "c", "g"]);
  });

  it("measures the depth of the tree", () => {
    expect(treeDepth(buildTree(NESTED))).toBe(3);
    expect(treeDepth([])).toBe(0);
  });

  it("names the parent of a nested agent and nothing for a top-level or orphaned one", () => {
    expect(parentOf(NESTED, NESTED.find((a) => a.id === "g")!)?.id).toBe("c");
    expect(parentOf(NESTED, NESTED[0]!)).toBeNull();
    expect(parentOf(NESTED, makeAgent({ id: "o", parentId: "gone" }))).toBeNull();
    expect(parentOf(NESTED, makeAgent({ id: "o", parentId: "o" }))).toBeNull();
  });

  it("adds a branch up once per agent: own figures plus every descendant, unpriced ones counted aside", () => {
    expect(branchTotals(NESTED, "p")).toEqual({ agents: 3, costUsd: 0.05 + 0.04 + 0.01 + 0.003, unpriced: 0, tokens: 17_000 + 18_000 + 15_000 + 14_000 + 4 * OUT });
    expect(branchTotals(NESTED, "f")).toEqual({ agents: 1, costUsd: 0.02, unpriced: 1, tokens: 25_000 + 15_000 + 2 * OUT });
    expect(branchTotals(NESTED, "g")).toEqual({ agents: 0, costUsd: 0.003, unpriced: 0, tokens: 14_000 + OUT });
  });

  it("a parent cycle does not loop or count twice", () => {
    const cyc = [makeAgent({ id: "x", parentId: "y", costUsdEst: 1 }), makeAgent({ id: "y", parentId: "x", costUsdEst: 2 })];
    expect(branchTotals(cyc, "x")).toEqual({ agents: 1, costUsd: 3, unpriced: 0, tokens: 200_000 + 2 * OUT });
  });

  it("counts each nested agent once, and the session tokens add every level once", () => {
    expect(agentCounts(NESTED)).toMatchObject({ running: 6, all: 6 });
    const s = makeSession({ agents: NESTED, context: { tokens: 25_000, window: 1_000_000, percent: 3 } });
    expect(sessionTokens(s)).toBe(25_000 + 17_000 + 25_000 + 18_000 + 15_000 + 14_000 + 15_000 + 6 * OUT);
  });

  it("orders the card strip as the tree, so children follow their parent", () => {
    expect(treeOrder(NESTED).map((a) => a.id)).toEqual(["p", "c", "g", "pf", "f", "fc"]);
  });
});

describe("sortAgents", () => {
  const now = 10_000;
  const A = [
    makeAgent({ id: "1", modelFamily: "sonnet", effort: "high", context: { tokens: 1, window: 1, percent: 30 }, costUsdEst: 2, startedAt: 0, endedAt: 4000, status: "done" }),
    makeAgent({ id: "2", modelFamily: "fable", effort: "low", costUsdEst: 5, startedAt: 5000, status: "running", context: { tokens: 9e6, window: 1, percent: 90 } }),
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

describe("splitDetached (sessions nobody is attached to leave the wall after their delay)", () => {
  const NOW = 1_000_000;
  const list = [
    makeSession({ id: "on", attached: true, hideAt: null }),
    makeSession({ id: "old", attached: null, hideAt: null }),
    makeSession({ id: "soon", attached: false, hideAt: NOW + 5_000 }),
    makeSession({ id: "gone", attached: false, hideAt: NOW - 1 }),
    makeSession({ id: "now", attached: false, hideAt: NOW }),
  ];
  const ids = (xs: readonly SessionView[]) => xs.map((s) => s.id);

  it("keeps attached, unknown and still-counting-down sessions on the wall, and sets the rest aside", () => {
    const r = splitDetached(list, NOW, false);
    expect(ids(r.shown)).toEqual(["on", "old", "soon"]);
    expect(ids(r.hidden)).toEqual(["gone", "now"]);
  });

  it("shows everything when asked, still reporting which ones were hidden", () => {
    const r = splitDetached(list, NOW, true);
    expect(ids(r.shown)).toEqual(["on", "old", "soon", "gone", "now"]);
    expect(ids(r.hidden)).toEqual(["gone", "now"]);
  });

  it("brings a session back as soon as it is attached again", () => {
    const back = list.map((s) => (s.id === "gone" ? { ...s, attached: true, hideAt: null } : s));
    expect(ids(splitDetached(back, NOW, false).hidden)).toEqual(["now"]);
  });
});

describe("Tokens figure (issue #96)", () => {
  it("is the context an agent holds plus its output, not a running total of cache re-reads", () => {
    const a = makeAgent({ context: { tokens: 417_783, window: 1_000_000, percent: 41.8 }, tokens: { input: 348, output: 124_151, cacheRead: 48_663_543, cacheWrite: 746_738 } });
    expect(agentTokens(a)).toBe(417_783 + 124_151);
  });

  it("adds the output tokens produced so far, as Claude Code's agent line does (issue #108)", () => {
    // Taken from a real run: the agent's last request held 270,4xx tokens and it had written 8,133 so far; Claude Code showed 281k.
    const a = makeAgent({ context: { tokens: 270_400, window: 1_000_000, percent: 27 }, tokens: { input: 150, output: 8_133, cacheRead: 12_000_000, cacheWrite: 250_000 } });
    expect(agentTokens(a)).toBe(278_533);
  });

  it("is zero while an agent has not reported its context yet", () => {
    // Output already written must not show on its own as a Tokens figure.
    expect(agentTokens(makeAgent({ context: { tokens: null, window: null, percent: null }, tokens: { input: 0, output: 8_133, cacheRead: 0, cacheWrite: 0 } }))).toBe(0);
  });

  it("adds the orchestrator and its agents, so the rows add up", () => {
    const s = makeSession({
      context: { tokens: 200_000, window: 1_000_000, percent: 20 },
      agents: [makeAgent({ id: "x", context: { tokens: 50_000, window: 1_000_000, percent: 5 } }), makeAgent({ id: "y", context: { tokens: 30_000, window: 1_000_000, percent: 3 } })],
    });
    expect(sessionTokens(s)).toBe(280_000 + 2 * OUT);
  });
});

describe("delegating (issue #98): a running row with running children is waiting on them", () => {
  const ids = (m: Map<string, unknown[]>, k: string) => (m.get(k) as { id: string }[] | undefined)?.map((a) => a.id);

  it("has no entries with no agents, or when every agent is finished, failed, queued or aborted", () => {
    expect(waitingOnByRow(makeSession({ agents: [] })).size).toBe(0);
    for (const status of ["done", "failed", "queued", "aborted"] as const) {
      expect(waitingOnByRow(makeSession({ agents: [makeAgent({ status })] })).size, status).toBe(0);
    }
  });

  it("the orchestrator waits on one or two running agents it launched", () => {
    const one = waitingOnByRow(makeSession({ agents: [makeAgent({ id: "a" })] }));
    expect(ids(one, ORCHESTRATOR_ROW)).toEqual(["a"]);
    const two = waitingOnByRow(makeSession({ agents: [makeAgent({ id: "a" }), makeAgent({ id: "b", kind: "fork" })] }));
    expect(ids(two, ORCHESTRATOR_ROW)).toEqual(["a", "b"]);
    expect(two.has("a")).toBe(false);
  });

  it("a running agent waits on its own running children, and the orchestrator counts only its direct child", () => {
    const m = waitingOnByRow(makeSession({ agents: [makeAgent({ id: "a" }), makeAgent({ id: "b", parentId: "a" }), makeAgent({ id: "c", parentId: "a", kind: "fork" })] }));
    expect(ids(m, ORCHESTRATOR_ROW)).toEqual(["a"]);
    expect(ids(m, "a")).toEqual(["b", "c"]);
    expect(m.has("b")).toBe(false);
  });

  it("a finished parent is not waiting, even with a running child", () => {
    const m = waitingOnByRow(makeSession({ agents: [makeAgent({ id: "a", status: "done" }), makeAgent({ id: "b", parentId: "a" })] }));
    expect(m.has("a")).toBe(false);
    expect(m.has(ORCHESTRATOR_ROW)).toBe(false);
  });

  it("a child whose parent is missing, or itself, counts for the orchestrator, and a parent cycle does not loop", () => {
    const m = waitingOnByRow(makeSession({ agents: [makeAgent({ id: "a", parentId: "gone" }), makeAgent({ id: "b", parentId: "b" })] }));
    expect(ids(m, ORCHESTRATOR_ROW)).toEqual(["a", "b"]);
    const cyc = waitingOnByRow(makeSession({ agents: [makeAgent({ id: "x", parentId: "y" }), makeAgent({ id: "y", parentId: "x" })] }));
    expect(ids(cyc, "x")).toEqual(["y"]);
    expect(ids(cyc, "y")).toEqual(["x"]);
  });

  it("the session's own status wins: waiting on the user, stale or done show nothing", () => {
    for (const status of ["waiting", "stale", "done"] as const) {
      expect(waitingOnByRow(makeSession({ status, agents: [makeAgent()] })).size, status).toBe(0);
    }
  });

  it("words the tooltip for one and for several agents, and says it is not waiting on you", () => {
    expect(delegateText([makeAgent({ description: "Map call sites" })])).toBe("Waiting on 1 agent: Map call sites. Not waiting on you.");
    expect(delegateText([makeAgent({ description: "A" }), makeAgent({ description: "B" })])).toBe("Waiting on 2 agents: A, B. Not waiting on you.");
  });
});

describe("the orchestrator counts as an agent (#109)", () => {
  it("counts it as running while the session runs, so one done agent reads 1 running / 1 done", () => {
    const c = sessionCounts(makeSession({ status: "running", agents: [makeAgent({ status: "done" })] }));
    expect(c).toMatchObject({ running: 1, done: 1, all: 2 });
  });
  it("counts it as done once the session is done", () => {
    const c = sessionCounts(makeSession({ status: "done", agents: [makeAgent({ status: "done" })] }));
    expect(c).toMatchObject({ running: 0, done: 2, all: 2 });
  });
  it("counts it as neither running nor done while the session is stale", () => {
    const c = sessionCounts(makeSession({ status: "stale", agents: [makeAgent({ status: "done" })] }));
    expect(c).toMatchObject({ running: 0, done: 1, aborted: 1, all: 2 });
  });
  it("keeps failures and the other states as agentCounts has them", () => {
    const c = sessionCounts(makeSession({ status: "waiting", agents: [makeAgent({ status: "failed" }), makeAgent({ status: "queued" })] }));
    expect(c).toEqual({ running: 1, done: 0, failed: 1, queued: 1, aborted: 0, all: 3 });
  });
});

describe("the orchestrator's cost is the session's ledger less its agents (#109)", () => {
  const agents = [makeAgent({ id: "a", costUsdEst: 0.2 }), makeAgent({ id: "b", costUsdEst: 0.1 })];
  it("is what is left, so the rows add up to the session figure", () => {
    expect(orchestratorCostUsd(makeSession({ costUsd: 1, agents }))).toBeCloseTo(0.7);
  });
  it("is the whole figure when there are no agents", () => {
    expect(orchestratorCostUsd(makeSession({ costUsd: 0.87, agents: [] }))).toBe(0.87);
  });
  it("never goes below zero when the estimates overshoot the ledger", () => {
    expect(orchestratorCostUsd(makeSession({ costUsd: 0.1, agents }))).toBe(0);
  });
  it("is null with no session figure, and ignores agents with no price", () => {
    expect(orchestratorCostUsd(makeSession({ costUsd: null, agents }))).toBeNull();
    expect(orchestratorCostUsd(makeSession({ costUsd: 1, agents: [makeAgent({ costUsdEst: null }), agents[0]] }))).toBeCloseTo(0.8);
  });
});

describe("agent time is the orchestrator's time plus every agent's (#109)", () => {
  it("adds them, so parallel agents can pass wall-clock time", () => {
    const s = makeSession({ status: "running", startedAt: 0, agents: [makeAgent({ startedAt: 0, endedAt: 30_000 }), makeAgent({ startedAt: 0, endedAt: 30_000 })] });
    expect(sessionAgentSec(s, 40_000)).toBe(40 + 30 + 30);
  });
  it("runs a running agent to now and freezes a done session at its last report", () => {
    const s = makeSession({ status: "done", startedAt: 0, lastSeenAt: 50_000, agents: [makeAgent({ startedAt: 10_000, endedAt: null })] });
    expect(sessionAgentSec(s, 60_000)).toBe(50 + 50);
  });
});
