// SessionState -> Report (SPEC 6.2). Pure. Every free-text field passes through redaction and is cut
// to its limit here, so nothing leaves the machine unredacted.
import { clip, excerpt, LIMITS } from './failures.ts';
import { lastSegment } from './git.ts';
import { family, windowOf } from './models.ts';
import { toPlan } from './plan.ts';
import type { ActivityEntry, ActivityEvent, AgentReport, Failure, LoopReport, MachineInfo, ModelUsage, Report } from './protocol.ts';
import { mergeUsage, resolveOwners, type AgentState, type LoopStats, type SessionState } from './state.ts';

export const REPORTER_NAME = 'podium-reporter';
export const MAX_EVENTS_PER_REPORT = 100;
export const MAX_AGENTS_PER_REPORT = 200;
/** Full prompt and answer characters in one report; the server accepts a 512 kB body. The rest goes in later reports. */
export const MAX_FULL_TEXT_PER_REPORT = 120_000;
/** Activity-feed characters in one report (#118), as the server takes them: the orchestrator's first, then the agents'. */
export const MAX_ACTIVITY_PER_REPORT = 60_000;

export interface ReportMeta {
  version: string;
  engineVersion: string | null;
  hostSurface: string | null;
  now: number;
  /** Set with `/podium name`, kept in $.store per session id. */
  storedName: string | null;
  /** The `sessionName` option. */
  optionName: string | null;
  /** The `userName` option: the person this reporter is configured as. The server checks it against the token. */
  userName?: string | null;
  /** This machine; sent only together with a userName. */
  machine?: MachineInfo | null;
  /** The `fullPrompts` option: send each agent's whole prompt and answer, once. */
  fullText?: boolean;
  /** The `activityFeed` option: send the feed of each loop the server says is watched (#118). */
  activity?: boolean;
}

/** Display name (SPEC 6.6): /podium name, the option, a worktree's branch or folder, the repo folder, the id. */
export function displayName(s: Pick<SessionState, 'id' | 'git' | 'projectRoot' | 'cwd'>, storedName: string | null, optionName: string | null): string {
  const pick = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const name =
    pick(storedName) ??
    pick(optionName) ??
    (s.git?.isWorktree ? pick(s.git.branch && !s.git.detached ? lastSegment(s.git.branch) : null) ?? pick(s.git.worktreePath ? lastSegment(s.git.worktreePath) : null) : null) ??
    pick(s.projectRoot ? lastSegment(s.projectRoot) : null) ??
    `session-${s.id.slice(0, 6)}`;
  return clip(name, 80);
}

