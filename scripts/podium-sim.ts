#!/usr/bin/env -S npx tsx
// Podium simulator: feeds the server realistic reports so the UI can be built and demoed with no
// Claude sessions running. Ported from the simulation in mockup/podium.html. Run with --help.
//
// Every random choice comes from a seeded generator, so one seed always produces the same sequence
// of reports (timestamps aside). The Simulator class is pure apart from its injected clock; main()
// does the HTTP.
import os from 'node:os';
import type { ActivityEvent, AgentReport, Effort, Failure, LoopReport, Plan, Report } from '../server/src/fleet/protocol.ts';
import { costOf, shortName, windowOf, type Family } from '../mod/podium-reporter/hooks/models.ts';

const HELP = `podium-sim: POST simulated Claude Code session reports to a Podium server.

Usage: npm run podium:sim -- [options]
       npx tsx scripts/podium-sim.ts [options]

Options:
  --url URL         Server base URL (default http://127.0.0.1:4317)
  --sessions N      Sessions kept running at once (default 5, max 50)
  --speed X         Simulated seconds per real second (default 1)
  --seed N          Random seed; the same seed gives the same reports (default 1)
  --duration S      Stop after S real seconds and exit 0 (default: run until Ctrl-C)
  --chaos           Also make sessions go silent (stale), fail more and blow out more
  --agents N        Extra ad-hoc agents per session at start, for load tests (default 0)
  --reporter-version V  Version the reports claim (default 0.1.0-sim, which the server cannot read, so no warning); try 0.1.0 or 0.9.0 to see a mismatch
  --token T         Send X-Podium-Token: T
  --print           Print each report as one JSON line instead of POSTing (no server needed)
  --ticks N         With --print: stop after N ticks
  -h, --help        Show this help

On exit (duration reached, Ctrl-C or SIGTERM) every session it started is reported once more with
status "done", so nothing is left running in the dashboard.`;

