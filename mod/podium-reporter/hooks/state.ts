// The in-memory model of one session, and the pure reducers the hooks feed it (SPEC 5.3, 5.6).
// Every reducer returns a new state and leaves its input alone. No `$` here, and nothing UI: a pane
// added later can read this state as it is.
import {
  buildFailure,
  candidateFrom,
  classify,
  evidence,
  excerpt,
  clip,
  type EndReason,
  type FailureCandidate,
} from './failures.ts';
import { costOf, shortName, windowOf } from './models.ts';
import { assignOwners, emptyPlan, setTitle, taskCreate, taskUpdate, todoWrite, type PlanState } from './plan.ts';
import type { ActivityEvent, AgentStatus, Effort, Failure, GitInfo, RateLimit } from './protocol.ts';

export const BLOWOUT_DEDUP_MS = 2000;
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EVENT_QUEUE_MAX = 500;
export const PLAN_TOOL = 'mcp__podium-reporter__plan';

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  model?: string;
}

export interface LoopStats {
  model: string | null;
  effort: Effort | null;
  ctxTokens: number | null;
  window: number | null;
  tokens: Tokens;
  cost: number;
  /** Model requests seen. */
  steps: number;
  toolCalls: number;
  lastTool: string | null;
  skills: string[];
  blowouts: number;
  blowTimes: number[];
  lastStopReason: string | null;
  candidate: FailureCandidate | null;
  failedCalls: Record<string, number>;
  reads: Record<string, number>;
}

export interface AgentState extends LoopStats {
  id: string;
  parentId: string | null;
  kind: 'subagent' | 'fork' | 'teammate';
  type: string;
  name: string | null;
  description: string;
  effortSource: 'requested' | 'observed' | 'inherited' | 'unknown';
  status: AgentStatus;
  startedAt: number;
  endedAt: number | null;
  promptExcerpt: string;
  answerExcerpt: string | null;
  failure: Failure | null;
  toolUseId: string | null;
}

export interface PendingSpawn {
  effort: Effort | null;
  model: string | null;
  subagentType: string | null;
  description: string | null;
  name: string | null;
  at: number;
}

export interface SessionState {
  id: string;
  startedAt: number;
  cwd: string;
  projectRoot: string | null;
  repoName: string | null;
  git: GitInfo | null;
  status: 'running' | 'waiting' | 'done';
  /** The main loop is between turns (waiting for the person). */
  mainIdle: boolean;
  waitReason: 'permission' | 'input' | null;
  waitNote: string | null;
  endReason: string | null;
  resumeId: string | null;
  ended: boolean;
  main: LoopStats;
  /** The main loop's context as the status line reads it (preferred over step usage). */
  context: { tokens: number | null; window: number | null; percent: number | null };
  costUsd: number | null;
  rateLimits: RateLimit[];
  plan: PlanState;
  agents: Record<string, AgentState>;
  /** Agent ids in spawn order. */
  order: string[];
  /** Agent tool calls seen before (or after) their spawn, by tool_use_id. */
  pending: Record<string, PendingSpawn>;
  events: ActivityEvent[];
  evSeq: number;
  dirty: boolean;
}

export function emptyLoop(model: string | null = null): LoopStats {
  return {
    model,
    effort: null,
    ctxTokens: null,
    window: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    steps: 0,
    toolCalls: 0,
    lastTool: null,
    skills: [],
    blowouts: 0,
    blowTimes: [],
    lastStopReason: null,
    candidate: null,
    failedCalls: {},
    reads: {},
  };
}

export function newSession(i: { id: string; cwd: string; startedAt: number; model?: string | null }): SessionState {
  return {
    id: i.id,
    startedAt: i.startedAt,
    cwd: i.cwd,
    projectRoot: null,
    repoName: null,
    git: null,
    status: 'waiting',
    mainIdle: true,
    waitReason: 'input',
    waitNote: null,
    endReason: null,
    resumeId: null,
    ended: false,
    main: emptyLoop(i.model ?? null),
    context: { tokens: null, window: null, percent: null },
    costUsd: null,
    rateLimits: [],
    plan: emptyPlan,
    agents: {},
    order: [],
    pending: {},
    events: [],
    evSeq: 0,
    dirty: true,
  };
}

