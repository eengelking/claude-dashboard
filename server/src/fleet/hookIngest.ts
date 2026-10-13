// Classic settings-hook payloads -> a reduced Report (SPEC 5.10, T5.1), for sessions started without
// the reporter mod. A settings hook `curl`s its stdin here; each payload is one event, so the server
// merges it with what it already stored for that session and ingests the result like any report.
// Hooks carry no per-step usage: context, cost, tokens and the plan stay empty.
import { createHash } from 'node:crypto';
import type { AgentRow, SessionRow } from './db.js';
import { agentView } from './derive.js';
import { backgroundSummary, type ActivityEvent, type AgentReport, type BackgroundKind, type BackgroundTask, type BackgroundWait, type Effort, type Report, type SessionReport } from './protocol.js';

export const HOOKS_REPORTER_VERSION = 'hooks';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

type HookResult =
  | { ok: true; report: Report }
  /** The session is reported by the mod, which knows far more than a hook does: the hook is acknowledged and dropped. */
  | { ok: true; ignored: true; sessionId: string }
  | { ok: false; error: string; path: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : null);
const effortOf = (v: unknown): Effort | null => {
  const level = isObj(v) ? v.level : v;
  return typeof level === 'string' && (EFFORTS as readonly string[]).includes(level) ? (level as Effort) : null;
};
const IN_FLIGHT_DONE = /^(completed|complete|done|failed|killed|stopped|cancelled|canceled|error)$/i;
const BACKGROUND_TYPES: Record<string, BackgroundKind> = { shell: 'shell', bash: 'shell', subagent: 'agent', agent: 'agent', monitor: 'monitor', workflow: 'workflow' };

/**
 * The work a Stop hook says is still in flight: its background tasks (finished ones are skipped) and its
 * scheduled wake-ups. A shell's command is never kept; a task with no description is named by the first word
 * of its command at most. The wake time is left null: the hook gives a cron schedule in the machine's local
 * time, and the server may not share its zone.
 */
function backgroundOf(payload: Record<string, unknown>): BackgroundWait | null {
  const tasks: BackgroundTask[] = [];
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
  for (const t of list(payload.background_tasks).slice(0, 20)) {
    const status = str(t.status, 40) ?? 'running';
    if (IN_FLIGHT_DONE.test(status)) continue;
    const type = BACKGROUND_TYPES[(str(t.type, 40) ?? '').toLowerCase()] ?? 'other';
    // The first word that is not an NAME=value assignment, so an inline secret is never kept.
    const word = str(t.command, 400)?.split(/\s+/).find((w) => w !== '' && !w.includes('='))?.split('/').pop() || null;
    tasks.push({ type, description: str(t.description, 120) ?? word ?? type, status });
  }
  for (const c of list(payload.session_crons).slice(0, Math.max(0, 20 - tasks.length))) {
    tasks.push({ type: 'wakeup', description: str(c.prompt, 120) ?? 'scheduled wake-up', status: 'scheduled' });
  }
  return tasks.length ? { tasks, wakeAt: null } : null;
}

const lastSegment = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

function storedSession(row: SessionRow | undefined, id: string, cwd: string, now: number): SessionReport {
  const parse = <T>(t: string | null, d: T): T => {
    try {
      return t ? (JSON.parse(t) as T) : d;
    } catch {
      return d;
    }
  };
  return {
    id,
    name: row?.name ?? lastSegment(cwd),
    status: row?.status ?? 'waiting',
    waitReason: (row?.wait_reason as SessionReport['waitReason']) ?? (row ? null : 'input'),
    waitNote: row?.wait_note ?? null,
    endReason: row?.end_reason ?? null,
    resumeId: row?.resume_id ?? null,
    startedAt: row?.started_at ?? now,
    cwd: row?.cwd ?? cwd,
    projectRoot: row?.project_root ?? null,
    repoName: row?.repo_name ?? null,
    git: parse(row?.git_json ?? null, null),
    model: row?.model ?? null,
    effort: (row?.effort as Effort | null) ?? null,
    context: { tokens: null, window: null, percent: null },
    costUsd: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    rateLimits: [],
    blowouts: 0,
    plan: null,
    loop: null,
    files: parse(row?.files_json ?? null, null),
    attached: row?.attached == null ? null : row.attached === 1,
    background: parse(row?.background_json ?? null, null),
  };
}