// ------------------------------------------------------------------------------------------------
// Seeded randomness
// ------------------------------------------------------------------------------------------------

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }
  /** mulberry32 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(0, a.length - 1)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  hex(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
}

// ------------------------------------------------------------------------------------------------
// Scenario data (from the mockup)
// ------------------------------------------------------------------------------------------------

const MODEL_ID: Record<Exclude<Family, 'other'>, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  // The simulator runs its haiku agents on a 200K window (Haiku 4.5) so blowouts happen often.
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
};

interface StepSpec {
  d: string;
  kind: 'subagent' | 'fork';
  type: string;
  fam: Exclude<Family, 'other'>;
  effort: Effort;
  skills: string[];
  under?: number;
}

const S = (d: string, kind: 'sub' | 'fork', type: string, fam: string, effort: string, skills: string[] = [], under?: number): StepSpec => ({
  d,
  kind: kind === 'fork' ? 'fork' : 'subagent',
  type: kind === 'fork' ? 'fork' : type,
  fam: (fam || 'opus') as StepSpec['fam'],
  effort: (effort || 'high') as Effort,
  skills,
  under,
});

interface Template {
  name: string;
  project: string;
  branch: string;
  worktree: boolean;
  ahead: number;
  behind: number;
  dirty: number;
  fam: Exclude<Family, 'other'>;
  effort: Effort;
  plan: string | null;
  steps: StepSpec[];
  done?: number;
  waitNote?: string;
  ageSec?: number;
}

const TEMPLATES: Template[] = [
  { name: 'api-refactor', project: 'billing-service', branch: 'refactor/invoice-v2', worktree: true, ahead: 7, behind: 0, dirty: 3, fam: 'opus', effort: 'xhigh', plan: 'Migrate invoices to v2 schema', done: 5, ageSec: 2740, steps: [
    S('Map invoice call sites', 'sub', 'Explore', 'haiku', 'low', ['repo-map']), S('Draft v2 schema', 'fork', '', '', ''), S('Write migration script', 'sub', 'general-purpose', 'sonnet', 'high'),
    S('Backfill dry run', 'sub', 'general-purpose', 'sonnet', 'medium'), S('Update serializers', 'sub', 'general-purpose', 'sonnet', 'medium'), S('Update webhook payloads', 'sub', 'general-purpose', 'sonnet', 'medium'),
    S('Port invoice endpoints', 'fork', '', '', '', ['code-review']), S('Rewrite PDF renderer', 'sub', 'general-purpose', 'opus', 'high', ['frontend-design']),
    S('Add contract tests for PDF fonts', 'sub', 'general-purpose', 'haiku', 'low', [], 7), S('Review the full diff', 'sub', 'code-review', 'opus', 'xhigh', ['code-review']),
    S('Run staging backfill', 'sub', 'general-purpose', 'sonnet', 'medium'), S('Write rollout notes', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'ledger-export', project: 'customer-facing-billing-and-invoicing-platform-monorepo', branch: 'feat/invoice-reconciliation-and-ledger-export-pipeline-v2', worktree: true, ahead: 3, behind: 1, dirty: 6, fam: 'sonnet', effort: 'high', plan: 'Export reconciled ledger rows', done: 1, ageSec: 640, steps: [
    S('Map ledger columns', 'sub', 'Explore', 'haiku', 'low'), S('Write the export job', 'sub', 'general-purpose', 'sonnet', 'medium')] },
  { name: 'dashboard-mods', project: 'podium', branch: 'main', worktree: false, ahead: 2, behind: 0, dirty: 5, fam: 'sonnet', effort: 'high', plan: 'Fleet console mockup', done: 2, ageSec: 905, steps: [
    S('Research mod API', 'sub', 'Explore', 'haiku', 'low', ['plugin-authoring']), S('Study savvy-progress source', 'sub', 'general-purpose', 'sonnet', 'medium'),
    S('Build clickable mockup', 'fork', '', '', '', ['frontend-design', 'dataviz']), S('Write reporter mod', 'sub', 'general-purpose', 'sonnet', 'high', ['plugin-authoring']), S('Add heartbeat cleanup', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'ci-flakes', project: 'web-platform', branch: 'fix/flaky-e2e', worktree: true, ahead: 1, behind: 3, dirty: 1, fam: 'fable', effort: 'max', plan: 'Stabilize e2e suite', done: 3, ageSec: 1380, waitNote: 'Bash(npm run e2e -- --retries=0)', steps: [
    S('Collect last 200 CI runs', 'sub', 'general-purpose', 'haiku', 'low'), S('Cluster failures by cause', 'fork', '', '', ''), S('Reproduce top 3 flakes', 'sub', 'general-purpose', 'sonnet', 'high'),
    S('Patch race in checkout test', 'sub', 'general-purpose', 'opus', 'high'), S('Rerun suite 20x', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'docs-sweep', project: 'handbook', branch: 'main', worktree: false, ahead: 0, behind: 0, dirty: 12, fam: 'haiku', effort: 'low', plan: null, ageSec: 310, steps: [
    S('Fix broken internal links', 'sub', 'general-purpose', 'haiku', 'low'), S('Normalize heading levels', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'infra-audit', project: 'terraform-live', branch: 'audit/iam', worktree: false, ahead: 0, behind: 1, dirty: 0, fam: 'opus', effort: 'medium', plan: 'Audit IAM roles', done: 4, ageSec: 3320, steps: [
    S('List roles per account', 'sub', 'Explore', 'haiku', 'low'), S('Flag wildcard grants', 'sub', 'general-purpose', 'sonnet', 'medium'), S('Cross-check usage logs', 'sub', 'general-purpose', 'sonnet', 'medium'),
    S('Draft findings', 'fork', '', '', ''), S('Propose least-privilege policies', 'sub', 'general-purpose', 'opus', 'high'), S('Open change requests', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'ios-offline', project: 'mobile-app', branch: 'feat/offline-sync', worktree: true, ahead: 4, behind: 0, dirty: 8, fam: 'opus', effort: 'high', plan: 'Offline sync for notes', done: 1, ageSec: 1810, steps: [
    S('Audit current cache layer', 'sub', 'Explore', 'haiku', 'low', ['repo-map']), S('Design conflict resolution', 'fork', '', '', ''), S('Implement queue persistence', 'sub', 'general-purpose', 'sonnet', 'high'),
    S('Add retry backoff', 'sub', 'general-purpose', 'sonnet', 'medium'), S('Write UI states', 'sub', 'general-purpose', 'sonnet', 'medium', ['frontend-design']), S('End-to-end test on device farm', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'auth-oidc', project: 'auth-gateway', branch: 'feat/oidc-login', worktree: true, ahead: 0, behind: 0, dirty: 0, fam: 'opus', effort: 'high', plan: 'Add OIDC login flow', steps: [
    S('Survey existing session middleware', 'sub', 'Explore', 'haiku', 'low', ['repo-map']), S('Draft token exchange design', 'fork', '', '', ''),
    S('Implement callback handler', 'sub', 'general-purpose', 'sonnet', 'medium', ['security-review']), S('Write integration tests', 'sub', 'general-purpose', 'sonnet', 'medium'),
    S('Security review pass', 'sub', 'code-review', 'opus', 'high', ['security-review']), S('Update runbook', 'sub', 'general-purpose', 'haiku', 'low')] },
  { name: 'perf-profile', project: 'search-api', branch: 'perf/p99-latency', worktree: false, ahead: 0, behind: 0, dirty: 2, fam: 'sonnet', effort: 'medium', plan: 'Cut p99 query latency', steps: [
    S('Capture baseline flame graphs', 'sub', 'general-purpose', 'sonnet', 'low'), S('Rank hot paths', 'fork', '', '', ''),
    S('Prototype index-side fix', 'sub', 'general-purpose', 'opus', 'high'), S('Benchmark before/after', 'sub', 'general-purpose', 'haiku', 'low', ['dataviz'])] },
  { name: 'release-notes', project: 'mobile-app', branch: 'release/4.12', worktree: false, ahead: 0, behind: 0, dirty: 0, fam: 'haiku', effort: 'low', plan: 'Draft 4.12 notes', steps: [
    S('Collect merged PRs', 'sub', 'Explore', 'haiku', 'low'), S('Group by area', 'sub', 'general-purpose', 'haiku', 'low'), S('Write notes', 'sub', 'general-purpose', 'sonnet', 'low')] },
];

interface FailSpec {
  cls: Failure['class'];
  tool: string;
  call: string;
  exit: number | null;
  out: string[];
  evidence: string[];
  cause: string;
}

const FAILS: FailSpec[] = [
  { cls: 'Tool error', tool: 'Bash', call: 'npm test -- invoice.contract.test.ts', exit: 1,
    out: ['FAIL  src/contracts/invoice.contract.test.ts', '  ● invoice v2 › serializes totals', '', '    expect(received).toEqual(expected)', '    - Expected  - 1', '    + Received  + 1', '    -   "total_cents": 12900', '    +   "total": 129.0'],
    evidence: ['same call failed 2 times'], cause: 'The serializer now returns a decimal “total”, but the contract fixture still expects “total_cents”.' },
  { cls: 'Tool error', tool: 'Bash', call: 'npm run backfill:dry -- --env=staging', exit: 1,
    out: ['Error: connect ECONNREFUSED 127.0.0.1:5432', '    at TCPConnectWrap.afterConnect (node:net:1555:16)', 'backfill: could not open a database connection', 'backfill: aborted after 0 of 48,210 rows'],
    evidence: ['same call failed 3 times'], cause: 'No database is running inside this worktree, so every retry fails the same way.' },
  { cls: 'Tool error', tool: 'Edit', call: 'Edit src/render/pdf.ts', exit: null,
    out: ['Error: old_string is not unique in the file (3 matches).', 'The file was modified after it was last read.'],
    evidence: ['src/render/pdf.ts read 4 times'], cause: 'Another agent edited the same file in parallel, so the text this agent read was stale.' },
  { cls: 'Blocked by permission', tool: 'Bash', call: 'rm -rf dist && npm run build', exit: null,
    out: ['PreToolUse hook denied this call:', '  destructive command outside an allow-listed path'],
    evidence: ['permission denied: destructive command outside an allow-listed path'], cause: 'A permission hook refused a destructive cleanup and the agent had no fallback.' },
  { cls: 'Model API error', tool: 'model request', call: 'POST /v1/messages (opus, effort max)', exit: null,
    out: ['529 overloaded_error', 'retried 3 times with backoff (2s, 4s, 8s)'],
    evidence: ['turn ended with reason "error"'], cause: 'The model endpoint was overloaded. This is not a code problem.' },
];

/** The validator accepts at most 200 agents per report; stay under it. */
const MAX_AGENTS = 195;

