// Podium wire protocol: the Report the reporter mod POSTs (SPEC 6.2), the view types the server
// sends to the UI (SPEC 7.4), and a hand-written validator that enforces the limits in SPEC 7.7.
//
// The block between the PROTOCOL markers is copied verbatim into
// mod/podium-reporter/hooks/protocol.ts. A test compares the two after whitespace normalization,
// so edit both together.

// <protocol:begin>
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AgentStatus = 'queued' | 'running' | 'done' | 'failed' | 'aborted';

export type FailureClass =
  | 'Tool error'
  | 'Blocked by permission'
  | 'Model API error'
  | 'Refusal'
  | 'Context window exhausted'
  | 'Aborted'
  | 'Unknown';

export type EventKind =
  | 'start' | 'end' | 'spawn' | 'skill' | 'done' | 'fail' | 'blow' | 'compact' | 'plan' | 'wait' | 'note';

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ContextFill {
  tokens: number | null;
  window: number | null;
  percent: number | null;
}

export interface GitInfo {
  branch: string | null;
  detached: boolean;
  isWorktree: boolean;
  worktreePath: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

export interface RateLimit {
  kind: string;
  percentUsed: number;
  resetsAt: string | null;
}

export interface PlanStep {
  id: string;
  text: string;
  state: 'pending' | 'active' | 'done' | 'blocked';
  activeText: string | null;
  ownerAgentId: string | null;
  ownerLabel: string | null;
}

export interface Plan {
  title: string | null;
  source: 'TaskCreate' | 'TodoWrite' | 'podium_plan';
  steps: PlanStep[];
}

export interface Failure {
  class: FailureClass;
  at: number;
  tool: string | null;
  call: string | null;
  exitCode: number | null;
  outputTail: string[];
  evidence: string[];
  explanation: string | null;
  retriedAs: string | null;
}

export interface AgentReport {
  id: string;
  parentId: string | null;
  kind: 'subagent' | 'fork' | 'teammate';
  type: string;
  name: string | null;
  description: string;
  model: string | null;
  effort: Effort | null;
  effortSource: 'requested' | 'observed' | 'inherited' | 'unknown';
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  context: ContextFill;
  tokens: TokenCounts;
  costUsdEst: number;
  skills: string[];
  lastTool: string | null;
  toolCalls: number;
  /** Finished calls per tool name. null when the reporter is too old to send it. */
  toolCounts: Record<string, number> | null;
  blowouts: number;
  steps: { done: number; total: number | null } | null;
  promptExcerpt: string;
  answerExcerpt: string | null;
  failure: Failure | null;
}

export interface ActivityEvent {
  id: string;
  t: number;
  kind: EventKind;
  agentId: string | null;
  text: string;
  data: Record<string, unknown> | null;
}

export interface SessionReport {
  id: string;
  name: string;
  status: 'running' | 'waiting' | 'done';
  waitReason: 'permission' | 'input' | null;
  waitNote: string | null;
  endReason: string | null;
  resumeId: string | null;
  startedAt: number;
  cwd: string;
  projectRoot: string | null;
  repoName: string | null;
  git: GitInfo | null;
  model: string | null;
  effort: Effort | null;
  context: ContextFill;
  costUsd: number | null;
  tokens: TokenCounts;
  rateLimits: RateLimit[];
  blowouts: number;
  plan: Plan | null;
}

export interface Report {
  v: 1;
  sentAt: number;
  reporter: { name: 'podium-reporter'; version: string; engineVersion: string | null; hostSurface: string | null };
  session: SessionReport;
  agents: AgentReport[];
  events: ActivityEvent[];
}
// <protocol:end>

// ---------------------------------------------------------------------------------------------
// View types (server -> UI). The UI imports these with `import type`.
// ---------------------------------------------------------------------------------------------

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';

export type SessionStatusView = 'running' | 'waiting' | 'stale' | 'done';

export interface AgentView extends AgentReport {
  modelFamily: ModelFamily;
}

export interface BlowoutLogEntry {
  t: number;
  agentId: string | null;
  kind: string;
  tokensBefore: number | null;
  tokensAfter: number | null;
}

export interface SessionView {
  id: string;
  name: string;
  /** `mod`: the reporter mod (full detail); `hooks`: classic settings hooks only (no usage, cost, plan). */
  reporter: 'mod' | 'hooks';
  project: string;
  /** The session's working directory, home shortened to `~`. */
  cwd: string;
  repoName: string | null;
  resumeCommand: string;
  git: GitInfo | null;
  model: string | null;
  modelFamily: ModelFamily;
  effort: string | null;
  status: SessionStatusView;
  waitReason: 'permission' | 'input' | null;
  waitNote: string | null;
  endReason: string | null;
  startedAt: number;
  lastSeenAt: number;
  secondsSinceSeen: number;
  /** When a heartbeat-lost session leaves the wall on its own (epoch ms); null while it is not stale. */
  dropAt: number | null;
  context: ContextFill;
  costUsd: number | null;
  tokensTotal: number;
  blowouts: {
    orchestrator: number;
    agents: number;
    total: number;
    level: 0 | 1 | 2;
    loopsHit: number;
    loopsTotal: number;
    log: BlowoutLogEntry[];
  };
  plan: Plan | null;
  agents: AgentView[];
  series: { tokensPerSec: number[]; peakContext: number[]; running: number[]; blowoutSecondsAgo: number[] };
}

/** One stored activity event as the UI shows it: the event plus who it is about. */
export interface ActivityView {
  id: string;
  sessionId: string;
  sessionName: string;
  modelFamily: ModelFamily;
  agentId: string | null;
  t: number;
  kind: EventKind;
  text: string;
  data: Record<string, unknown> | null;
}

export interface Kpis {
  live: number;
  running: number;
  waiting: number;
  stale: number;
  agentsRunning: number;
  agentsTotal: number;
  planDone: number;
  planTotal: number;
  costToday: number;
  tokensLastMinute: number;
  blowoutsTotal: number;
  sessionsAtLevel2: number;
  /** Fleet cost per minute for the last 60 minutes, oldest first (USD). */
  costPerMinute: number[];
  /** Fleet tokens per second for the last 60 seconds, oldest first. */
  tokensPerSec: number[];
}

/** The server's lifecycle timings, so the UI can say when a stale session will be dropped. */
export interface LifecycleConfig {
  staleAfterMs: number;
  dropAfterMs: number;
  lingerMs: number;
}

export interface StateBody {
  serverTime: number;
  config: LifecycleConfig;
  sessions: SessionView[];
  kpis: Kpis;
  clearedToday: number;
  events: ActivityView[];
}

export type RemovedReason = 'done' | 'dropped' | 'deleted';

/** One ended or dropped session, as GET /api/fleet/history lists it. */
export interface HistoryRow {
  id: string;
  name: string;
  project: string;
  model: string | null;
  modelFamily: ModelFamily;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  costUsd: number | null;
  blowouts: number;
  agents: number;
  endReason: string | null;
}

// ---------------------------------------------------------------------------------------------
// Validation (SPEC 7.7). Hand-written: strings are clamped, arrays over their limit are rejected.
// ---------------------------------------------------------------------------------------------

export const LIMITS = {
  name: 80,
  text: 240,
  excerpt: 400,
  waitNote: 160,
  call: 300,
  line: 240,
  outputLines: 12,
  evidenceLines: 5,
  id: 200,
  path: 1024,
  short: 120,
  agents: 200,
  events: 100,
  planSteps: 100,
  skills: 50,
  toolNames: 100,
  rateLimits: 10,
  blowoutLog: 50,
} as const;

export type ValidateResult = { ok: true; report: Report } | { ok: false; error: string; path: string };

class Invalid extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

// Control characters other than tab are removed from every string.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/g;

function clampStr(v: string, max: number): string {
  const clean = v.replace(CONTROL, ' ');
  return clean.length > max ? clean.slice(0, max) : clean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw new Invalid(path, 'expected an object');
  return v;
}

function str(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string') throw new Invalid(path, 'expected a string');
  return clampStr(v, max);
}

function strOrNull(v: unknown, path: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  return str(v, path, max);
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Invalid(path, 'expected a finite number');
  return v;
}

function numOrNull(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null;
  return num(v, path);
}

function int(v: unknown, path: string): number {
  const n = num(v, path);
  if (n < 0) throw new Invalid(path, 'expected a non-negative number');
  return Math.round(n);
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Invalid(path, 'expected a boolean');
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new Invalid(path, `expected one of ${allowed.join(', ')}`);
  }
  return v as T;
}