/** `owner/name` from an origin URL (`git@github.com:o/n.git`, `https://host/o/n`). */
export function repoFromRemote(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function cleanFailure(f: Failure | null): Failure | null {
  if (!f) return null;
  return {
    ...f,
    tool: f.tool ? clip(f.tool, 120) : null,
    call: f.call ? clip(f.call, 300) : null,
    outputTail: f.outputTail.slice(-12).map((l) => clip(l, 240)),
    evidence: f.evidence.slice(0, 5).map((l) => clip(l, 240)),
    explanation: f.explanation ? clip(f.explanation, 400) : null,
  };
}

function pct(tokens: number | null, window: number | null): number | null {
  if (tokens === null || !window) return null;
  return Math.round(Math.min(100, (tokens / window) * 100) * 10) / 10;
}

/** The fields an agent entry and the main loop's block share: skills, last tool, call counts and steps. */
function loopFields(l: LoopStats): LoopReport {
  return {
    skills: l.skills.slice(0, 50).map((k) => clip(k, 120)),
    lastTool: l.lastTool,
    toolCalls: l.toolCalls,
    toolCounts: Object.fromEntries(Object.entries(l.toolCounts).map(([k, n]) => [clip(k, 120), n])),
    steps: { done: l.steps, total: null },
  };
}

/** The rows the server accepts: model ids clipped, and no more than it takes. */
function usageRows(rows: ModelUsage[]): ModelUsage[] {
  return rows.slice(0, 40).map((r) => ({ ...r, model: clip(r.model, 120) }));
}

/** A loop's feed as it is sent: every entry redacted and cut again here, like every other free-text field. */
function feed(list: readonly ActivityEntry[]): ActivityEntry[] {
  return list.map((e) => ({ at: e.at, kind: e.kind, text: clip(e.text, LIMITS.activity) }));
}

export function agentReport(a: AgentState, fullText = false, activity = false): AgentReport {
  const window = a.window ?? (a.model ? windowOf(a.model) : null);
  return {
    id: clip(a.id, 200),
    parentId: a.parentId,
    kind: a.kind,
    type: clip(a.type, 120),
    name: a.name ? clip(a.name, 80) : null,
    description: clip(a.description, 240),
    model: a.model,
    effort: a.effort,
    effortSource: a.effortSource,
    status: a.status,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    context: { tokens: a.ctxTokens, window, percent: pct(a.ctxTokens, window) },
    tokens: { ...a.tokens },
    costUsdEst: a.model && family(a.model) === 'other' ? null : Math.round(a.cost * 1e6) / 1e6,
    usageByModel: usageRows(mergeUsage(a.usage)),
    ...loopFields(a),
    blowouts: a.blowouts,
    promptExcerpt: excerpt(a.promptExcerpt),
    answerExcerpt: a.answerExcerpt ? excerpt(a.answerExcerpt) : null,
    ...(fullText && a.promptText && !a.promptSent ? { promptText: a.promptText } : {}),
    ...(fullText && a.answerText && !a.answerSent ? { answerText: a.answerText } : {}),
    ...(activity && a.activity.length ? { activity: feed(a.activity) } : {}),
    failure: cleanFailure(a.failure),
  };
}

/** Drops full texts past the per-report budget (oldest agents first kept); they are still unsent, so a later report carries them. */
function withinTextBudget(reports: AgentReport[]): AgentReport[] {
  let left = MAX_FULL_TEXT_PER_REPORT;
  return reports.map((r) => {
    const { promptText, answerText, ...rest } = r;
    const out: AgentReport = rest;
    for (const [k, v] of [['promptText', promptText], ['answerText', answerText]] as const) {
      if (v === undefined) continue;
      if (v.length <= left || left === MAX_FULL_TEXT_PER_REPORT) {
        out[k] = v;
        left -= v.length;
      }
    }
    return out;
  });
}

/** Leaves out the feeds past the per-report budget, the orchestrator's first, then the agents' in order, as the server would. */
function withinActivityBudget(r: Report): Report {
  let left = MAX_ACTIVITY_PER_REPORT;
  const fits = (list: ActivityEntry[]) => {
    const n = list.reduce((sum, e) => sum + e.text.length, 0);
    if (n > left) return false;
    left -= n;
    return true;
  };
  if (r.session.activity && !fits(r.session.activity)) delete r.session.activity;
  for (const a of r.agents) if (a.activity && !fits(a.activity)) delete a.activity;
  return r;
}

/** A full snapshot of the session plus the events given (at most 100). */
export function buildReport(s0: SessionState, events: readonly ActivityEvent[], meta: ReportMeta): Report {
  const s = resolveOwners(s0);
  const ctxWindow = s.context.window ?? s.main.window ?? (s.main.model ? windowOf(s.main.model) : null);
  const ctxTokens = s.context.tokens ?? s.main.ctxTokens;
  const ctxPercent = s.context.percent ?? pct(ctxTokens, ctxWindow);
  // Most recent agents win if a session ever has more than the server accepts.
  const agents = s.order.map((id) => s.agents[id]).filter((a): a is AgentState => !!a).slice(-MAX_AGENTS_PER_REPORT);
  const activity = meta.activity === true;
  return withinActivityBudget({
    v: 1,
    sentAt: meta.now,
    reporter: { name: REPORTER_NAME, version: meta.version, engineVersion: meta.engineVersion, hostSurface: meta.hostSurface },
    ...(meta.userName && meta.userName.trim() ? { userName: clip(meta.userName.trim(), 80), ...(meta.machine ? { machine: { ...meta.machine } } : {}) } : {}),
    session: {
      id: s.id,
      name: displayName(s, meta.storedName, meta.optionName),
      status: s.status,
      waitReason: s.status === 'waiting' ? s.waitReason : null,
      waitNote: s.status === 'waiting' && s.waitNote ? clip(s.waitNote, 160) : null,
      endReason: s.status === 'done' ? s.endReason : null,
      resumeId: s.resumeId,
      startedAt: s.startedAt,
      cwd: s.cwd,
      projectRoot: s.projectRoot,
      repoName: s.repoName,
      git: s.git,
      model: s.main.model,
      effort: s.main.effort,
      context: { tokens: ctxTokens, window: ctxWindow, percent: ctxPercent === null ? null : Math.max(0, Math.min(100, ctxPercent)) },
      costUsd: s.main.model && family(s.main.model) === 'other' ? null : s.costUsd,
      tokens: { ...s.main.tokens },
      usageByModel: usageRows(mergeUsage(s.main.usage, ...s.order.map((id) => s.agents[id]?.usage))),
      rateLimits: s.rateLimits.slice(0, 10),
      blowouts: s.main.blowouts,
      plan: toPlan(s.plan),
      loop: loopFields(s.main),
      attached: s.attached,
      ...(s.status === 'waiting' && s.background ? { background: s.background } : {}),
      files: { ...s.files, files: s.files.files.map((f) => ({ ...f, path: clip(f.path, 300), from: f.from === null ? null : clip(f.from, 300) })) },
      activityFeed: activity,
      ...(activity && s.main.activity.length ? { activity: feed(s.main.activity) } : {}),
    },
    agents: withinTextBudget(agents.map((a) => agentReport(a, meta.fullText === true, activity))),
    events: events.slice(0, MAX_EVENTS_PER_REPORT).map((e) => ({ ...e, text: clip(e.text, 240) })),
  });
}