const TOOLS = ['Read', 'Grep', 'Edit', 'Bash', 'Glob', 'Read', 'Edit'];
/** What an orchestrator's own loop calls: it plans and delegates more than it edits. */
const LOOP_TOOLS = ['Agent', 'Read', 'TaskUpdate', 'Bash', 'Edit', 'Read', 'Agent'];
const LOOP_SKILLS = ['frontend-design', 'code-review', 'git-branching', 'documentation-sync'];

// ------------------------------------------------------------------------------------------------
// Simulation
// ------------------------------------------------------------------------------------------------

interface SimAgent {
  report: AgentReport;
  ctx: number; // 0..1
  stepIndex: number | null;
  progressTotal: number;
}

interface SimStep {
  spec: StepSpec;
  id: string;
  state: 'pending' | 'active' | 'done' | 'blocked';
  agentId: string | null;
}

interface SimSession {
  id: string;
  name: string;
  tpl: Template;
  cwd: string;
  projectRoot: string;
  model: string;
  startedAt: number;
  status: 'running' | 'waiting' | 'done';
  waitNote: string | null;
  waitLeft: number;
  ctx: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  ownCost: number;
  blowouts: number;
  /** The main loop's own steps, tools and skills (Report.session.loop). */
  loop: LoopReport;
  steps: SimStep[] | null;
  agents: SimAgent[];
  events: ActivityEvent[];
  evSeq: number;
  silent: boolean;
  endedAt: number | null;
  doneSent: number;
}

export interface SimOptions {
  sessions: number;
  seed: number;
  chaos: boolean;
  /** Extra ad-hoc agents per session, for load tests. */
  extraAgents: number;
  /** The reporter version the reports carry. */
  reporterVersion?: string;
  now: () => number;
  home: string;
}

function splitTokens(rng: Rng, n: number) {
  const output = Math.round(n * rng.range(0.08, 0.18));
  const input = Math.round(n * rng.range(0.03, 0.07));
  const cacheWrite = Math.round(n * rng.range(0.03, 0.08));
  return { input, output, cacheWrite, cacheRead: Math.max(0, n - output - input - cacheWrite) };
}