function oneOfOrNull<T extends string>(v: unknown, path: string, allowed: readonly T[]): T | null {
  if (v === null || v === undefined) return null;
  return oneOf(v, path, allowed);
}

/** Calls per tool name: names clipped, counts non-negative integers, the most used `max` names kept. */
function countsOrNull(v: unknown, path: string, max: number): Record<string, number> | null {
  if (v === null || v === undefined) return null;
  const merged = new Map<string, number>();
  for (const [k, n] of Object.entries(obj(v, path))) {
    const name = clampStr(k, LIMITS.short);
    merged.set(name, (merged.get(name) ?? 0) + int(n, `${path}.${k}`));
  }
  const top = [...merged].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max);
  return Object.fromEntries(top);
}

function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new Invalid(path, 'expected an array');
  if (v.length > max) throw new Invalid(path, `at most ${max} items allowed`);
  return v;
}

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const AGENT_STATUSES: readonly AgentStatus[] = ['queued', 'running', 'done', 'failed', 'aborted'];
const EVENT_KINDS: readonly EventKind[] = ['start', 'end', 'spawn', 'skill', 'done', 'fail', 'blow', 'compact', 'plan', 'wait', 'note'];
const FAILURE_CLASSES: readonly FailureClass[] = [
  'Tool error',
  'Blocked by permission',
  'Model API error',
  'Refusal',
  'Context window exhausted',
  'Aborted',
  'Unknown',
];