/** A fresh session under a new id (after /clear), keeping where it runs. */
export function resetForNewId(s: SessionState, id: string, startedAt: number): SessionState {
  const n = newSession({ id, cwd: s.cwd, startedAt, model: s.main.model });
  return { ...n, projectRoot: s.projectRoot, repoName: s.repoName, git: s.git, main: { ...n.main, effort: s.main.effort } };
}

// ---- helpers ------------------------------------------------------------------------------------

export function asEffort(v: unknown): Effort | null {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v) ? (v as Effort) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Recomputes the session status from its parts. */
function withStatus(s: SessionState): SessionState {
  let status: SessionState['status'];
  let waitReason = s.waitReason;
  if (s.ended) {
    status = 'done';
    waitReason = null;
  } else if (s.waitReason === 'permission') status = 'waiting';
  else if (s.mainIdle && !Object.values(s.agents).some((a) => a.status === 'running' || a.status === 'queued')) {
    status = 'waiting';
    waitReason = 'input';
  } else {
    status = 'running';
    waitReason = null;
  }
  const waitNote = waitReason ? s.waitNote : null;
  return { ...s, status, waitReason, waitNote, dirty: true };
}

export function addEvent(s: SessionState, kind: ActivityEvent['kind'], agentId: string | null, text: string, t: number, data: Record<string, unknown> | null = null): SessionState {
  const n = s.evSeq + 1;
  const ev: ActivityEvent = { id: `${s.id}:${agentId ?? 'main'}:${kind}:${t}:${n}`, t, kind, agentId, text: clip(text.replace(/\s+/g, ' ').trim(), 240), data };
  const events = [...s.events, ev];
  return { ...s, evSeq: n, events: events.length > EVENT_QUEUE_MAX ? events.slice(-EVENT_QUEUE_MAX) : events, dirty: true };
}

/** Takes the events queued since the last call. */
export function drainEvents(s: SessionState): [SessionState, ActivityEvent[]] {
  return [{ ...s, events: [] }, s.events];
}

function loopOf(s: SessionState, agentId: string | null | undefined): LoopStats | undefined {
  return agentId ? s.agents[agentId] : s.main;
}

function putLoop(s: SessionState, agentId: string | null | undefined, loop: LoopStats): SessionState {
  if (!agentId) return { ...s, main: loop, dirty: true };
  const a = s.agents[agentId];
  if (!a) return s;
  return { ...s, agents: { ...s.agents, [agentId]: { ...a, ...loop } }, dirty: true };
}

function loopLabel(s: SessionState, agentId: string | null | undefined): string {
  if (!agentId) return 'on the orchestrator';
  const a = s.agents[agentId];
  return a ? `in “${a.description}”` : 'in an agent';
}

export function agentLabel(a: Pick<AgentState, 'kind' | 'type' | 'model' | 'effort'>): string {
  return `${a.kind === 'fork' ? 'fork' : a.type} · ${shortName(a.model)}${a.effort ? ` ${a.effort}` : ''}`;
}

/** An agent the engine lists that this state has not seen spawn (a reload, a missed event). */
function placeholderAgent(id: string, now: number, over: Partial<AgentState> = {}): AgentState {
  return {
    ...emptyLoop(),
    id,
    parentId: null,
    kind: 'subagent',
    type: 'general-purpose',
    name: null,
    description: 'agent',
    effortSource: 'unknown',
    status: 'running',
    startedAt: now,
    endedAt: null,
    promptExcerpt: '',
    answerExcerpt: null,
    failure: null,
    toolUseId: null,
    ...over,
  };
}

// ---- identity -----------------------------------------------------------------------------------

export function setIdentity(
  s: SessionState,
  i: { cwd?: string | null; projectRoot?: string | null; repoName?: string | null; model?: string | null; startedAt?: number | null },
): SessionState {
  return {
    ...s,
    cwd: i.cwd ?? s.cwd,
    projectRoot: i.projectRoot === undefined ? s.projectRoot : i.projectRoot,
    repoName: i.repoName === undefined ? s.repoName : i.repoName,
    startedAt: i.startedAt ?? s.startedAt,
    main: i.model ? { ...s.main, model: i.model } : s.main,
    dirty: true,
  };
}

export function setGit(s: SessionState, git: GitInfo | null): SessionState {
  if (JSON.stringify(git) === JSON.stringify(s.git)) return s;
  return { ...s, git, dirty: true };
}

// ---- turns --------------------------------------------------------------------------------------

