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