function add(a: SimSession['tokens'], b: SimSession['tokens']) {
  a.input += b.input;
  a.output += b.output;
  a.cacheRead += b.cacheRead;
  a.cacheWrite += b.cacheWrite;
}

export class Simulator {
  private readonly rng: Rng;
  private readonly sessions: SimSession[] = [];
  private tickN = 0;
  private poolIdx = 0;
  private agentSeq = 1;
  private nameUse = new Map<string, number>();

  constructor(private readonly opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    for (let i = 0; i < opts.sessions; i++) this.startSession(true);
  }

  private now(): number {
    return this.opts.now();
  }

  private ev(s: SimSession, kind: ActivityEvent['kind'], agentId: string | null, text: string, data: Record<string, unknown> | null = null) {
    const t = this.now();
    s.events.push({ id: `${s.id}:${agentId ?? 'main'}:${kind}:${t}:${++s.evSeq}`, t, kind, agentId, text: text.slice(0, 240), data });
    if (s.events.length > 500) s.events.shift();
  }

  private startSession(initial: boolean): SimSession {
    const tpl = TEMPLATES[this.poolIdx++ % TEMPLATES.length]!;
    const uses = (this.nameUse.get(tpl.name) ?? 0) + 1;
    this.nameUse.set(tpl.name, uses);
    const rng = this.rng;
    const id = `${rng.hex(8)}-${rng.hex(4)}-4${rng.hex(3)}-a${rng.hex(3)}-${rng.hex(12)}`;
    const projectRoot = `${this.opts.home}/dev/${tpl.project}`;
    const leaf = tpl.branch.split('/').pop()!;
    const now = this.now();
    const age = initial ? (tpl.ageSec ?? rng.int(5, 120)) : rng.int(1, 5);
    const s: SimSession = {
      id,
      name: (tpl.worktree ? leaf : tpl.name) + (uses > 1 ? `-${uses}` : ''),
      tpl,
      cwd: tpl.worktree ? `${projectRoot}/.claude/worktrees/${leaf}` : projectRoot,
      projectRoot,
      model: MODEL_ID[tpl.fam],
      startedAt: now - age * 1000,
      status: 'running',
      waitNote: null,
      waitLeft: 0,
      ctx: rng.range(0.08, 0.3),
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ownCost: 0,
      blowouts: 0,
      loop: this.seedLoop(initial ? age : 0),
      steps: tpl.plan ? tpl.steps.map((spec, i) => ({ spec, id: String(i + 1), state: 'pending', agentId: null })) : null,
      agents: [],
      events: [],
      evSeq: 0,
      silent: false,
      endedAt: null,
      doneSent: 0,
    };
    const own = splitTokens(rng, rng.int(60_000, 220_000));
    add(s.tokens, own);
    s.ownCost += costOf(own, s.model);
    this.ev(s, 'start', null, `session.start · ${shortName(s.model)} ${tpl.effort}`);
    if (s.steps) {
      const doneN = initial ? (tpl.done ?? 0) : 0;
      for (let i = 0; i < doneN && i < s.steps.length; i++) {
        const a = this.spawn(s, i, 'done');
        a.report.startedAt = now - rng.int(120, 900) * 1000;
        a.report.endedAt = a.report.startedAt + rng.int(40, 300) * 1000;
      }
      this.spawnNext(s);
    } else {
      for (let i = 0; i < tpl.steps.length; i++) this.spawn(s, null, 'running', tpl.steps[i]);
    }
    for (let i = 0; i < this.opts.extraAgents; i++) {
      this.spawn(s, null, 'running', S(`Load agent ${i + 1}`, 'sub', 'general-purpose', rng.pick(['haiku', 'sonnet', 'opus']), 'low'));
    }
    this.sessions.push(s);
    return s;
  }

  private stepOwnerLabel(a: AgentReport): string {
    return `${a.kind === 'fork' ? 'fork' : a.type} · ${shortName(a.model)} ${a.effort ?? ''}`.trim();
  }