export function turnStart(s: SessionState): SessionState {
  return withStatus({ ...s, mainIdle: false, waitReason: s.waitReason === 'permission' ? 'permission' : null });
}

export interface StepInput {
  agentId?: string;
  model?: string | null;
  effort?: unknown;
  usage: Usage | null;
  stopReason: string | null;
}

/** One model request finished: model, observed effort, context, tokens, cost, and stop-reason blowouts. */
export function step(s0: SessionState, i: StepInput, now: number): SessionState {
  let s = s0;
  if (i.agentId && !s.agents[i.agentId]) {
    s = { ...s, agents: { ...s.agents, [i.agentId]: placeholderAgent(i.agentId, now, { model: i.model ?? null }) }, order: [...s.order, i.agentId] };
  }
  const loop = loopOf(s, i.agentId);
  if (!loop) return s;
  const u = i.usage;
  const model = u?.model || i.model || loop.model;
  const effort = asEffort(i.effort);
  const next: LoopStats = { ...loop, model: model ?? null, steps: loop.steps + 1, lastStopReason: i.stopReason };
  if (effort) next.effort = effort;
  if (u) {
    const t = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
    next.tokens = { input: loop.tokens.input + t.input, output: loop.tokens.output + t.output, cacheRead: loop.tokens.cacheRead + t.cacheRead, cacheWrite: loop.tokens.cacheWrite + t.cacheWrite };
    next.cost = loop.cost + costOf(t, model);
    next.ctxTokens = t.input + t.cacheRead + t.cacheWrite;
    next.window = windowOf(model);
  }
  s = putLoop(s, i.agentId, next);
  if (i.agentId && effort) {
    const a = s.agents[i.agentId]!;
    if (a.kind !== 'fork') s = { ...s, agents: { ...s.agents, [a.id]: { ...a, effortSource: 'observed' } } };
  }
  if (!i.agentId && effort) s = { ...s, main: { ...s.main, effort } };
  if (i.stopReason === 'model_context_window_exceeded') s = blowout(s, i.agentId ?? null, 'window-exceeded', now, next.ctxTokens, null);
  else if (i.stopReason === 'compaction') s = blowout(s, i.agentId ?? null, 'server-compaction', now, next.ctxTokens, null);
  return s;
}

/**
 * Counts a blowout on a loop. A second signal for the same loop within 2 s (a window-exceeded stop
 * followed by the auto-compaction it triggers) is the same blowout and only adds detail.
 */
export function blowout(s: SessionState, agentId: string | null, kind: string, now: number, tokensBefore: number | null, tokensAfter: number | null): SessionState {
  const loop = loopOf(s, agentId);
  if (!loop) return s;
  const last = loop.blowTimes[loop.blowTimes.length - 1];
  if (last !== undefined && now - last < BLOWOUT_DEDUP_MS) return s;
  const n = loop.blowouts + 1;
  const ctx = tokensAfter !== null && loop.window ? tokensAfter : loop.ctxTokens;
  let next = putLoop(s, agentId, { ...loop, blowouts: n, blowTimes: [...loop.blowTimes, now].slice(-20), ctxTokens: ctx });
  const after = tokensAfter !== null && loop.window ? `, compacted to ${Math.round((tokensAfter / loop.window) * 100)}%` : '';
  next = addEvent(next, 'blow', agentId, `context window exceeded (blowout #${n}) ${loopLabel(s, agentId)}${after}`, now, {
    kind,
    tokensBefore,
    tokensAfter,
  });
  return next;
}

export interface CompactInput {
  agentId?: string;
  trigger: string;
  tokensBefore?: number;
  tokensAfter?: number;
}

/** A compaction ran: automatic is a blowout; manual or a plugin's is only an event. */
export function compaction(s: SessionState, i: CompactInput, now: number): SessionState {
  if (i.trigger === 'auto') return blowout(s, i.agentId ?? null, 'auto-compact', now, i.tokensBefore ?? null, i.tokensAfter ?? null);
  if (i.trigger === 'manual' || i.trigger === 'plugin') {
    const loop = loopOf(s, i.agentId);
    const next = loop && i.tokensAfter !== undefined ? putLoop(s, i.agentId, { ...loop, ctxTokens: i.tokensAfter }) : s;
    return addEvent(next, 'compact', i.agentId ?? null, `${i.trigger === 'manual' ? 'manual' : 'plugin'} compaction ${loopLabel(s, i.agentId)}`, now, {
      tokensBefore: i.tokensBefore ?? null,
      tokensAfter: i.tokensAfter ?? null,
    });
  }
  return s;
}