function tokens(v: unknown, path: string): TokenCounts {
  const o = obj(v, path);
  return {
    input: int(o.input, `${path}.input`),
    output: int(o.output, `${path}.output`),
    cacheRead: int(o.cacheRead, `${path}.cacheRead`),
    cacheWrite: int(o.cacheWrite, `${path}.cacheWrite`),
  };
}

function context(v: unknown, path: string): ContextFill {
  const o = obj(v, path);
  const percent = numOrNull(o.percent, `${path}.percent`);
  return {
    tokens: numOrNull(o.tokens, `${path}.tokens`),
    window: numOrNull(o.window, `${path}.window`),
    percent: percent === null ? null : Math.max(0, Math.min(100, percent)),
  };
}

function git(v: unknown, path: string): GitInfo | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  return {
    branch: strOrNull(o.branch, `${path}.branch`, LIMITS.short),
    detached: bool(o.detached, `${path}.detached`),
    isWorktree: bool(o.isWorktree, `${path}.isWorktree`),
    worktreePath: strOrNull(o.worktreePath, `${path}.worktreePath`, LIMITS.path),
    ahead: int(o.ahead, `${path}.ahead`),
    behind: int(o.behind, `${path}.behind`),
    dirty: int(o.dirty, `${path}.dirty`),
  };
}

function plan(v: unknown, path: string): Plan | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const steps = arr(o.steps, `${path}.steps`, LIMITS.planSteps).map((s, i) => {
    const p = `${path}.steps[${i}]`;
    const so = obj(s, p);
    return {
      id: str(so.id, `${p}.id`, LIMITS.id),
      text: str(so.text, `${p}.text`, LIMITS.text),
      state: oneOf(so.state, `${p}.state`, ['pending', 'active', 'done', 'blocked'] as const),
      activeText: strOrNull(so.activeText, `${p}.activeText`, LIMITS.text),
      ownerAgentId: strOrNull(so.ownerAgentId, `${p}.ownerAgentId`, LIMITS.id),
      ownerLabel: strOrNull(so.ownerLabel, `${p}.ownerLabel`, LIMITS.short),
    };
  });
  return {
    title: strOrNull(o.title, `${path}.title`, LIMITS.text),
    source: oneOf(o.source, `${path}.source`, ['TaskCreate', 'TodoWrite', 'podium_plan'] as const),
    steps,
  };
}

