// Classic settings-hook payloads -> a reduced Report (SPEC 5.10, T5.1), for sessions started without
// the reporter mod. A settings hook `curl`s its stdin here; each payload is one event, so the server
// merges it with what it already stored for that session and ingests the result like any report.
// Hooks carry no per-step usage: context, cost, tokens and the plan stay empty.
import { createHash } from 'node:crypto';
import type { AgentRow, SessionRow } from './db.js';
import { agentView } from './derive.js';
import type { ActivityEvent, AgentReport, Effort, Report, SessionReport } from './protocol.js';

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
  const idle = () => {
    session.status = anyRunning() ? 'running' : 'waiting';
    session.waitReason = session.status === 'waiting' ? 'input' : null;
    session.waitNote = null;
  };

  // A revived session (a hook after SessionEnd) starts over as live.
  if (session.status === 'done' && event !== 'SessionEnd') {
    session.status = 'waiting';
    session.endReason = null;
  }

  switch (event) {
    case 'SessionStart': {
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
      session.status = 'running';
      session.waitReason = null;
      session.waitNote = null;
      break;
    case 'Stop':
      idle();
      break;
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
        agents.set(agentId, { ...a, lastTool: tool ?? a.lastTool, toolCalls: a.toolCalls + (event === 'PreToolUse' ? 0 : 1) });
      } else if (session.waitReason === 'permission') {
        session.waitReason = null;
        session.waitNote = null;
      }
      if (session.status !== 'done') session.status = session.waitReason === 'permission' ? 'waiting' : 'running';
      break;
    }
    case 'SessionEnd': {
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
    blowouts: 0,
    steps: null,
    promptExcerpt: '',
    answerExcerpt: null,
    failure: null,
  };
}