  private spawn(s: SimSession, stepIndex: number | null, status: AgentReport['status'], adhoc?: StepSpec): SimAgent {
    const rng = this.rng;
    const spec = stepIndex !== null ? s.steps![stepIndex]!.spec : adhoc!;
    const isFork = spec.kind === 'fork';
    const model = isFork ? s.model : MODEL_ID[spec.fam];
    const effort = isFork ? s.tpl.effort : spec.effort;
    let parentId: string | null = null;
    if (spec.under !== undefined && s.steps) parentId = s.steps[spec.under]?.agentId ?? null;
    const id = `a${(this.agentSeq++).toString(16).padStart(6, '0')}${rng.hex(10)}`;
    const total = rng.int(4, 9);
    const window = windowOf(model);
    const ctx = isFork ? rng.range(0.12, 0.3) : rng.range(0.01, 0.06);
    const report: AgentReport = {
      id,
      parentId,
      kind: isFork ? 'fork' : 'subagent',
      type: isFork ? 'fork' : spec.type,
      name: null,
      description: spec.d,
      model,
      effort,
      effortSource: isFork ? 'inherited' : rng.chance(0.3) ? 'observed' : 'requested',
      status,
      startedAt: this.now(),
      endedAt: null,
      context: { tokens: Math.round(ctx * window), window, percent: Math.round(ctx * 1000) / 10 },
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      costUsdEst: 0,
      skills: [...spec.skills],
      lastTool: rng.pick(TOOLS),
      toolCalls: 0,
      toolCounts: {},
      blowouts: 0,
      steps: { done: 0, total: null },
      promptExcerpt: `${spec.d}. Report findings as a short list and do not edit files outside the working branch.`,
      answerExcerpt: null,
      failure: null,
    };
    const a: SimAgent = { report, ctx, stepIndex, progressTotal: total };
    if (status === 'done') {
      const tok = splitTokens(rng, rng.int(30_000, 260_000));
      report.tokens = tok;
      report.costUsdEst = costOf(tok, model);
      report.steps = { done: total, total: null };
      report.toolCalls = total * 3;
      report.toolCounts = {};
      for (let i = 0; i < report.toolCalls; i++) {
        const tool = rng.pick(TOOLS);
        report.toolCounts[tool] = (report.toolCounts[tool] ?? 0) + 1;
      }
      a.ctx = rng.range(0.2, 0.7);
      report.answerExcerpt = `Done: ${spec.d.toLowerCase()}.`;
      this.syncCtx(a);
    }
    s.agents.push(a);
    if (stepIndex !== null && s.steps) {
      // A step that failed before is taken up by this agent: record the hand-over on the failure.
      for (const prev of s.agents) {
        if (prev !== a && prev.stepIndex === stepIndex && prev.report.failure && prev.report.failure.retriedAs === null) prev.report.failure.retriedAs = id;
      }
      const st = s.steps[stepIndex]!;
      st.agentId = id;
      st.state = status === 'done' ? 'done' : 'active';
    }
    if (status !== 'done') {
      const desc = isFork ? `fork (inherits ${shortName(model)} ${effort})` : `${spec.type} (${shortName(model)} ${effort})`;
      this.ev(s, 'spawn', id, `${isFork ? 'forked' : 'spawned'} ${desc}: ${spec.d}`);
      if (spec.skills.length) this.ev(s, 'skill', id, `${spec.skills.join(', ')} loaded into ${isFork ? 'fork' : spec.type}`, { skills: spec.skills });
    }
    return a;
  }

  private syncCtx(a: SimAgent) {
    const w = a.report.context.window ?? windowOf(a.report.model);
    const c = Math.min(1, a.ctx);
    a.report.context = { tokens: Math.round(c * w), window: w, percent: Math.round(c * 1000) / 10 };
  }

  private spawnNext(s: SimSession) {
    if (!s.steps) return;
    if (s.agents.length >= MAX_AGENTS) {
      this.end(s, 'agent limit reached');
      return;
    }
    const active = s.steps.filter((x) => x.state === 'active').length;
    if (active >= 2) return;
    const i = s.steps.findIndex((x, idx) => x.state === 'pending' && (x.spec.under === undefined || !!s.steps![x.spec.under]?.agentId) && idx >= 0);
    if (i < 0) return;
    this.spawn(s, i, 'running');
    if (s.tpl.plan) this.ev(s, 'plan', null, `step ${i + 1} started`);
  }

  private blowout(s: SimSession, a: SimAgent | null) {
    const rng = this.rng;
    const window = a ? (a.report.context.window ?? windowOf(a.report.model)) : 1_000_000;
    const before = Math.round(window * rng.range(0.99, 1.01));
    const after = Math.round(window * 0.3);
    const n = a ? ++a.report.blowouts : ++s.blowouts;
    if (a) {
      a.ctx = 0.3;
      this.syncCtx(a);
    } else s.ctx = 0.3;
    this.ev(s, 'blow', a ? a.report.id : null, `context window exceeded (blowout #${n})${a ? ` in “${a.report.description}”` : ' on the orchestrator'}, compacted to 30%`, {
      kind: 'auto-compact',
      tokensBefore: before,
      tokensAfter: after,
    });
    if (a && a.report.blowouts >= 3 && a.report.status === 'running') {
      this.finish(s, a, false, {
        cls: 'Context window exhausted', tool: 'model request', call: `POST /v1/messages (context ${(window / 1e6).toFixed(2)}M tokens)`, exit: null,
        out: [`Context window exceeded ${a.report.blowouts} times in this run.`, 'Each compaction dropped file contents; the agent re-read the same files in a loop.'],
        evidence: [`exceeded the window ${a.report.blowouts} times`], cause: 'The task was too large for one window. Split the step into smaller tasks.',
      });
    }
  }

