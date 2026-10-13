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

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/** One file the session changed. `added` and `removed` are null for a binary file. */
export interface ChangedFile {
  path: string;
  status: FileStatus;
  added: number | null;
  removed: number | null;
  /** The old path of a renamed file. */
  from: string | null;
}

/**
 * What the session changed in its repository: the files (at most 200, by path) and the totals over
 * all of them. `since` says what the diff is against: the commit HEAD was at when the session began,
 * the merge base with the upstream branch when that commit is gone, or HEAD alone.
 */
export interface FilesReport {
  files: ChangedFile[];
  total: number;
  added: number;
  removed: number;
  since: 'start' | 'upstream' | 'worktree';
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

/**
 * What the orchestrator's main loop reports about its own work, in the shapes an AgentReport uses for
 * the fields of the same name. Calls made by agents it launched are not counted here.
 */
export interface LoopReport {
  skills: string[];
  lastTool: string | null;
  toolCalls: number;
  toolCounts: Record<string, number>;
  steps: { done: number; total: null };
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
  costUsdEst: number | null;
  skills: string[];
  lastTool: string | null;
  toolCalls: number;
  /** Finished calls per tool name. null when the reporter is too old to send it. */
  toolCounts: Record<string, number> | null;
  blowouts: number;
  steps: { done: number; total: number | null } | null;
  promptExcerpt: string;
  answerExcerpt: string | null;
  /**
   * The whole task prompt and final answer, redacted, line breaks kept. Sent only when the reporter's
   * `fullPrompts` option is on, and only once per text (the server keeps what it was given).
   */
  promptText?: string;
  answerText?: string;
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

/** What a session idle between turns is still waiting on: background work in flight, or a scheduled wake-up (#119). */
export type BackgroundKind = 'shell' | 'agent' | 'monitor' | 'workflow' | 'wakeup' | 'other';

export interface BackgroundTask {
  type: BackgroundKind;
  /** A short description; never a whole shell command. */
  description: string;
  status: string;
}

export interface BackgroundWait {
  tasks: BackgroundTask[];
  /** When the next scheduled wake-up fires (epoch ms); null when there is none or its time is unknown. */
  wakeAt: number | null;
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
  /** The main loop's steps, tools and skills. null when the reporter is too old to send it. */
  loop: LoopReport | null;
  /** The files the session changed. null when the reporter is too old to send it. */
  files: FilesReport | null;
  /** Whether any client (a terminal, a phone) is attached. false for a background session left running after /exit. null when unknown: a reporter too old to send it. */
  attached: boolean | null;
  /** Background work the session is idle on. Absent from a reporter older than 0.11.0 and when there is none. */
  background?: BackgroundWait | null;
}

export interface Report {
  v: 1;
  sentAt: number;
  reporter: { name: 'podium-reporter'; version: string; engineVersion: string | null; hostSurface: string | null };
  session: SessionReport;
  agents: AgentReport[];
  events: ActivityEvent[];
  /** The person this reporter is configured as. The server checks it against the token's owner and refuses a mismatch. Omitted or null when none is set. */
  userName?: string | null;
  /** The machine the session runs on. Sent only with a userName, so nothing identifying leaves an unnamed reporter. Omitted or null from a reporter older than 0.9.0. */
  machine?: MachineInfo | null;
}

/** Which machine a session runs on: its host name, and a random id the reporter keeps so two machines with one host name stay apart. */
export interface MachineInfo {
  name: string;
  id: string;
}
// <protocol:end>

// ---------------------------------------------------------------------------------------------
// View types (server -> UI). The UI imports these with `import type`.
// ---------------------------------------------------------------------------------------------

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';

export type SessionStatusView = 'running' | 'waiting' | 'stale' | 'done';

export interface AgentView extends Omit<AgentReport, 'promptText' | 'answerText'> {
  modelFamily: ModelFamily;
  /** Length of the full prompt / answer the server holds, null when it has none (served by the text endpoint). */
  promptChars: number | null;
  answerChars: number | null;
}

export interface BlowoutLogEntry {
  t: number;
  agentId: string | null;
  kind: string;
  tokensBefore: number | null;
  tokensAfter: number | null;
}

/** `outdated`: below the supported range, update the mod. `newer`: above it, upgrade the server. `unknown`: unreadable, no warning. */
export type ReporterCompat = 'ok' | 'outdated' | 'newer' | 'unknown';

/** The reporter versions a server reads correctly (major.minor compared; patch ignored). */
export interface ReporterSupport {
  min: string;
  max: string;
}

export interface SessionView {
  id: string;
  name: string;
  /** `mod`: the reporter mod (full detail); `hooks`: classic settings hooks only (no usage, cost, plan). */
  reporter: 'mod' | 'hooks';
  /** The mod's version as it reported it; null for a hooks-only session, which has no mod. */
  reporterVersion: string | null;
  /** How that version sits against the range this server supports. Always `unknown` for hooks. */
  compat: ReporterCompat;
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
  /** The main loop's steps, tools and skills; null from a reporter older than 0.4.0 and for a hooks-only session. */
  loop: LoopReport | null;
  /** The files the session changed; null from a reporter older than 0.6.0 and for a hooks-only session. */
  files: FilesReport | null;
  /** What the session is idle on: background work or a scheduled wake-up. null when it waits on nothing. Not a wait on the person. */
  background: BackgroundWait | null;
  /** Whether any client is attached; null from a reporter older than 0.7.0 and for a hooks-only session, which counts as attached. */
  attached: boolean | null;
  /** When a session nobody is attached to leaves the wall: the first detached report plus DETACHED_HIDE_AFTER_MS. null while attached or unknown. */
  hideAt: number | null;
  /** Who the server decided this session belongs to, from the token: a person's name, `Admin` for the admin secret, null when auth is off or the session predates tokens. */
  owner: string | null;
  /** The group the owner is in, from Admin; null for Admin, no owner, or a person with no group. */
  ownerGroup: string | null;
  /** The machine the session runs on, as the reporter sent it; null when it sent none (no userName, or older than 0.9.0). */
  machine: MachineInfo | null;
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
  /** Live sessions on a model with no price (not a Claude model); their cost is left out of `costToday`. */
  unpricedSessions: number;
  tokensLastMinute: number;
  blowoutsTotal: number;
  sessionsAtLevel2: number;
  /** Fleet cost per minute for the last 60 minutes, oldest first (USD). */
  costPerMinute: number[];
  /** Fleet tokens per second for the last 60 seconds, oldest first. */
  tokensPerSec: number[];
  /** `costToday` split by owner (null for sessions with no owner), with each owner's group, largest first. */
  costTodayByOwner: OwnerSpend[];
}

/** One owner's share of today's estimated spend. */
export interface OwnerSpend {
  owner: string | null;
  group: string | null;
  costUsd: number;
}

/** The server's lifecycle timings, so the UI can say when a stale session will be dropped. */
export interface LifecycleConfig {
  staleAfterMs: number;
  dropAfterMs: number;
  lingerMs: number;
  detachedHideAfterMs: number;
}

/** The wall's display settings, set in Admin > Settings (SPEC 8.1). Notices default on; background sessions default off. */
export interface WallSettingsView {
  /** One switch per informational notice, by id. */
  notices: Record<string, boolean>;
  showBackgroundSessions: boolean;
}

export interface StateBody {
  serverTime: number;
  config: LifecycleConfig;
  sessions: SessionView[];
  kpis: Kpis;
  clearedToday: number;
  events: ActivityView[];
  /** The server's own version and the reporter range it supports, for the mismatch notice. */
  server: { version: string; reporterSupport: ReporterSupport };
  wall: WallSettingsView;
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
  /** promptText / answerText: the 20,000-character cap plus room for the mod's cut-off marker. */
  fullText: 20_100,
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
  backgroundTasks: 20,
  backgroundDescription: 120,
  rateLimits: 10,
  blowoutLog: 50,
  files: 200,
  filePath: 300,
  machineName: 64,
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

// The full prompt and answer keep their line breaks: only the other control characters go.
// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function clampText(v: string, max: number): string {
  const clean = v.replace(CONTROL_KEEP_NEWLINE, ' ');
  return clean.length > max ? clean.slice(0, max) : clean;
}

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

function text(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string') throw new Invalid(path, 'expected a string');
  return clampText(v, max);
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
    costUsdEst: (() => {
      const c = numOrNull(o.costUsdEst, `${path}.costUsdEst`);
      return c === null ? null : Math.max(0, c);
    })(),
    skills: arr(o.skills, `${path}.skills`, LIMITS.skills).map((s, i) => str(s, `${path}.skills[${i}]`, LIMITS.short)),
    lastTool: strOrNull(o.lastTool, `${path}.lastTool`, LIMITS.short),
    toolCalls: int(o.toolCalls, `${path}.toolCalls`),
    toolCounts: countsOrNull(o.toolCounts, `${path}.toolCounts`, LIMITS.toolNames),
    blowouts: int(o.blowouts, `${path}.blowouts`),
    steps,
    promptExcerpt: str(o.promptExcerpt, `${path}.promptExcerpt`, LIMITS.excerpt),
    answerExcerpt: strOrNull(o.answerExcerpt, `${path}.answerExcerpt`, LIMITS.excerpt),
    ...(o.promptText === undefined || o.promptText === null ? {} : { promptText: text(o.promptText, `${path}.promptText`, LIMITS.fullText) }),
    ...(o.answerText === undefined || o.answerText === null ? {} : { answerText: text(o.answerText, `${path}.answerText`, LIMITS.fullText) }),
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

function loop(v: unknown, path: string): LoopReport | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const steps = obj(o.steps, `${path}.steps`);
  return {
    skills: arr(o.skills, `${path}.skills`, LIMITS.skills).map((s, i) => str(s, `${path}.skills[${i}]`, LIMITS.short)),
    lastTool: strOrNull(o.lastTool, `${path}.lastTool`, LIMITS.short),
    toolCalls: int(o.toolCalls, `${path}.toolCalls`),
    toolCounts: countsOrNull(o.toolCounts, `${path}.toolCounts`, LIMITS.toolNames) ?? {},
    steps: { done: int(steps.done, `${path}.steps.done`), total: null },
  };
}

const FILE_STATUSES: readonly FileStatus[] = ['added', 'modified', 'deleted', 'renamed'];

function intOrNull(v: unknown, path: string): number | null {
  return v === null || v === undefined ? null : int(v, path);
}

/** Keeps the first LIMITS.files entries rather than rejecting a longer list; `total` never falls below what is listed. */
function filesReport(v: unknown, path: string): FilesReport | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const listed = arr(o.files, `${path}.files`, 1000).slice(0, LIMITS.files);
  const files = listed.map((f, i) => {
    const p = `${path}.files[${i}]`;
    const fo = obj(f, p);
    return {
      path: str(fo.path, `${p}.path`, LIMITS.filePath),
      status: oneOf(fo.status, `${p}.status`, FILE_STATUSES),
      added: intOrNull(fo.added, `${p}.added`),
      removed: intOrNull(fo.removed, `${p}.removed`),
      from: strOrNull(fo.from, `${p}.from`, LIMITS.filePath),
    };
  });
  return {
    files,
    total: Math.max(int(o.total, `${path}.total`), files.length),
    added: int(o.added, `${path}.added`),
    removed: int(o.removed, `${path}.removed`),
    since: oneOf(o.since, `${path}.since`, ['start', 'upstream', 'worktree'] as const),
  };
}

function session(v: unknown, path: string): SessionReport {
  const o = obj(v, path);
  const id = str(o.id, `${path}.id`, LIMITS.id);
  if (!id) throw new Invalid(`${path}.id`, 'must not be empty');
  const bg = background(o.background, `${path}.background`);
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
    loop: loop(o.loop, `${path}.loop`),
    files: filesReport(o.files, `${path}.files`),
    attached: o.attached === undefined || o.attached === null ? null : bool(o.attached, `${path}.attached`),
    ...(bg ? { background: bg } : {}),
  };
}