export interface CompleteInput {
  agentId?: string;
  reason: EndReason;
  answer?: string;
}

/** A loop's turn ended. Main loop: idle. Agent: done, aborted or failed with a failure record. */
export function turnComplete(s: SessionState, i: CompleteInput, now: number): SessionState {
  if (!i.agentId) {
    let next: SessionState = { ...s, mainIdle: true, waitReason: s.waitReason === 'permission' ? null : s.waitReason, main: { ...s.main, candidate: i.reason === 'answer' ? null : s.main.candidate } };
    const cand = s.main.candidate && now - s.main.candidate.at <= 60_000 ? s.main.candidate : null;
    if (i.reason === 'error' && cand) {
      next = addEvent(next, 'fail', null, `orchestrator turn ended with an error after a failing call: ${cand.call}`, now, { reason: 'error', tool: cand.tool, call: cand.call, exitCode: cand.exitCode });
    } else if (i.reason === 'error') next = addEvent(next, 'fail', null, 'orchestrator turn ended with an API error', now, { reason: 'error' });
    else if (i.reason === 'refusal') next = addEvent(next, 'fail', null, 'orchestrator turn ended with a refusal', now, { reason: 'refusal' });
    return withStatus(next);
  }
  const a = s.agents[i.agentId];
  if (!a || a.status === 'done' || a.status === 'failed' || a.status === 'aborted') {
    // a teammate's later turn, or a duplicate: keep the answer only
    if (a && i.answer) return { ...s, agents: { ...s.agents, [a.id]: { ...a, answerExcerpt: excerpt(i.answer) } }, dirty: true };
    return s;
  }
  const cls = classify({ reason: i.reason, candidate: a.candidate, stopReason: a.lastStopReason, blowouts: a.blowouts, now });
  let next: AgentState;
  if (i.reason === 'answer') {
    next = { ...a, status: a.kind === 'teammate' ? 'running' : 'done', endedAt: a.kind === 'teammate' ? null : now, answerExcerpt: i.answer ? excerpt(i.answer) : a.answerExcerpt, candidate: null, failure: null };
  } else {
    const ev = evidence({ blowoutTimes: a.blowTimes, failedCalls: a.failedCalls, reads: a.reads, denyText: a.candidate?.denied ? a.candidate.denyText : null });
    const fresh = a.candidate && now - a.candidate.at <= 60_000 ? a.candidate : null;
    const failure = buildFailure(cls ?? 'Unknown', fresh, ev, now, cls === 'Model API error' || cls === 'Context window exhausted' ? { tool: 'model request', call: a.model ? `model request (${a.model}${a.effort ? `, effort ${a.effort}` : ''})` : 'model request' } : {});
    next = { ...a, status: i.reason === 'aborted' ? 'aborted' : 'failed', endedAt: now, failure, answerExcerpt: i.answer ? excerpt(i.answer) : a.answerExcerpt };
  }
  let out: SessionState = { ...s, agents: { ...s.agents, [a.id]: next } };
  if (next.status === 'done') out = addEvent(out, 'done', a.id, `finished: ${a.description}`, now);
  else if (next.status === 'failed') out = addEvent(out, 'fail', a.id, `failed: ${a.description} (${next.failure?.class ?? 'Unknown'})`, now, { class: next.failure?.class ?? 'Unknown' });
  else if (next.status === 'aborted') out = addEvent(out, 'note', a.id, `aborted: ${a.description}`, now);
  return withStatus(out);
}

// ---- agents -------------------------------------------------------------------------------------

/** The model's Agent tool call, before the agent starts: requested effort and model, by tool_use_id. */
export function agentRequested(s: SessionState, toolUseId: string, input: Record<string, unknown>, now: number): SessionState {
  const p: PendingSpawn = {
    effort: asEffort(input.effort),
    model: str(input.model),
    subagentType: str(input.subagent_type),
    description: str(input.description),
    name: str(input.name),
    at: now,
  };
  // The spawn may have come first (either order is tolerated): merge into that agent.
  const existing = Object.values(s.agents).find((a) => a.toolUseId === toolUseId);
  if (existing) {
    if (existing.kind === 'fork' || !p.effort || existing.effortSource === 'observed') return s;
    return { ...s, agents: { ...s.agents, [existing.id]: { ...existing, effort: p.effort, effortSource: 'requested' } }, dirty: true };
  }
  return { ...s, pending: { ...s.pending, [toolUseId]: p } };
}