function lines(v: unknown, path: string, keep: number, fromEnd: boolean): string[] {
  if (!Array.isArray(v)) throw new Invalid(path, 'expected an array');
  if (v.length > 1000) throw new Invalid(path, 'at most 1000 items allowed');
  const all = v.map((l, i) => str(l, `${path}[${i}]`, LIMITS.line));
  return fromEnd ? all.slice(-keep) : all.slice(0, keep);
}

function failure(v: unknown, path: string): Failure | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const exit = numOrNull(o.exitCode, `${path}.exitCode`);
  return {
    class: oneOf(o.class, `${path}.class`, FAILURE_CLASSES),
    at: num(o.at, `${path}.at`),
    tool: strOrNull(o.tool, `${path}.tool`, LIMITS.short),
    call: strOrNull(o.call, `${path}.call`, LIMITS.call),
    exitCode: exit === null ? null : Math.round(exit),
    outputTail: lines(o.outputTail, `${path}.outputTail`, LIMITS.outputLines, true),
    evidence: lines(o.evidence, `${path}.evidence`, LIMITS.evidenceLines, false),
    explanation: strOrNull(o.explanation, `${path}.explanation`, LIMITS.excerpt),
    retriedAs: strOrNull(o.retriedAs, `${path}.retriedAs`, LIMITS.id),
  };
}

function agent(v: unknown, path: string): AgentReport {
  const o = obj(v, path);
  let steps: AgentReport['steps'] = null;
  if (o.steps !== null && o.steps !== undefined) {
    const so = obj(o.steps, `${path}.steps`);
    const total = numOrNull(so.total, `${path}.steps.total`);
    steps = { done: int(so.done, `${path}.steps.done`), total: total === null ? null : Math.max(0, Math.round(total)) };
  }
  return {
    id: str(o.id, `${path}.id`, LIMITS.id),
    parentId: strOrNull(o.parentId, `${path}.parentId`, LIMITS.id),
    kind: oneOf(o.kind, `${path}.kind`, ['subagent', 'fork', 'teammate'] as const),
    type: str(o.type, `${path}.type`, LIMITS.short),
    name: strOrNull(o.name, `${path}.name`, LIMITS.name),
    description: str(o.description, `${path}.description`, LIMITS.text),
    model: strOrNull(o.model, `${path}.model`, LIMITS.short),
    effort: oneOfOrNull(o.effort, `${path}.effort`, EFFORTS),
    effortSource: oneOf(o.effortSource, `${path}.effortSource`, ['requested', 'observed', 'inherited', 'unknown'] as const),
    status: oneOf(o.status, `${path}.status`, AGENT_STATUSES),
    startedAt: num(o.startedAt, `${path}.startedAt`),
    endedAt: numOrNull(o.endedAt, `${path}.endedAt`),
    context: context(o.context, `${path}.context`),
    tokens: tokens(o.tokens, `${path}.tokens`),
    costUsdEst: Math.max(0, num(o.costUsdEst, `${path}.costUsdEst`)),
    skills: arr(o.skills, `${path}.skills`, LIMITS.skills).map((s, i) => str(s, `${path}.skills[${i}]`, LIMITS.short)),
    lastTool: strOrNull(o.lastTool, `${path}.lastTool`, LIMITS.short),
    toolCalls: int(o.toolCalls, `${path}.toolCalls`),
    toolCounts: countsOrNull(o.toolCounts, `${path}.toolCounts`, LIMITS.toolNames),
    blowouts: int(o.blowouts, `${path}.blowouts`),
    steps,
    promptExcerpt: str(o.promptExcerpt, `${path}.promptExcerpt`, LIMITS.excerpt),
    answerExcerpt: strOrNull(o.answerExcerpt, `${path}.answerExcerpt`, LIMITS.excerpt),
    failure: failure(o.failure, `${path}.failure`),
  };
}

