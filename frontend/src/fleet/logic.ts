// Pure presentation logic: sorting, filtering, plan progress, agent counts and the agent tree.
import type { AgentView, Effort, ModelFamily, Plan, SessionView } from "./types";

export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** The selection value for the orchestrator's own row. Agent ids never start with "@", so it cannot collide. */
export const ORCHESTRATOR_ROW = "@orchestrator";

export type SortKey = "status" | "model" | "blow" | "ctx" | "cost" | "newest";
export const SORTS: Record<SortKey, string> = {
  status: "Status",
  model: "Model",
  blow: "Context blowouts",
  ctx: "Context used",
  cost: "Cost",
  newest: "Newest",
};

export type StatusFilter = "all" | "running" | "waiting" | "stale" | "blow";
export const STATUS_FILTERS: Record<StatusFilter, string> = {
  all: "All",
  running: "Running",
  waiting: "Waiting",
  stale: "Stale",
  blow: "Blowouts",
};

/** Model order for sorting: alphabetical by family, unknown models last. */
export const MODEL_ORDER: readonly ModelFamily[] = ["fable", "haiku", "opus", "sonnet", "other"];

const STATUS_ORDER: Record<SessionView["status"], number> = { running: 0, waiting: 1, stale: 2, done: 3 };

function byStatus(a: SessionView, b: SessionView): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
}

function byName(a: SessionView, b: SessionView): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortSessions(list: readonly SessionView[], key: SortKey): SessionView[] {
  const cmp: Record<SortKey, (a: SessionView, b: SessionView) => number> = {
    status: byStatus,
    model: (a, b) => MODEL_ORDER.indexOf(a.modelFamily) - MODEL_ORDER.indexOf(b.modelFamily) || byStatus(a, b),
    blow: (a, b) => b.blowouts.total - a.blowouts.total || byStatus(a, b),
    ctx: (a, b) => (b.context.percent ?? -1) - (a.context.percent ?? -1),
    cost: (a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1),
    newest: (a, b) => b.startedAt - a.startedAt,
  };
  const c = cmp[key];
  return list.slice().sort((a, b) => c(a, b) || byName(a, b));
}