const BACKGROUND_KINDS = ['shell', 'agent', 'monitor', 'workflow', 'wakeup', 'other'] as const;

/** What a session idle between turns still waits on (#119). An empty list is no background work at all. */
function background(v: unknown, path: string): BackgroundWait | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const tasks = arr(o.tasks, `${path}.tasks`, LIMITS.backgroundTasks).map((t, i) => {
    const p = `${path}.tasks[${i}]`;
    const to = obj(t, p);
    return {
      type: oneOf(to.type, `${p}.type`, BACKGROUND_KINDS),
      description: str(to.description, `${p}.description`, LIMITS.backgroundDescription),
      status: str(to.status, `${p}.status`, 40),
    };
  });
  const wakeAt = numOrNull(o.wakeAt, `${path}.wakeAt`);
  return tasks.length ? { tasks, wakeAt } : null;
}

/** A reporter's machine: a host name (clamped) and its own random id (letters, digits, `-` and `_`, at most 32). */
function machine(v: unknown, path: string): MachineInfo | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const name = str(o.name, `${path}.name`, LIMITS.machineName).trim();
  if (!name) throw new Invalid(`${path}.name`, 'expected a host name');
  const id = str(o.id, `${path}.id`, 64);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Invalid(`${path}.id`, 'expected 1 to 32 letters, digits, - or _');
  return { name, id };
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
    const userName = strOrNull(o.userName, '$.userName', LIMITS.name);
    if (userName !== null) report.userName = userName;
    const m = machine(o.machine, '$.machine');
    if (m !== null) report.machine = m;
    return { ok: true, report };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message, path: err.path };
    return { ok: false, error: 'invalid report', path: '$' };
  }
}