export interface SpawnInput {
  toolUseId: string;
  agentId: string;
  model: string | null;
  subagentType: string;
  description: string;
  prompt: string;
  parentAgentId?: string;
  fork: boolean;
  isTeammate?: boolean;
  name?: string;
}

/** An agent started. Effort: requested at the Agent call; a fork inherits its parent's. */
export function agentSpawned(s: SessionState, i: SpawnInput, now: number): SessionState {
  const pending = s.pending[i.toolUseId];
  const parent = i.parentAgentId ? s.agents[i.parentAgentId] : undefined;
  const parentLoop: LoopStats = parent ?? s.main;
  const kind: AgentState['kind'] = i.fork ? 'fork' : i.isTeammate ? 'teammate' : 'subagent';
  const model = i.fork ? parentLoop.model ?? i.model : i.model ?? pending?.model ?? null;
  let effort: Effort | null = null;
  let effortSource: AgentState['effortSource'] = 'unknown';
  if (i.fork) {
    effort = parentLoop.effort;
    effortSource = 'inherited';
  } else if (pending?.effort) {
    effort = pending.effort;
    effortSource = 'requested';
  }
  const prev = s.agents[i.agentId];
  const a: AgentState = {
    ...(prev ?? placeholderAgent(i.agentId, now)),
    parentId: i.parentAgentId ?? null,
    kind,
    type: i.fork ? 'fork' : i.subagentType || pending?.subagentType || 'general-purpose',
    name: i.name ?? pending?.name ?? null,
    description: clip(i.description || pending?.description || 'agent', 240),
    model,
    effort: prev?.effortSource === 'observed' && !i.fork ? prev.effort : effort,
    effortSource: prev?.effortSource === 'observed' && !i.fork ? 'observed' : effortSource,
    status: 'running',
    startedAt: prev?.startedAt ?? now,
    promptExcerpt: excerpt(i.prompt),
    toolUseId: i.toolUseId,
    window: windowOf(model),
  };
  const { [i.toolUseId]: _used, ...rest } = s.pending;
  let out: SessionState = { ...s, agents: { ...s.agents, [a.id]: a }, order: prev ? s.order : [...s.order, a.id], pending: rest };
  const desc = i.fork ? `fork (inherits ${shortName(a.model)}${a.effort ? ` ${a.effort}` : ''})` : `${a.type} (${shortName(a.model)}${a.effort ? ` ${a.effort}` : ''})`;
  out = addEvent(out, 'spawn', a.id, `${i.fork ? 'forked' : 'spawned'} ${desc}: ${a.description}`, now, { kind });
  // Match plan steps while the agent runs, so a step keeps its owner after the agent finishes.
  return withStatus(resolveOwners(out));
}

/** The engine's list of agents: the authority for which exist and how each stands (SPEC 5.4). */
export interface ListedAgent {
  id: string;
  description: string;
  type: string;
  status: string;
  parentId?: string;
  name?: string;
}

export function reconcile(s: SessionState, list: readonly ListedAgent[], now: number): SessionState {
  let agents = s.agents;
  let order = s.order;
  let changed = false;
  for (const l of list) {
    const a = agents[l.id];
    const status: AgentStatus | null =
      l.status === 'completed' ? 'done' : l.status === 'failed' ? 'failed' : l.status === 'killed' ? 'aborted' : l.status === 'pending' ? 'queued' : 'running';
    if (!a) {
      agents = {
        ...agents,
        [l.id]: placeholderAgent(l.id, now, {
          description: clip(l.description || 'agent', 240),
          type: l.type === 'fork' ? 'fork' : l.type || 'general-purpose',
          kind: l.type === 'fork' ? 'fork' : l.type === 'teammate' ? 'teammate' : 'subagent',
          parentId: l.parentId ?? null,
          name: l.name ?? null,
          status: status ?? 'running',
          endedAt: status === 'done' || status === 'failed' || status === 'aborted' ? now : null,
        }),
      };
      order = [...order, l.id];
      changed = true;
      continue;
    }
    // Only move forward: a finished agent never becomes running again from the list.
    const final = a.status === 'done' || a.status === 'failed' || a.status === 'aborted';
    if (!final && status && status !== a.status && status !== 'running') {
      const failure = status === 'failed' && !a.failure ? buildFailure('Unknown', a.candidate, evidence({ blowoutTimes: a.blowTimes, failedCalls: a.failedCalls, reads: a.reads, denyText: null }), now) : a.failure;
      agents = { ...agents, [l.id]: { ...a, status, endedAt: status === 'queued' ? null : a.endedAt ?? now, failure } };
      changed = true;
    } else if (!final && a.status === 'queued' && status === 'running') {
      agents = { ...agents, [l.id]: { ...a, status: 'running' } };
      changed = true;
    }
  }
  return changed ? withStatus({ ...s, agents, order }) : s;
}