export function filterSessions(list: readonly SessionView[], filter: { status: StatusFilter; q: string }): SessionView[] {
  const q = filter.q.trim().toLowerCase();
  return list.filter((s) => {
    if (filter.status === "blow") {
      if (!s.blowouts.total) return false;
    } else if (filter.status !== "all" && s.status !== filter.status) return false;
    if (q) {
      const hay = `${s.name}\n${s.project}\n${s.git?.branch ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Sessions nobody is attached to stay on the wall, dimmed, until their `hideAt`; after that they are set
 * aside (still live, still counted) unless the person asked to see them. A session that never said whether
 * a client is attached has no `hideAt` and is always shown.
 */
export function splitDetached(list: readonly SessionView[], now: number, showHidden: boolean): { shown: SessionView[]; hidden: SessionView[] } {
  const hidden = list.filter((s) => s.attached === false && s.hideAt !== null && now >= s.hideAt);
  const set = new Set(hidden);
  return { shown: showHidden ? list.slice() : list.filter((s) => !set.has(s)), hidden };
}

export interface PlanProgress {
  done: number;
  total: number;
  pct: number;
}

export function planProgress(plan: Plan | null): PlanProgress | null {
  if (!plan || !plan.steps.length) return null;
  const done = plan.steps.filter((s) => s.state === "done").length;
  return { done, total: plan.steps.length, pct: done / plan.steps.length };
}

/** The step being worked on now: the first active step, its active wording when it has one. */
export function currentStep(plan: Plan | null): string | null {
  const s = plan?.steps.find((x) => x.state === "active");
  return s ? s.text : null;
}

export interface AgentCounts {
  running: number;
  done: number;
  failed: number;
  queued: number;
  aborted: number;
  all: number;
}

export function agentCounts(agents: readonly AgentView[]): AgentCounts {
  const c: AgentCounts = { running: 0, done: 0, failed: 0, queued: 0, aborted: 0, all: agents.length };
  for (const a of agents) {
    if (a.status === "running") c.running++;
    else if (a.status === "done") c.done++;
    else if (a.status === "failed") c.failed++;
    else if (a.status === "queued") c.queued++;
    else c.aborted++;
  }
  return c;
}

export type Guide = "mid" | "last" | "blank";
export interface TreeRow {
  agent: AgentView;
  guides: Guide[];
}

/**
 * Agents nested under their parent. Each row carries one guide per level: `last` for the final child
 * at its level (an elbow), `mid` for others (a tee), and above them `blank` where the ancestor at that
 * level was a last child (no line) or `mid` where it was not (a continuing line). An agent whose parent
 * is not in the list is shown at the top level.
 */
export function buildTree(agents: readonly AgentView[]): TreeRow[] {
  const ids = new Set(agents.map((a) => a.id));
  const kids = new Map<string | null, AgentView[]>();
  for (const a of agents) {
    const p = a.parentId && ids.has(a.parentId) && a.parentId !== a.id ? a.parentId : null;
    const list = kids.get(p) ?? [];
    list.push(a);
    kids.set(p, list);
  }
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const walk = (pid: string | null, guides: Guide[]) => {
    const ks = kids.get(pid) ?? [];
    ks.forEach((a, i) => {
      if (visited.has(a.id)) return;
      visited.add(a.id);
      const last = i === ks.length - 1;
      rows.push({ agent: a, guides: [...guides, last ? "last" : "mid"] });
      walk(a.id, [...guides, last ? "blank" : "mid"]);
    });
  };
  walk(null, []);
  // Anything unreachable (a parent cycle) still shows, at the top level.
  for (const a of agents) if (!visited.has(a.id)) rows.push({ agent: a, guides: ["last"] });
  return rows;
}

export type AgentSortKey = "model" | "effort" | "ctx" | "tok" | "cost" | "time" | "status";

const AGENT_STATUS_ORDER: Record<AgentView["status"], number> = { running: 0, failed: 1, queued: 2, aborted: 3, done: 4 };

export function agentTokens(a: AgentView): number {
  return a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite;
}

export function agentElapsedSec(a: AgentView, now: number): number {
  return Math.max(0, ((a.endedAt ?? now) - a.startedAt) / 1000);
}

/** Default direction when a header is first clicked: names ascend, quantities descend. */
export function defaultAgentDir(key: AgentSortKey): 1 | -1 {
  return key === "model" || key === "effort" || key === "status" ? 1 : -1;
}

export function sortAgents(agents: readonly AgentView[], key: AgentSortKey, dir: 1 | -1, now: number): AgentView[] {
  const val: Record<AgentSortKey, (a: AgentView) => number> = {
    model: (a) => MODEL_ORDER.indexOf(a.modelFamily),
    effort: (a) => (a.effort ? EFFORTS.indexOf(a.effort) : -1),
    ctx: (a) => a.context.percent ?? -1,
    tok: agentTokens,
    cost: (a) => a.costUsdEst ?? -1,
    time: (a) => agentElapsedSec(a, now),
    status: (a) => AGENT_STATUS_ORDER[a.status],
  };
  const f = val[key];
  return agents.slice().sort((a, b) => (f(a) - f(b)) * dir || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Seconds since the session started, frozen once it is done. */
export function sessionElapsedSec(s: SessionView, now: number): number {
  return Math.max(0, ((s.status === "done" ? s.lastSeenAt : now) - s.startedAt) / 1000);
}

/** "fork" or the agent type, then the model's short name and the effort: "Explore · Haiku low". */
export function agentLabel(a: AgentView): string {
  return `${a.kind === "fork" ? "fork" : a.type} · ${familyName(a.modelFamily, a.model)}${a.effort ? ` ${a.effort}` : ""}`;
}

export function familyName(f: ModelFamily, model: string | null): string {
  if (f === "other") return model ?? "unknown";
  return f[0]!.toUpperCase() + f.slice(1);
}

/** When a heartbeat-lost session goes away by itself: the server's `dropAt`, else counted from the last heartbeat. */
export function dropAtOf(s: Pick<SessionView, "dropAt" | "lastSeenAt">, config: { staleAfterMs: number; dropAfterMs: number }): number {
  return s.dropAt ?? s.lastSeenAt + config.staleAfterMs + config.dropAfterMs;
}
