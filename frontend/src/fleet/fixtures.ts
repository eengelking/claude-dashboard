// View fixtures for the UI tests.
import type { ActivityView, AgentView, Kpis, SessionView, StateBody } from "./types";

export function makeAgent(over: Partial<AgentView> = {}): AgentView {
  return {
    id: "a1",
    parentId: null,
    kind: "subagent",
    type: "general-purpose",
    name: null,
    description: "Map call sites",
    model: "claude-sonnet-5-5",
    effort: "medium",
    effortSource: "requested",
    status: "running",
    startedAt: 1_000_000,
    endedAt: null,
    context: { tokens: 100_000, window: 1_000_000, percent: 10 },
    tokens: { input: 1000, output: 500, cacheRead: 8000, cacheWrite: 500 },
    costUsdEst: 0.12,
    skills: [],
    lastTool: "Read",
    toolCalls: 3,
    blowouts: 0,
    steps: { done: 2, total: null },
    promptExcerpt: "Find every call site.",
    answerExcerpt: null,
    failure: null,
    modelFamily: "sonnet",
    ...over,
  };
}

export function makeSession(over: Partial<SessionView> = {}): SessionView {
  return {
    id: "s1",
    name: "api-refactor",
    reporter: "mod",
    project: "~/dev/billing-service",
    cwd: "~/dev/billing-service/.claude/worktrees/invoice-v2",
    repoName: "acme/billing-service",
    resumeCommand: "cd /Users/dev/billing-service && claude --resume s1",
    git: { branch: "refactor/invoice-v2", detached: false, isWorktree: true, worktreePath: "/Users/dev/billing-service/.claude/worktrees/invoice-v2", ahead: 7, behind: 0, dirty: 3 },
    model: "claude-opus-5-5",
    modelFamily: "opus",
    effort: "xhigh",
    status: "running",
    waitReason: null,
    waitNote: null,
    endReason: null,
    startedAt: 1_000_000,
    lastSeenAt: 2_000_000,
    secondsSinceSeen: 0,
    context: { tokens: 410_000, window: 1_000_000, percent: 41 },
    costUsd: 12.84,
    tokensTotal: 2_500_000,
    blowouts: { orchestrator: 0, agents: 0, total: 0, level: 0, loopsHit: 0, loopsTotal: 1, log: [] },
    plan: {
      title: "Migrate invoices to v2 schema",
      source: "TaskCreate",
      steps: [
        { id: "1", text: "Map invoice call sites", state: "done", activeText: null, ownerAgentId: null, ownerLabel: "Explore · Haiku low" },
        { id: "2", text: "Port invoice endpoints", state: "active", activeText: "Porting", ownerAgentId: null, ownerLabel: null },
        { id: "3", text: "Run staging backfill", state: "blocked", activeText: null, ownerAgentId: null, ownerLabel: null },
        { id: "4", text: "Write rollout notes", state: "pending", activeText: null, ownerAgentId: null, ownerLabel: null },
      ],
    },
    agents: [],
    series: { tokensPerSec: new Array(60).fill(0), peakContext: new Array(60).fill(0), running: new Array(60).fill(0), blowoutSecondsAgo: [] },
    ...over,
  };
}

export function makeKpis(over: Partial<Kpis> = {}): Kpis {
  return {
    live: 1, running: 1, waiting: 0, stale: 0, agentsRunning: 0, agentsTotal: 0, planDone: 1, planTotal: 4,
    costToday: 12.84, tokensLastMinute: 1000, blowoutsTotal: 0, sessionsAtLevel2: 0,
    costPerMinute: new Array(60).fill(0), tokensPerSec: new Array(60).fill(0), ...over,
  };
}

export function makeEvent(over: Partial<ActivityView> = {}): ActivityView {
  return { id: "e1", sessionId: "s1", sessionName: "api-refactor", modelFamily: "opus", agentId: null, t: 1_000_000, kind: "note", text: "hello", data: null, ...over };
}

export function makeState(over: Partial<StateBody> = {}): StateBody {
  return {
    serverTime: 2_000_000,
    config: { staleAfterMs: 15_000, dropAfterMs: 60_000, lingerMs: 8_000 },
    sessions: [makeSession()],
    kpis: makeKpis(),
    clearedToday: 0,
    events: [makeEvent()],
    ...over,
  };
}