  private finish(s: SimSession, a: SimAgent, ok: boolean, fail?: FailSpec) {
    const r = a.report;
    r.endedAt = this.now();
    const st = a.stepIndex !== null && s.steps ? s.steps[a.stepIndex]! : null;
    if (ok) {
      r.status = 'done';
      r.answerExcerpt = `Done: ${r.description.toLowerCase()}. No blockers.`;
      this.ev(s, 'done', r.id, `finished: ${r.description}`);
      if (st) st.state = 'done';
      return;
    }
    const f = fail ?? this.rng.pick(FAILS);
    r.status = 'failed';
    r.failure = {
      class: f.cls,
      at: this.now(),
      tool: f.tool,
      call: f.call,
      exitCode: f.exit,
      outputTail: f.out.slice(-12),
      evidence: f.evidence.slice(0, 5),
      explanation: this.opts.chaos ? f.cause : null,
      retriedAs: null,
    };
    this.ev(s, 'fail', r.id, `failed: ${r.description} (${f.cls})`, { class: f.cls });
    if (st) {
      st.state = 'pending';
      st.agentId = null;
    }
  }

  /** A loop that has already worked `ageSec` seconds: a few calls per tool, some steps, up to two skills. */
  private seedLoop(ageSec: number): LoopReport {
    const rng = this.rng;
    const toolCounts: Record<string, number> = {};
    const calls = Math.round(ageSec / 20);
    for (let i = 0; i < calls; i++) {
      const t = rng.pick(LOOP_TOOLS);
      toolCounts[t] = (toolCounts[t] ?? 0) + 1;
    }
    const skills = LOOP_SKILLS.filter(() => rng.chance(0.35)).slice(0, 2);
    return { skills, lastTool: calls ? rng.pick(LOOP_TOOLS) : null, toolCalls: calls, toolCounts, steps: { done: calls + rng.int(1, 4), total: null } };
  }

  private tickSession(s: SimSession) {
    const rng = this.rng;
    if (s.status === 'waiting') {
      if (--s.waitLeft <= 0) {
        s.status = 'running';
        s.waitNote = null;
        this.ev(s, 'note', null, 'permission granted, resuming');
      }
      return;
    }
    for (const a of s.agents) {
      if (a.report.status !== 'running') continue;
      const fam = a.report.model ?? '';
      const n = Math.round(rng.int(900, 5200) * (fam.includes('haiku') ? 1.6 : fam.includes('opus') ? 0.7 : 1) * 8);
      const tok = splitTokens(rng, n);
      add(a.report.tokens, tok);
      a.report.costUsdEst += costOf(tok, a.report.model);
      const tool = rng.pick(TOOLS);
      if (rng.chance(0.6)) {
        a.report.toolCalls += 1;
        a.report.toolCounts = { ...a.report.toolCounts, [tool]: (a.report.toolCounts?.[tool] ?? 0) + 1 };
      }
      a.report.lastTool = tool;
      a.ctx += (n / (a.report.context.window ?? 1e6)) * (this.opts.chaos ? 0.12 : 0.06);
      this.syncCtx(a);
      if (a.ctx >= 0.97) this.blowout(s, a);
      if (a.report.status === 'running' && rng.chance(0.15) && a.report.steps) a.report.steps.done++;
    }
    if (rng.chance(0.4)) {
      const tool = rng.pick(LOOP_TOOLS);
      s.loop.toolCalls += 1;
      s.loop.toolCounts = { ...s.loop.toolCounts, [tool]: (s.loop.toolCounts[tool] ?? 0) + 1 };
      s.loop.lastTool = tool;
    }
    if (rng.chance(0.3)) s.loop.steps = { done: s.loop.steps.done + 1, total: null };
    const own = splitTokens(rng, rng.int(200, 900) * 6);
    add(s.tokens, own);
    s.ownCost += costOf(own, s.model);
    s.ctx += (own.input + own.cacheRead + own.cacheWrite) / 1e6 * (this.opts.chaos ? 3 : 1.2);
    if (s.ctx >= 0.97) this.blowout(s, null);

    for (const a of s.agents) {
      if (a.report.status !== 'running') continue;
      const ready = (a.report.steps?.done ?? 0) >= a.progressTotal;
      if (ready && rng.chance(0.35)) this.finish(s, a, true);
      else if (!ready && rng.chance(this.opts.chaos ? 0.012 : 0.004)) this.finish(s, a, false);
    }
    if (s.steps) {
      if (rng.chance(0.3)) this.spawnNext(s);
      if (s.steps.every((x) => x.state === 'done')) this.end(s, 'plan complete');
    } else if (!s.agents.some((a) => a.report.status === 'running')) {
      if (rng.chance(0.5) || s.agents.length >= MAX_AGENTS) this.end(s, 'all agents finished');
      else this.spawn(s, null, 'running', S('Spot-check changed pages', 'sub', 'general-purpose', 'haiku', 'low'));
    }
    if (s.status === 'running' && s.tpl.waitNote && rng.chance(0.01)) {
      s.status = 'waiting';
      s.waitNote = s.tpl.waitNote;
      s.waitLeft = rng.int(8, 25);
      this.ev(s, 'wait', null, `waiting on you: ${s.waitNote}`);
    }
    if (this.opts.chaos && s.status === 'running' && rng.chance(0.003)) s.silent = true;
  }

