// Report -> rows, events, blowouts and samples (SPEC 7.3 steps 1-4). One transaction per report.
import type { AgentReport, Report, TokenCounts } from './protocol.js';
import type { AgentRow, EventRow, FleetDb, SessionRow } from './db.js';

export interface IngestResult {
  sessionId: string;
  /** Events this report added (already-stored ids are skipped). */
  newEvents: EventRow[];
  /** The report carried status 'done'. */
  ended: boolean;
  /** The session had ended or been dropped and reports as live again. */
  revived: boolean;
  /** The session was not stored before this report. */
  created: boolean;
  /** sentAt − serverTime, kept for debugging only. */
  clockSkewMs: number;
}

export function tokenSum(t: TokenCounts | { tok_in: number; tok_out: number; tok_cr: number; tok_cw: number }): number {
  if ('input' in t) return t.input + t.output + t.cacheRead + t.cacheWrite;
  return t.tok_in + t.tok_out + t.tok_cr + t.tok_cw;
}

function json(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

function sessionRow(r: Report, prev: SessionRow | undefined, serverTime: number): SessionRow {
  const s = r.session;
  const done = s.status === 'done';
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    wait_reason: s.waitReason,
    wait_note: s.waitNote,
    end_reason: s.endReason,
    resume_id: s.resumeId,
    started_at: s.startedAt,
    last_seen_at: serverTime,
    ended_at: done ? (prev?.status === 'done' && prev.ended_at !== null ? prev.ended_at : serverTime) : null,
    dropped_at: null,
    cwd: s.cwd,
    project_root: s.projectRoot,
    repo_name: s.repoName,
    git_json: json(s.git),
    model: s.model,
    effort: s.effort,
    context_tokens: s.context.tokens,
    context_window: s.context.window,
    context_percent: s.context.percent,
    cost_usd: s.costUsd,
    tok_in: s.tokens.input,
    tok_out: s.tokens.output,
    tok_cr: s.tokens.cacheRead,
    tok_cw: s.tokens.cacheWrite,
    rate_limits_json: json(s.rateLimits),
    blowouts: s.blowouts,
    plan_json: json(s.plan),
    reporter_version: r.reporter.version,
    engine_version: r.reporter.engineVersion,
  };
}

function agentRow(sessionId: string, a: AgentReport): AgentRow {
  return {
    session_id: sessionId,
    id: a.id,
    parent_id: a.parentId,
    kind: a.kind,
    type: a.type,
    name: a.name,
    description: a.description,
    model: a.model,
    effort: a.effort,
    effort_source: a.effortSource,
    status: a.status,
    started_at: a.startedAt,
    ended_at: a.endedAt,
    context_tokens: a.context.tokens,
    context_window: a.context.window,
    context_percent: a.context.percent,
    tok_in: a.tokens.input,
    tok_out: a.tokens.output,
    tok_cr: a.tokens.cacheRead,
    tok_cw: a.tokens.cacheWrite,
    cost_usd_est: a.costUsdEst,
    skills_json: JSON.stringify(a.skills),
    last_tool: a.lastTool,
    tool_calls: a.toolCalls,
    blowouts: a.blowouts,
    steps_done: a.steps ? a.steps.done : null,
    steps_total: a.steps ? a.steps.total : null,
    prompt_excerpt: a.promptExcerpt,
    answer_excerpt: a.answerExcerpt,
    failure_json: json(a.failure),
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** Stores one validated report. `serverTime` (never the reporter's clock) sets last_seen_at. */
export function ingestReport(f: FleetDb, report: Report, serverTime: number): IngestResult {
  return f.tx(() => {
    const sid = report.session.id;
    const prev = f.getSession(sid);
    const row = sessionRow(report, prev, serverTime);
    f.upsertSession(row);
    const ended = report.session.status === 'done';
    const revived = !!prev && !ended && (prev.ended_at !== null || prev.dropped_at !== null);

    // 2. Agents: upsert what was reported; never delete one that is missing (a reload may lose it).
    for (const a of report.agents) f.upsertAgent(agentRow(sid, a));
    if (ended) f.abortOpenAgents(sid, serverTime);

    // 3. Events, idempotent by id. A blow event that is new adds a blowouts row.
    const newEvents: EventRow[] = [];
    for (const e of report.events) {
      const ev: EventRow = {
        id: e.id,
        session_id: sid,
        agent_id: e.agentId,
        t: e.t,
        kind: e.kind,
        text: e.text,
        data_json: json(e.data),
      };
      if (!f.insertEvent(ev)) continue;
      newEvents.push(ev);
      const kind = e.data && typeof e.data.kind === 'string' ? e.data.kind : null;
      if (e.kind === 'blow' && kind) {
        f.insertBlowout({
          session_id: sid,
          agent_id: e.agentId,
          t: e.t,
          kind: kind.slice(0, 40),
          tokens_before: numOrNull(e.data?.tokensBefore),
          tokens_after: numOrNull(e.data?.tokensAfter),
        });
      }
    }

    // 4. Sample for this second: totals over every stored agent, delta against the previous second.
    const agents = f.getAgents(sid);
    const tokensTotal = tokenSum(row) + agents.reduce((n, a) => n + tokenSum(a), 0);
    const second = Math.floor(serverTime / 1000);
    const before = f.sampleBefore(sid, second);
    const running = agents.filter((a) => a.status === 'running');
    const peakPct = Math.max(row.context_percent ?? 0, ...running.map((a) => a.context_percent ?? 0));
    f.upsertSample({
      session_id: sid,
      t: second,
      tokens_total: tokensTotal,
      tokens_delta: before ? Math.max(0, tokensTotal - before.tokens_total) : 0,
      peak_context: Math.max(0, Math.min(1, peakPct / 100)),
      running_agents: ended ? 0 : running.length,
      cost_usd: row.cost_usd,
    });

    return { sessionId: sid, newEvents, ended, revived, created: !prev, clockSkewMs: report.sentAt - serverTime };
  });
}