// ---- tools --------------------------------------------------------------------------------------

/** A tool call is about to run in a loop: its last tool, and the end of any permission wait there. */
export function toolStarted(s: SessionState, agentId: string | undefined, tool: string): SessionState {
  const loop = loopOf(s, agentId);
  if (!loop) return s;
  let next = putLoop(s, agentId, { ...loop, lastTool: clip(tool, 120) });
  if (next.waitReason === 'permission' && !agentId) next = withStatus({ ...next, waitReason: null, waitNote: null });
  return next;
}

export interface ToolResultInput {
  agentId?: string;
  tool: string;
  input: Record<string, unknown>;
  result: { deny?: string; isError?: boolean; text?: string; result?: unknown };
}

/** A tool call finished: counts, failure candidates, skills and the plan. */
export function toolResult(s0: SessionState, i: ToolResultInput, now: number): SessionState {
  let s = s0;
  const loop = loopOf(s, i.agentId);
  if (loop) {
    const next: LoopStats = { ...loop, toolCalls: loop.toolCalls + 1, lastTool: clip(i.tool, 120) };
    if (i.tool === 'Read' && typeof i.input.file_path === 'string') {
      const f = clip(i.input.file_path, 200);
      next.reads = { ...loop.reads, [f]: (loop.reads[f] ?? 0) + 1 };
    }
    const cand = candidateFrom(i.tool, i.input, i.result, now);
    if (cand) {
      next.candidate = cand;
      next.failedCalls = { ...loop.failedCalls, [cand.call]: (loop.failedCalls[cand.call] ?? 0) + 1 };
    }
    s = putLoop(s, i.agentId, next);
  }
  if (s.waitReason === 'permission' && !i.agentId) s = withStatus({ ...s, waitReason: null, waitNote: null });
  const ok = typeof i.result.deny !== 'string' && i.result.isError !== true;
  if (!ok) return s;
  if (i.tool === 'Skill' && typeof i.input.skill === 'string') s = skillLoaded(s, i.agentId, i.input.skill, now);
  else if (i.tool === 'TaskCreate') s = withPlan(s, taskCreate(s.plan, i.input, i.result), now);
  else if (i.tool === 'TaskUpdate') s = withPlan(s, taskUpdate(s.plan, i.input, i.result), now);
  else if (i.tool === 'TodoWrite' && !i.agentId) s = withPlan(s, todoWrite(s.plan, i.input), now);
  else if (i.tool === PLAN_TOOL) s = withPlan(s, setTitle(s.plan, i.input), now);
  return s;
}

function withPlan(s: SessionState, plan: PlanState, now: number): SessionState {
  if (plan === s.plan) return s;
  let out: SessionState = resolveOwners({ ...s, plan, dirty: true });
  const before = new Map(s.plan.tasks.map((t) => [t.id, t.status]));
  for (const t of plan.tasks) {
    const was = before.get(t.id);
    if (t.status === 'in_progress' && was !== 'in_progress') out = addEvent(out, 'plan', null, `step started: ${t.text}`, now);
  }
  if (plan.tasks.length && plan.tasks.every((t) => t.status === 'completed') && s.plan.tasks.some((t) => t.status !== 'completed')) {
    out = addEvent(out, 'plan', null, `plan complete: ${plan.toolTitle ?? plan.metaTitle ?? `${plan.tasks.length} steps`}`, now);
  }
  if (!s.plan.tasks.length && plan.tasks.length) out = addEvent(out, 'plan', null, `plan started (${plan.source ?? 'tasks'})`, now);
  return out;
}