  private end(s: SimSession, why: string) {
    if (s.status === 'done') return;
    for (const a of s.agents) if (a.report.status === 'running' || a.report.status === 'queued') {
      a.report.status = 'aborted';
      a.report.endedAt = this.now();
    }
    s.status = 'done';
    s.endedAt = this.now();
    this.ev(s, 'plan', null, why === 'plan complete' ? `plan complete: ${s.tpl.plan ?? 'all steps'}` : why);
    this.ev(s, 'end', null, `session.end · ${why === 'exit' ? 'other' : 'prompt_input_exit'}`);
  }

  private planOf(s: SimSession): Plan | null {
    if (!s.steps || !s.tpl.plan) return null;
    return {
      title: s.tpl.plan,
      source: 'TaskCreate',
      steps: s.steps.map((st) => {
        const owner = st.agentId ? s.agents.find((a) => a.report.id === st.agentId) : undefined;
        const blocked = st.state === 'pending' && st.spec.under !== undefined && s.steps![st.spec.under]?.state === 'pending';
        return {
          id: st.id,
          text: st.spec.d,
          state: blocked ? 'blocked' : st.state,
          activeText: st.state === 'active' ? `${st.spec.d}…` : null,
          ownerAgentId: owner ? owner.report.id : null,
          ownerLabel: owner ? this.stepOwnerLabel(owner.report) : null,
        };
      }),
    };
  }

  reportOf(s: SimSession): Report {
    const totalCost = s.ownCost + s.agents.reduce((n, a) => n + a.report.costUsdEst, 0);
    const window = 1_000_000;
    const ctx = Math.min(1, s.ctx);
    return {
      v: 1,
      sentAt: this.now(),
      reporter: { name: 'podium-reporter', version: this.opts.reporterVersion ?? '0.1.0-sim', engineVersion: null, hostSurface: 'simulator' },
      session: {
        id: s.id,
        name: s.name,
        status: s.status,
        waitReason: s.status === 'waiting' ? 'permission' : null,
        waitNote: s.status === 'waiting' ? s.waitNote : null,
        endReason: s.status === 'done' ? 'prompt_input_exit' : null,
        resumeId: s.status === 'done' ? s.id : null,
        startedAt: s.startedAt,
        cwd: s.cwd,
        projectRoot: s.projectRoot,
        repoName: `acme/${s.tpl.project}`,
        git: {
          branch: s.tpl.branch,
          detached: false,
          isWorktree: s.tpl.worktree,
          worktreePath: s.tpl.worktree ? s.cwd : null,
          ahead: s.tpl.ahead,
          behind: s.tpl.behind,
          dirty: s.tpl.dirty,
        },
        model: s.model,
        effort: s.tpl.effort,
        context: { tokens: Math.round(ctx * window), window, percent: Math.round(ctx * 1000) / 10 },
        costUsd: Math.round(totalCost * 10000) / 10000,
        tokens: { ...s.tokens },
        rateLimits: [{ kind: 'five_hour', percentUsed: Math.min(100, Math.round((this.tickN / 40) * 10) / 10), resetsAt: null }],
        blowouts: s.blowouts,
        plan: this.planOf(s),
        loop: { ...s.loop, skills: [...s.loop.skills], toolCounts: { ...s.loop.toolCounts }, steps: { ...s.loop.steps } },
      },
      agents: s.agents.map((a) => ({ ...a.report, tokens: { ...a.report.tokens }, skills: [...a.report.skills] })),
      events: s.events.slice(0, 100),
    };
  }

  /** Advances one simulated second and returns the reports to send now. */
  step(): Report[] {
    this.tickN++;
    for (const s of [...this.sessions]) if (s.status !== 'done' && !s.silent) this.tickSession(s);
    // A finished session sends its final report until acked (at most 3 times), then leaves the sim;
    // a silent one never reports again. Either way a replacement starts after a short pause.
    const live = this.sessions.filter((s) => s.status !== 'done' && !s.silent).length;
    if (live < this.opts.sessions && this.tickN % 4 === 0) this.startSession(false);
    const out: Report[] = [];
    for (const s of this.sessions) {
      if (s.silent) continue;
      if (s.status === 'done') {
        if (s.doneSent >= 3) continue;
        s.doneSent++;
      }
      out.push(this.reportOf(s));
    }
    // Finished sessions whose final report was acked (or sent three times) leave the simulation.
    for (let i = this.sessions.length - 1; i >= 0; i--) {
      const s = this.sessions[i]!;
      if (s.status === 'done' && s.doneSent >= 3 && !out.some((r) => r.session.id === s.id)) this.sessions.splice(i, 1);
    }
    return out;
  }

  /** Called when the server acked `n` events of a report: drops them from the queue. */
  ack(sessionId: string, n: number) {
    const s = this.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    s.events.splice(0, n);
    if (s.status === 'done') s.doneSent = 3;
  }