function event(v: unknown, path: string): ActivityEvent {
  const o = obj(v, path);
  let data: Record<string, unknown> | null = null;
  if (o.data !== null && o.data !== undefined) {
    data = obj(o.data, `${path}.data`);
    if (JSON.stringify(data).length > 4096) throw new Invalid(`${path}.data`, 'at most 4096 characters of data allowed');
  }
  return {
    id: str(o.id, `${path}.id`, LIMITS.id),
    t: num(o.t, `${path}.t`),
    kind: oneOf(o.kind, `${path}.kind`, EVENT_KINDS),
    agentId: strOrNull(o.agentId, `${path}.agentId`, LIMITS.id),
    text: str(o.text, `${path}.text`, LIMITS.text),
    data,
  };
}

function session(v: unknown, path: string): SessionReport {
  const o = obj(v, path);
  const id = str(o.id, `${path}.id`, LIMITS.id);
  if (!id) throw new Invalid(`${path}.id`, 'must not be empty');
  return {
    id,
    name: str(o.name, `${path}.name`, LIMITS.name),
    status: oneOf(o.status, `${path}.status`, ['running', 'waiting', 'done'] as const),
    waitReason: oneOfOrNull(o.waitReason, `${path}.waitReason`, ['permission', 'input'] as const),
    waitNote: strOrNull(o.waitNote, `${path}.waitNote`, LIMITS.waitNote),
    endReason: strOrNull(o.endReason, `${path}.endReason`, LIMITS.short),
    resumeId: strOrNull(o.resumeId, `${path}.resumeId`, LIMITS.id),
    startedAt: num(o.startedAt, `${path}.startedAt`),
    cwd: str(o.cwd, `${path}.cwd`, LIMITS.path),
    projectRoot: strOrNull(o.projectRoot, `${path}.projectRoot`, LIMITS.path),
    repoName: strOrNull(o.repoName, `${path}.repoName`, LIMITS.short),
    git: git(o.git, `${path}.git`),
    model: strOrNull(o.model, `${path}.model`, LIMITS.short),
    effort: oneOfOrNull(o.effort, `${path}.effort`, EFFORTS),
    context: context(o.context, `${path}.context`),
    costUsd: (() => {
      const c = numOrNull(o.costUsd, `${path}.costUsd`);
      return c === null ? null : Math.max(0, c);
    })(),
    tokens: tokens(o.tokens, `${path}.tokens`),
    rateLimits: arr(o.rateLimits, `${path}.rateLimits`, LIMITS.rateLimits).map((r, i) => {
      const p = `${path}.rateLimits[${i}]`;
      const ro = obj(r, p);
      return {
        kind: str(ro.kind, `${p}.kind`, LIMITS.short),
        percentUsed: num(ro.percentUsed, `${p}.percentUsed`),
        resetsAt: strOrNull(ro.resetsAt, `${p}.resetsAt`, LIMITS.short),
      };
    }),
    blowouts: int(o.blowouts, `${path}.blowouts`),
    plan: plan(o.plan, `${path}.plan`),
  };
}

/**
 * Validates an untrusted body as a Report. Never throws. Strings are clamped to their limits and
 * stripped of control characters; arrays over their limit, wrong types and unknown enum values are
 * rejected with the path of the first offending field. Unknown fields are dropped.
 */
export function validateReport(body: unknown): ValidateResult {
  try {
    const o = obj(body, '$');
    if (o.v === undefined) throw new Invalid('$.v', 'missing protocol version');
    if (o.v !== 1) throw new Invalid('$.v', 'unsupported protocol version');
    const r = obj(o.reporter, '$.reporter');
    const report: Report = {
      v: 1,
      sentAt: num(o.sentAt, '$.sentAt'),
      reporter: {
        name: oneOf(r.name, '$.reporter.name', ['podium-reporter'] as const),
        version: str(r.version, '$.reporter.version', LIMITS.short),
        engineVersion: strOrNull(r.engineVersion, '$.reporter.engineVersion', LIMITS.short),
        hostSurface: strOrNull(r.hostSurface, '$.reporter.hostSurface', LIMITS.short),
      },
      session: session(o.session, '$.session'),
      agents: arr(o.agents, '$.agents', LIMITS.agents).map((a, i) => agent(a, `$.agents[${i}]`)),
      events: arr(o.events, '$.events', LIMITS.events).map((e, i) => event(e, `$.events[${i}]`)),
    };
    return { ok: true, report };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message, path: err.path };
    return { ok: false, error: 'invalid report', path: '$' };
  }
}