function storedAgent(row: AgentRow): AgentReport {
  const { modelFamily: _f, ...a } = agentView(row);
  return a;
}

/** Turns one settings-hook payload into a Report, given what is stored for its session. */
export function hookToReport(payload: unknown, stored: { session?: SessionRow; agents: AgentRow[] }, now: number): HookResult {
  if (!isObj(payload)) return { ok: false, error: 'expected an object', path: '$' };
  const event = str(payload.hook_event_name, 60);
  if (!event) return { ok: false, error: 'missing hook_event_name', path: '$.hook_event_name' };
  const sid = str(payload.session_id);
  if (!sid) return { ok: false, error: 'missing session_id', path: '$.session_id' };
  // A session the mod reports must not be overwritten by a reduced hook view of itself (that would blank
  // its cost, plan and tokens and flip it to the reduced display). The mod's reports are the truth.
  if (stored.session?.reporter_version && stored.session.reporter_version !== HOOKS_REPORTER_VERSION) {
    return { ok: true, ignored: true, sessionId: sid };
  }
  const cwd = str(payload.cwd, 1024) ?? stored.session?.cwd ?? '/';
  const agentId = str(payload.agent_id);
  const agentType = str(payload.agent_type, 120);

  const session = storedSession(stored.session, sid, cwd, now);
  const agents = new Map(stored.agents.map((r) => [r.id, storedAgent(r)]));
  const events: ActivityEvent[] = [];
  // The id depends on the payload, so two different hooks in one millisecond keep both events, and the very
  // same payload sent twice in the same second (a retry) is still one event.
  const digest = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  const ev = (kind: ActivityEvent['kind'], text: string, agent: string | null = null) =>
    events.push({
      id: `${sid}:hook:${event}:${agent ?? 'main'}:${Math.floor(now / 1000)}:${digest}`,
      t: now,
      kind,
      agentId: agent,
      text: text.slice(0, 240),
      data: { source: 'settings-hook' },
    });
  const anyRunning = () => [...agents.values()].some((a) => a.status === 'running');
  const idle = (background: BackgroundWait | null = null) => {
    session.status = anyRunning() ? 'running' : 'waiting';
    // Idle on a background shell or a wake-up is not a wait on the person (#119).
    session.background = session.status === 'waiting' ? background : null;
    session.waitReason = session.status === 'waiting' && !session.background ? 'input' : null;
    session.waitNote = null;
  };

  // A revived session (a hook after SessionEnd) starts over as live.
  if (session.status === 'done' && event !== 'SessionEnd') {
    session.status = 'waiting';
    session.endReason = null;
  }

  switch (event) {
    case 'SessionStart': {
      session.background = null;
      session.name = str(payload.session_title, 80) ?? session.name;
      session.model = str(payload.model, 120) ?? session.model;
      session.effort = effortOf(payload.effort) ?? session.effort;
      session.status = 'waiting';
      session.waitReason = 'input';
      if (!stored.session) session.startedAt = now;
      ev('start', `session.start (settings hooks) · ${str(payload.source, 40) ?? 'startup'}`);
      break;
    }
    case 'UserPromptSubmit':
      session.background = null;
      session.status = 'running';
      session.waitReason = null;
      session.waitNote = null;
      break;
    case 'Stop': {
      const before = session.background ? backgroundSummary(session.background) : null;
      idle(backgroundOf(payload));
      // One row each time what it waits on changes, not one per Stop (as the mod does).
      if (session.background && backgroundSummary(session.background) !== before) ev('wait', `waiting on background: ${backgroundSummary(session.background)}`);
      break;
    }
    case 'SubagentStart': {
      if (!agentId) return { ok: false, error: 'missing agent_id', path: '$.agent_id' };
      const prev = agents.get(agentId);
      const effort = effortOf(payload.effort);
      agents.set(agentId, {
        id: agentId,
        parentId: null,
        kind: 'subagent',
        type: agentType ?? 'agent',
        name: null,
        description: agentType ?? 'agent',
        model: null,
        effort,
        effortSource: effort ? 'observed' : 'unknown',
        status: 'running',
        startedAt: prev?.startedAt ?? now,
        endedAt: null,
        context: { tokens: null, window: null, percent: null },
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        costUsdEst: 0,
        skills: [],
        lastTool: null,
        toolCalls: prev?.toolCalls ?? 0,
        toolCounts: prev ? prev.toolCounts : {},
        blowouts: 0,
        steps: null,
        promptExcerpt: '',
        answerExcerpt: null,
        failure: null,
      });
      session.status = 'running';
      session.waitReason = null;
      ev('spawn', `spawned ${agentType ?? 'agent'} (seen by settings hooks)`, agentId);
      break;
    }
    case 'SubagentStop': {
      if (!agentId) return { ok: false, error: 'missing agent_id', path: '$.agent_id' };
      const a = agents.get(agentId);
      agents.set(agentId, {
        ...(a ?? storedAgentLike(agentId, agentType, now)),
        status: 'done',
        endedAt: now,
      });
      ev('done', `finished: ${a?.description ?? agentType ?? 'agent'}`, agentId);
      // A subagent finishing says nothing about the main loop, which usually carries on: only the Stop hook
      // means the session is idle.
      break;
    }
    case 'Notification': {
      const type = str(payload.notification_type, 60) ?? '';
      const message = str(payload.message, 160);
      // Only notifications that block on the person count as waiting; others (auth_success and the like)
      // are heartbeats.
      const reason: SessionReport['waitReason'] = /permission/i.test(type) ? 'permission' : /idle|elicitation|input/i.test(type) ? 'input' : null;
      if (!reason) break;
      // The idle prompt while background work or a wake-up is in flight is not a wait on the person.
      if (reason === 'input' && session.status === 'waiting' && session.background) break;
      session.status = 'waiting';
      session.waitReason = reason;
      session.waitNote = message;
      ev('wait', `waiting on you: ${message ?? type}`);
      break;
    }
    case 'PermissionRequest': {
      const tool = str(payload.tool_name, 80) ?? 'tool';
      session.status = 'waiting';
      session.waitReason = 'permission';
      session.waitNote = tool;
      ev('wait', `waiting on you: ${tool}`);
      break;
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const tool = str(payload.tool_name, 120);
      if (agentId) {
        const a = agents.get(agentId) ?? storedAgentLike(agentId, agentType, now);
        const finished = event !== 'PreToolUse';
        const toolCounts = finished && tool && a.toolCounts ? { ...a.toolCounts, [tool]: (Object.hasOwn(a.toolCounts, tool) ? a.toolCounts[tool]! : 0) + 1 } : a.toolCounts;
        agents.set(agentId, { ...a, lastTool: tool ?? a.lastTool, toolCalls: a.toolCalls + (finished ? 1 : 0), toolCounts });
      } else if (session.waitReason === 'permission') {
        session.waitReason = null;
        session.waitNote = null;
      }
      if (session.status !== 'done') session.status = session.waitReason === 'permission' ? 'waiting' : 'running';
      if (session.status === 'running') session.background = null;
      break;
    }
    case 'SessionEnd': {
      session.background = null;
      session.status = 'done';
      session.waitReason = null;
      session.waitNote = null;
      session.endReason = str(payload.reason, 120) ?? 'other';
      session.resumeId = sid;
      ev('end', `session.end · ${session.endReason}`);
      break;
    }
    default:
      // Any other hook is a heartbeat.
      break;
  }

  return {
    ok: true,
    report: {
      v: 1,
      sentAt: now,
      reporter: { name: 'podium-reporter', version: HOOKS_REPORTER_VERSION, engineVersion: null, hostSurface: 'settings-hooks' },
      session,
      agents: [...agents.values()].slice(-200),
      events,
    },
  };
}

function storedAgentLike(id: string, type: string | null, now: number): AgentReport {
  return {
    id,
    parentId: null,
    kind: 'subagent',
    type: type ?? 'agent',
    name: null,
    description: type ?? 'agent',
    model: null,
    effort: null,
    effortSource: 'unknown',
    status: 'running',
    startedAt: now,
    endedAt: null,
    context: { tokens: null, window: null, percent: null },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsdEst: 0,
    skills: [],
    lastTool: null,
    toolCalls: 0,
    toolCounts: {},
    blowouts: 0,
    steps: null,
    promptExcerpt: '',
    answerExcerpt: null,
    failure: null,
  };
}