  /** Ends every session the simulator started that has not ended, and returns their final reports. */
  endAll(): Report[] {
    const out: Report[] = [];
    for (const s of this.sessions) {
      if (s.status === 'done' && s.doneSent >= 3) continue;
      this.end(s, 'exit');
      out.push(this.reportOf(s));
    }
    return out;
  }

  sessionCount(): number {
    return this.sessions.length;
  }
}

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------

interface Args {
  url: string;
  sessions: number;
  speed: number;
  seed: number;
  duration: number;
  chaos: boolean;
  agents: number;
  reporterVersion: string | undefined;
  token: string | null;
  print: boolean;
  ticks: number;
}

export function parseArgs(argv: string[]): Args | 'help' {
  const a: Args = { url: 'http://127.0.0.1:4317', sessions: 5, speed: 1, seed: 1, duration: 0, chaos: false, agents: 0, reporterVersion: undefined, token: null, print: false, ticks: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} needs a value`);
      return v;
    };
    const num = (min: number, max: number) => {
      const n = Number(val());
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${k} must be a number from ${min} to ${max}`);
      return n;
    };
    switch (k) {
      case '-h': case '--help': return 'help';
      case '--url': a.url = val().replace(/\/+$/, ''); break;
      case '--sessions': a.sessions = Math.round(num(1, 50)); break;
      case '--speed': a.speed = num(0.1, 50); break;
      case '--seed': a.seed = Math.round(num(0, 2 ** 32)); break;
      case '--duration': a.duration = num(0, 7 * 24 * 3600); break;
      case '--chaos': a.chaos = true; break;
      case '--agents': a.agents = Math.round(num(0, 190)); break;
      case '--reporter-version': a.reporterVersion = val(); break;
      case '--token': a.token = val(); break;
      case '--print': a.print = true; break;
      case '--ticks': a.ticks = Math.round(num(0, 1e7)); break;
      default: throw new Error(`unknown option ${k} (see --help)`);
    }
  }
  return a;
}

async function post(args: Args, report: Report): Promise<number | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (args.token) headers['X-Podium-Token'] = args.token;
  try {
    const res = await fetch(`${args.url}/api/fleet/report`, { method: 'POST', headers, body: JSON.stringify(report), signal: AbortSignal.timeout(3000) });
    if (res.status === 400) {
      const body = await res.text();
      console.error(`podium-sim: report rejected: ${body.slice(0, 200)}`);
      return report.events.length; // never retry a 400
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { ackedEvents?: number };
    return body.ackedEvents ?? 0;
  } catch {
    return null;
  }
}

async function main() {
  let args: Args | 'help';
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`podium-sim: ${(err as Error).message}`);
    process.exit(2);
  }
  if (args === 'help') {
    console.log(HELP);
    return;
  }
  const a = args;
  if (a.print) {
    let t = 1_800_000_000_000;
    const sim = new Simulator({ sessions: a.sessions, seed: a.seed, chaos: a.chaos, extraAgents: a.agents, reporterVersion: a.reporterVersion, now: () => t, home: '/Users/sim' });
    const ticks = a.ticks || 60;
    for (let i = 0; i < ticks; i++) {
      t += 1000;
      for (const r of sim.step()) {
        console.log(JSON.stringify(r));
        sim.ack(r.session.id, r.events.length);
      }
    }
    for (const r of sim.endAll()) console.log(JSON.stringify(r));
    return;
  }

  const sim = new Simulator({ sessions: a.sessions, seed: a.seed, chaos: a.chaos, extraAgents: a.agents, reporterVersion: a.reporterVersion, now: Date.now, home: os.homedir() });
  console.log(`podium-sim: ${a.sessions} sessions, seed ${a.seed}, speed ${a.speed}${a.chaos ? ', chaos' : ''} -> ${a.url}`);
  let stopping = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopping) return;
    const reports = sim.step();
    const acks = await Promise.all(reports.map((r) => post(a, r)));
    reports.forEach((r, i) => {
      const n = acks[i];
      if (n !== null && n !== undefined) sim.ack(r.session.id, n);
    });
    const failed = acks.filter((n) => n === null).length;
    if (failed && failures++ % 10 === 0) console.error(`podium-sim: ${failed} of ${reports.length} reports failed (is the server at ${a.url}?)`);
    if (!stopping) timer = setTimeout(tick, 1000 / a.speed);
  };

  const stop = async (why: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    const finals = sim.endAll();
    await Promise.all(finals.map((r) => post(a, r)));
    console.log(`podium-sim: ${why}; ended ${finals.length} sessions`);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('interrupted'));
  process.on('SIGTERM', () => void stop('terminated'));
  if (a.duration > 0) setTimeout(() => void stop(`duration ${a.duration}s reached`), a.duration * 1000);
  void tick();
}

const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href || process.argv[1]?.endsWith('podium-sim.ts');
  } catch {
    return false;
  }
})();
if (isMain) void main();