/** A skill was loaded into a loop (the Skill tool, or skill.prompt for the main loop). */
export function skillLoaded(s: SessionState, agentId: string | undefined, skill: string, now: number): SessionState {
  const loop = loopOf(s, agentId);
  if (!loop || loop.skills.includes(skill)) return s;
  const next = putLoop(s, agentId, { ...loop, skills: [...loop.skills, clip(skill, 120)].slice(-50) });
  const where = agentId ? (s.agents[agentId]?.kind === 'fork' ? 'fork' : s.agents[agentId]?.type ?? 'agent') : 'orchestrator';
  return addEvent(next, 'skill', agentId ?? null, `${skill} loaded into ${where}`, now, { skill });
}

/** The engine raised a permission dialog. */
export function permissionRequest(s: SessionState, toolName: string, toolInput: unknown, now: number): SessionState {
  let short = '';
  if (toolInput && typeof toolInput === 'object') {
    const v = (toolInput as Record<string, unknown>).command ?? (toolInput as Record<string, unknown>).file_path ?? Object.values(toolInput as Record<string, unknown>)[0];
    short = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v);
  }
  const note = clip(`${toolName}(${short.replace(/\s+/g, ' ').trim()})`, 160);
  const next = withStatus({ ...s, waitReason: 'permission', waitNote: note });
  return addEvent(next, 'wait', null, `waiting on you: ${note}`, now);
}

/** A notification: a permission prompt or idle-for-input is a fallback signal for waiting. */
export function notification(s: SessionState, type: string, message: string, now: number): SessionState {
  if (/permission/i.test(type) && s.waitReason !== 'permission') {
    const next = withStatus({ ...s, waitReason: 'permission', waitNote: clip(message.replace(/\s+/g, ' ').trim(), 160) || null });
    return addEvent(next, 'wait', null, `waiting on you: ${next.waitNote ?? 'permission'}`, now);
  }
  if (/idle/i.test(type)) return withStatus({ ...s, mainIdle: true });
  return s;
}

// ---- usage, end ---------------------------------------------------------------------------------

export interface MeasureInput {
  context?: { tokens?: number; window?: number; percent?: number } | null;
  cost?: { usd: number } | null;
  rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[] | null;
  startedAt?: number;
}

/** The status line's figures: main-loop context, the session's real cost, rate limits. */
export function measure(s: SessionState, i: MeasureInput): SessionState {
  const c = i.context;
  const context = c
    ? {
        tokens: typeof c.tokens === 'number' ? c.tokens : s.context.tokens,
        window: typeof c.window === 'number' ? c.window : s.context.window,
        percent: typeof c.percent === 'number' ? c.percent : s.context.percent,
      }
    : s.context;
  const rateLimits = Array.isArray(i.rateLimits)
    ? i.rateLimits.slice(0, 10).map((r) => ({ kind: clip(String(r.kind), 120), percentUsed: Number(r.percentUsed) || 0, resetsAt: r.resetsAt ?? null }))
    : s.rateLimits;
  const costUsd = i.cost && typeof i.cost.usd === 'number' ? i.cost.usd : s.costUsd;
  const startedAt = typeof i.startedAt === 'number' && i.startedAt > 0 ? i.startedAt : s.startedAt;
  const same = JSON.stringify([context, rateLimits, costUsd, startedAt]) === JSON.stringify([s.context, s.rateLimits, s.costUsd, s.startedAt]);
  return same ? s : { ...s, context, rateLimits, costUsd, startedAt, dirty: true };
}

/** The session ended: final status, and every open agent aborted. */
export function sessionEnd(s: SessionState, reason: string, resumeId: string | null, now: number): SessionState {
  if (s.ended) return s;
  const agents: Record<string, AgentState> = {};
  for (const [id, a] of Object.entries(s.agents)) {
    agents[id] = a.status === 'running' || a.status === 'queued' ? { ...a, status: 'aborted', endedAt: now } : a;
  }
  const next = withStatus({ ...s, agents, ended: true, endReason: clip(reason, 120), resumeId });
  return addEvent(next, 'end', null, `session.end · ${reason}`, now, { reason });
}

/** Plan owners resolved against the current agents (sticky once matched). */
export function resolveOwners(s: SessionState): SessionState {
  const plan = assignOwners(
    s.plan,
    s.order.map((id) => s.agents[id]!).filter(Boolean).map((a) => ({ id: a.id, name: a.name, description: a.description, running: a.status === 'running', label: agentLabel(a) })),
  );
  return plan === s.plan ? s : { ...s, plan };
}
