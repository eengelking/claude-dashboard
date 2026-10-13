// Report types for the Podium reporter (SPEC 6.2). Types only.
// The block between the PROTOCOL markers is identical to the one in server/src/fleet/protocol.ts;
// a server test compares the two after whitespace normalization, so edit both together.

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
  /** The main thread's prompt cache: when it was last refreshed and whether it is kept warm. null when the reporter is too old to send it. */
  cache: CacheReport | null;
}

/**
 * Why cache warming stopped for an idle period: its maximum duration, an API error, nothing to fork (a /clear), an
 * aborted ping, a cache that had already expired, or a ping with no answer within PING_TIMEOUT_MS (2 minutes).
 */
export type WarmStop = 'max-duration' | 'api-error' | 'nothing-to-fork' | 'aborted' | 'expired' | 'timeout';

/**
 * Cache warming (the `cacheWarming` option or `/podium warm on`): while the session waits on the person, one
 * tool-less request over its own transcript shortly before the cache would expire. Off by default.
 */
export interface CacheWarming {
  on: boolean;
  /** `off`; `ready`: on, the session is running or waits on a permission prompt (never pinged); `warming`: on, waiting for a prompt, pinging; `stopped`: stopped for this idle period (stopReason). */
  state: 'off' | 'ready' | 'warming' | 'stopped';
  stopReason: WarmStop | null;
  /** Pings sent this session, and their estimated cost from the usage each returned. */
  pings: number;
  costUsdEst: number;
  lastPingAt: number | null;
  /** When warming stops on its own in this idle period (its start plus the maximum duration); null unless warming. */
  untilAt: number | null;
}

/** The main thread's prompt cache, from the reporter's clock (the server converts the times to its own). */
export interface CacheReport {
  /** When the main thread's latest model request started, a warming ping included; null before the first response. */
  lastRequestAt: number | null;
  /** How long a cache entry lives from the start of the request that read or wrote it: 300,000, or 3,600,000 when the session uses the 1-hour lifetime. */
  ttlMs: number;
  /** The tokens the next request re-sends (the main thread's context); a cold cache writes them again. null when unknown. */
  tokens: number | null;
  /** The estimated extra cost of that cold start over reading a warm cache (USD); null for a model with no price. */
  coldCostUsd: number | null;
  warming: CacheWarming;
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
