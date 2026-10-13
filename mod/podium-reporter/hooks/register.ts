// Podium reporter: hook wiring only. Every hook observes: it calls next(e) once and returns what that
// resolved to, unchanged; its own work is wrapped so a failure is recorded and never reaches the
// session; and no hook on the tool path awaits the network (reports go out from a timer).
//
// The engine reads this file's use of `$` statically: `$` is only ever passed to functions declared
// at the top of the file and always spelled `$.noun.event(...)`. So every helper that touches `$` is
// a top-level function taking `$`, and the runtime lives in module variables (a hot reload re-runs
// register, which resets them, and session.start rebuilds the state from the engine).
import type { EngineInterface, Register } from 'claude-code';
import { lastSegment, readChanges, readGit } from './git.ts';
import { shortName } from './models.ts';
import { buildReport, repoFromRemote } from './report.ts';
import {
  addEvent,
  agentRequested,
  agentSpawned,
  compaction,
  drainEvents,
  measure,
  newSession,
  notification,
  permissionRequest,
  PLAN_TOOL,
  reconcile,
  resetForNewId,
  sessionEnd,
  NO_FILES,
  setAttached,
  setFiles,
  setGit,
  setExplanation,
  markTextSent,
  type SentTexts,
  setIdentity,
  withCache,
  skillLoaded,
  step,
  toolResult,
  toolStarted,
  turnComplete,
  turnStart,
  type ListedAgent,
  type SessionState,
} from './state.ts';
import { Transport, type FetchLike } from './transport.ts';
import { decide, idle, modelSwitched, pingDone, pingStarted, pingText, PING_PROMPT, requestStarted, setTtl, setWarming, stop, stopText, TTL_LONG_MS, ttlFromResume, WARM_MINUTES_DEFAULT, type ForkOutcome } from './cache.ts';
import { explainPrompt } from './failures.ts';
import { hostOf, isMachineId, MACHINE_ID_KEY, machineInfo, newMachineId } from './machine.ts';
import type { MachineInfo } from './protocol.ts';

export const VERSION = '0.11.0';
const GIT_POLL_MS = 10_000;
/** session.end has one ~1.5 s bound for every hook and core together; stay well inside it. */
const END_FLUSH_MS = 1000;
const ERRORS_KEPT = 20;

type Engine = EngineInterface;

interface Options {
  serverUrl: string;
  token: string;
  flushIntervalMs: number;
  heartbeatMs: number;
  sessionName: string;
  userName: string;
  showStatus: boolean;
  explainFailures: boolean;
  fullPrompts: boolean;
  /** Keep the prompt cache warm while the session waits on the person (issue #27). Off by default. */
  cacheWarming: boolean;
  /** The longest one idle period is kept warm, in minutes (see the break-even in cache.ts). */
  cacheWarmingMinutes: number;
}

interface HookStat {
  calls: number;
  totalMs: number;
  maxMs: number;
}

interface Runtime {
  state: SessionState;
  transport: Transport;
  timers: { cancel: () => void }[];
  storedName: string | null;
  engineVersion: string | null;
  hostSurface: string | null;
  flushing: boolean;
  lastStatus: string | null;
  toastedOk: boolean;
  toastedFail: boolean;
  /** The refusal notice last toasted, so a later refusal is news again once a report has gone through. */
  toastedRefusal: string | null;
  /** The version notice last toasted, so each distinct one shows once. */
  toastedVersion: string | null;
  /** Skill tool calls in flight: a skill.prompt during one belongs to that call's loop. */
  skillCalls: number;
  /** This machine, read only when a userName is set; null otherwise, so nothing identifying is sent. */
  machine: MachineInfo | null;
  /** `/podium warm on|off` for this session id (kept in $.store); null follows the cacheWarming option. */
  warmOverride: boolean | null;
  /**
   * The engine's clock less Date.now(), read on each flush. A main-loop request is timed with Date.now() plus this,
   * so the cache runs on the engine's clock (the flush timer's) without a `$.clock.now()` round trip per request.
   */
  clockOffset: number;
}

export function readOptions(o: Record<string, unknown>): Options {
  const s = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const n = (v: unknown, d: number, min: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : d);
  return {
    serverUrl: s(o.serverUrl, 'http://127.0.0.1:4317') || 'http://127.0.0.1:4317',
    token: s(o.token, ''),
    flushIntervalMs: n(o.flushIntervalMs, 1000, 200),
    heartbeatMs: n(o.heartbeatMs, 5000, 1000),
    sessionName: s(o.sessionName, ''),
    userName: s(o.userName, ''),
    showStatus: typeof o.showStatus === 'boolean' ? o.showStatus : true,
    explainFailures: o.explainFailures === true,
    fullPrompts: o.fullPrompts === true,
    cacheWarming: o.cacheWarming === true,
    cacheWarmingMinutes: n(o.cacheWarmingMinutes, WARM_MINUTES_DEFAULT, 1),
  };
}

// ---- module state (reset by register) -----------------------------------------------------------

let opts: Options = readOptions({});
let rt: Runtime | null = null;
let errors: { at: number; where: string; message: string }[] = [];
let stats: Record<string, HookStat> = {};
/** Agents whose failure was sent for an explanation: at most one call per failure, never retried. */
let explained = new Set<string>();
/** A lifetime a resume revealed before session.start built the runtime; start applies it. */
let earlyTtl: '5m' | '1h' | null = null;
const EXPLAIN_MODEL = 'haiku';

const perf = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
const nowMs = () => Date.now();

/** Read-only view of the runtime, for tests and /podium. */
export function runtimeInfo(): { sessionId: string | null; errors: readonly { where: string; message: string }[]; stats: Readonly<Record<string, HookStat>> } {
  return { sessionId: rt?.state.id ?? null, errors, stats };
}

function remember(where: string, err: unknown): string {
  const message = String((err as Error)?.message ?? err).slice(0, 200);
  errors.push({ at: nowMs(), where, message });
  if (errors.length > ERRORS_KEPT) errors.shift();
  return message;
}

function record($: Engine, where: string, err: unknown): void {
  const message = remember(where, err);
  try {
    $.ui.log(`podium-reporter: ${where}: ${message}`, { to: 'debug' });
  } catch {
    // logging is best effort
  }
}

/** Runs reporter logic for a hook: any throw is remembered, never raised. Timed for /podium. */
function safe(where: string, fn: (r: Runtime) => void): void {
  const t0 = perf();
  try {
    if (rt) fn(rt);
  } catch (err) {
    remember(where, err);
  } finally {
    const ms = perf() - t0;
    const st = (stats[where] ??= { calls: 0, totalMs: 0, maxMs: 0 });
    st.calls++;
    st.totalMs += ms;
    st.maxMs = Math.max(st.maxMs, ms);
  }
}

function metaOf(r: Runtime, now: number) {
  return {
    version: VERSION,
    engineVersion: r.engineVersion,
    hostSurface: r.hostSurface,
    now,
    storedName: r.storedName,
    optionName: opts.sessionName || null,
    userName: opts.userName || null,
    machine: r.machine,
    fullText: opts.fullPrompts,
    warmMaxMs: warmMaxMs(),
  };
}

function warmMaxMs(): number {
  return opts.cacheWarmingMinutes * 60_000;
}

/** Whether warming is on for this session: `/podium warm` for its id, else the option. */
function warmingOn(r: Runtime): boolean {
  return r.warmOverride ?? opts.cacheWarming;
}

function showStatus($: Engine, r: Runtime): void {
  if (!opts.showStatus) return;
  const text = r.transport.statusText();
  if (text === r.lastStatus) return;
  r.lastStatus = text;
  try {
    $.ui.status(text);
  } catch {
    // no status line on this host
  }
}

function toastOnce($: Engine, r: Runtime, ok: boolean): void {
  try {
    if (ok && !r.toastedOk) {
      r.toastedOk = true;
      $.ui.toast(`Podium: reporting to ${opts.serverUrl}`);
    } else if (!ok && !r.toastedFail) {
      r.toastedFail = true;
      $.ui.toast(`Podium: cannot reach ${opts.serverUrl}; will keep retrying`);
    }
  } catch {
    // no toasts on this host
  }
}

function toastRefusalOnce($: Engine, r: Runtime): void {
  const notice = r.transport.refusalNotice();
  if (!notice || notice === r.toastedRefusal) return;
  r.toastedRefusal = notice;
  try {
    $.ui.toast(`Podium: ${notice}`);
  } catch {
    // no toasts on this host
  }
}

function toastVersionOnce($: Engine, r: Runtime): void {
  const notice = r.transport.versionNotice();
  if (!notice) {
    r.toastedVersion = null; // matched again: a later mismatch is news again
    return;
  }
  if (notice === r.toastedVersion) return;
  r.toastedVersion = notice;
  try {
    $.ui.toast(`Podium: ${notice}`);
  } catch {
    // no toasts on this host
  }
}

/** Moves queued events to the transport and posts one report if one is due (or `force`). */
async function flushOnce($: Engine, r: Runtime, now: number, force: boolean): Promise<void> {
  const [st, events] = drainEvents(r.state);
  r.state = st;
  r.transport.enqueue(events);
  if (!force && !r.transport.due(now, r.state.dirty)) return;
  const snapshot = r.state;
  r.state = { ...r.state, dirty: false };
  let sentTexts: SentTexts = {};
  const outcome = await r.transport.send((evs) => {
    const report = buildReport(snapshot, evs, metaOf(r, now));
    sentTexts = Object.fromEntries(report.agents.map((a) => [a.id, { promptText: a.promptText, answerText: a.answerText }]));
    return report;
  }, now);
  if (outcome === 'failed') {
    r.state = { ...r.state, dirty: true };
    toastOnce($, r, false);
  } else if (outcome === 'refused') {
    r.state = { ...r.state, dirty: true };
    toastRefusalOnce($, r);
  } else if (outcome === 'ok') {
    if (opts.fullPrompts) r.state = markTextSent(r.state, sentTexts);
    r.toastedRefusal = null; // accepted again: a later refusal is news again
    toastOnce($, r, true);
  }
  else if (outcome === 'busy') r.state = { ...r.state, dirty: true };
  toastVersionOnce($, r);
  showStatus($, r);
}

async function readUsage($: Engine, r: Runtime): Promise<void> {
  try {
    const u = await $.session.usage();
    r.state = measure(r.state, { context: u.context, cost: u.cost ?? null, rateLimits: u.rateLimits, startedAt: u.startedAt });
  } catch (err) {
    record($, 'session.usage', err);
  }
}

/** The roster of attached clients. An empty one is a background session with nobody on it; a failed read says nothing. */
async function readSurfaces($: Engine, r: Runtime): Promise<void> {
  try {
    const clients = await $.session.surfaces();
    r.state = setAttached(r.state, clients.length > 0);
  } catch (err) {
    record($, 'session.surfaces', err);
  }
}

async function readAgents($: Engine, r: Runtime, now: number): Promise<void> {
  try {
    const list = (await $.agent.list()) as ListedAgent[];
    r.state = reconcile(r.state, list, now);
  } catch (err) {
    record($, 'agent.list', err);
  }
}

async function pollGit($: Engine, r: Runtime): Promise<void> {
  try {
    const cwd = r.state.cwd;
    const run = async (argv: string[]) => {
      const res = await $.process.run(argv, { cwd, timeoutMs: 5000 });
      return { exitCode: res.exitCode, stdout: res.stdout };
    };
    const git = await readGit(run, cwd);
    r.state = setGit(r.state, git);
    const id = r.state.id;
    let base = r.state.gitBase ?? (await loadBase($, id));
    // Tried even when readGit gave null: a repository with no commits yet fails that (no HEAD) but has files to list.
    const changes = await readChanges(run, cwd, base);
    if (!changes) {
      if (!git) r.state = setFiles(r.state, NO_FILES, r.state.gitBase);
      return;
    }
    if (r.state.id !== id) return;
    if (changes.base !== base) await attempt(() => $.store.set(`base:${id}`, changes.base), undefined);
    base = changes.base;
    r.state = setFiles(r.state, changes.files, base);
  } catch (err) {
    record($, 'git', err);
  }
}

/** The starting commit saved by an earlier run of this session (a hot reload keeps the process, a restart does not). */
async function loadBase($: Engine, id: string): Promise<string | null> {
  try {
    const v = await $.store.get(`base:${id}`);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

async function loadName($: Engine, id: string): Promise<string | null> {
  try {
    const v = await $.store.get(`name:${id}`);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `/podium warm on|off` kept for a session id; null when it was never set. */
async function loadWarm($: Engine, id: string): Promise<boolean | null> {
  try {
    const v = await $.store.get(`warm:${id}`);
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

/** A /clear happened: the old id gets its final report, then reporting starts under the new id. */
async function switchSession($: Engine, r: Runtime, newId: string, now: number): Promise<void> {
  if (!r.state.ended) {
    r.state = sessionEnd(r.state, 'clear', r.state.id, now);
    await r.transport.idle();
    await flushOnce($, r, now, true);
  }
  r.transport.queue = [];
  let startedAt = now;
  try {
    startedAt = (await $.session.usage()).startedAt || now;
  } catch {
    // keep now
  }
  const effort = r.state.main.effort;
  r.state = addEvent(resetForNewId(r.state, newId, startedAt), 'start', null, `session.start · ${shortName(r.state.main.model)}${effort ? ` ${effort}` : ''}`, now);
  r.storedName = await loadName($, newId);
  r.warmOverride = await loadWarm($, newId);
}

/** The flush timer: notice a session id change, refresh usage and agents, post a report if due. */
async function flush($: Engine): Promise<void> {
  const r = rt;
  if (!r || r.flushing) return;
  r.flushing = true;
  try {
    // Scheduling (heartbeat, backoff) runs on the engine's clock; hooks stamp events with Date.now().
    const now = await engineNow($);
    r.clockOffset = now - nowMs();
    let id: string | null = null;
    try {
      id = await $.session.id();
    } catch (err) {
      record($, 'session.id', err);
    }
    if (id && id !== r.state.id) await switchSession($, r, id, now);
    if (r.state.ended) return;
    await readUsage($, r);
    await readSurfaces($, r);
    await readAgents($, r, now);
    if (opts.explainFailures) requestExplanations($, r);
    warmTick($, r, now);
    await flushOnce($, r, now, false);
  } catch (err) {
    record($, 'flush', err);
  } finally {
    r.flushing = false;
  }
}

/** The engine's time; Date.now() where the host has no clock noun. */
async function engineNow($: Engine): Promise<number> {
  try {
    return await $.clock.now();
  } catch {
    return nowMs();
  }
}

/**
 * Cache warming (issue #27), off by default. While the session waits on the person, one tool-less request over
 * its own transcript a minute before the cache would expire, bounded per idle period; see cache.ts.
 */
function warmTick($: Engine, r: Runtime, now: number): void {
  const s = r.state;
  let cache = s.cache.on === warmingOn(r) ? s.cache : setWarming(s.cache, warmingOn(r));
  // Waiting for a prompt only: a permission wait is mid-turn, and a ping then would follow an unanswered tool call.
  cache = idle(cache, !s.ended && s.status === 'waiting' && s.waitReason === 'input', now);
  const action = decide(cache, now, warmMaxMs());
  if (action === 'ping') {
    r.state = withCache(s, pingStarted(cache, now));
    void warmPing($, s.id, now, s.main.model);
  } else if (action !== 'wait') {
    r.state = addEvent(withCache(s, stop(cache, action)), 'note', null, stopText(action, warmMaxMs()), now, { kind: 'cache-stop', reason: action });
  } else {
    r.state = withCache(s, cache);
  }
}

async function warmPing($: Engine, sessionId: string, start: number, model: string | null): Promise<void> {
  let res: ForkOutcome;
  try {
    res = (await $.model.fork({ prompt: PING_PROMPT })) as ForkOutcome;
  } catch (err) {
    record($, 'model.fork', err);
    res = { isAnswered: false, reason: 'api-error' };
  }
  const r = rt;
  if (!r || r.state.id !== sessionId) return;
  const out = pingDone(r.state.cache, start, res, model);
  if (out.late) return; // given up on (timeout) or the session ran since: changes nothing
  const s = withCache(r.state, out.cache);
  r.state = out.stop
    ? addEvent(s, 'note', null, stopText(out.stop, warmMaxMs()), start, { kind: 'cache-stop', reason: out.stop, ...(res.isAnswered ? {} : { status: res.status ?? null, error: res.error ?? null }) })
    : addEvent(s, 'note', null, pingText(res.usage, out.costUsd), start, {
        kind: 'cache-ping',
        cacheRead: res.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage?.cache_creation_input_tokens ?? 0,
        costUsd: out.costUsd,
      });
}

/** T5.2, off by default: one small-model explanation per new failure, from the redacted record only. */
function requestExplanations($: Engine, r: Runtime): void {
  for (const id of r.state.order) {
    const a = r.state.agents[id];
    // Keyed by the failure itself (its time), not just the agent: a retried agent that fails again is a new failure.
    const key = a?.failure ? `${r.state.id}:${id}:${a.failure.at}` : '';
    if (!a?.failure || a.failure.explanation || explained.has(key)) continue;
    explained.add(key);
    void explain($, r.state.id, id, explainPrompt(a.failure));
  }
}

async function explain($: Engine, sessionId: string, agentId: string, prompt: string): Promise<void> {
  try {
    const res = await $.model.complete({ model: EXPLAIN_MODEL, effort: 'low', prompt, maxTokens: 200, timeoutMs: 30_000 });
    if (!res.isAnswered || !rt || rt.state.id !== sessionId) return;
    rt.state = setExplanation(rt.state, agentId, res.text, res.usage, EXPLAIN_MODEL);
  } catch (err) {
    record($, 'model.complete', err);
  }
}

/** A random number in [0, 1): the platform's generator where the sandbox has one. */
function random(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
  return Math.random();
}

/**
 * This machine's short host name and the random id the mod keeps for it in its own store (made on first
 * use). Read only when a userName is set: an unnamed reporter sends nothing that identifies the machine.
 */
async function readMachine($: Engine): Promise<MachineInfo | null> {
  if (!opts.userName.trim()) return null;
  try {
    let id = await attempt(() => $.store.get(MACHINE_ID_KEY), undefined);
    if (!isMachineId(id)) {
      id = newMachineId(random);
      await attempt(() => $.store.set(MACHINE_ID_KEY, id), undefined);
    }
    const host = await attempt(async () => {
      const res = await $.process.run(['hostname'], { timeoutMs: 2000 });
      return res.exitCode === 0 ? hostOf(res.stdout) : null;
    }, null);
    return machineInfo(host, id as string);
  } catch (err) {
    record($, 'machine', err);
    return null;
  }
}

async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** session.start (also after a hot reload): build the state, register /podium and the plan tool, start timers. */
async function start($: Engine, e: { cwd: string; surface: string | null }): Promise<void> {
  for (const t of rt?.timers ?? []) t.cancel();
  const now = nowMs();
  const id = await attempt(() => $.session.id(), `unknown-${now}`);
  const model = await attempt<string | null>(() => $.session.model(), null);
  const root = await attempt(() => $.session.root(), e.cwd);
  const repo = await attempt(() => $.session.repo(), null);
  const version = await attempt(() => $.session.version(), null);
  const usage = await attempt(() => $.session.usage(), null);
  const projectRoot = repo?.root ?? root ?? e.cwd;
  const same = !!rt && rt.state.id === id;
  let state = same && rt ? rt.state : newSession({ id, cwd: e.cwd, startedAt: usage?.startedAt || now, model });
  state = setIdentity(state, { cwd: e.cwd, projectRoot, repoName: repo?.name ?? repoFromRemote(repo?.remote) ?? lastSegment(projectRoot), model });
  if (usage) state = measure(state, { context: usage.context, cost: usage.cost ?? null, rateLimits: usage.rateLimits, startedAt: usage.startedAt });
  if (!same) state = addEvent(state, 'start', null, `session.start · ${shortName(model)}`, now, { surface: e.surface });
  const fetch: FetchLike = (url, init) => $.http.fetch(url, init);
  const transport =
    rt?.transport ??
    new Transport(fetch, { serverUrl: opts.serverUrl, token: opts.token, heartbeatMs: opts.heartbeatMs }, (line) => remember('transport', line));
  rt = {
    state,
    transport,
    timers: [],
    storedName: await loadName($, id),
    engineVersion: version?.version ?? null,
    hostSurface: e.surface,
    flushing: false,
    lastStatus: null,
    toastedOk: rt?.toastedOk ?? false,
    toastedFail: rt?.toastedFail ?? false,
    toastedRefusal: rt?.toastedRefusal ?? null,
    toastedVersion: rt?.toastedVersion ?? null,
    skillCalls: 0,
    machine: rt?.machine ?? (await readMachine($)),
    warmOverride: await loadWarm($, id),
    clockOffset: (await engineNow($)) - nowMs(),
  };
  const r = rt;
  // A resume's SessionStart may have come before this runtime existed, even while start awaited.
  if (earlyTtl) r.state = withCache(r.state, setTtl(r.state.cache, earlyTtl));
  earlyTtl = null;
  await readAgents($, r, now);
  try {
    await $.command.register({ name: 'podium', description: 'Podium fleet console: link, connection state, naming this session, and keeping its prompt cache warm', argumentHint: '[name <text> | warm on|off]' });
  } catch (err) {
    record($, 'command.register', err);
  }
  try {
    await $.tool.register({
      name: 'plan',
      description: 'Names the plan this session is working through, for the Podium fleet console. Call once with a short title when you start a multi-step plan.',
      inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'Short plan title' }, phase: { type: 'string', description: 'Optional phase name' } }, required: ['title'] },
    });
  } catch (err) {
    record($, 'tool.register', err);
  }
  r.timers.push($.clock.every(opts.flushIntervalMs, () => void flush($)));
  r.timers.push($.clock.every(GIT_POLL_MS, () => void pollGit($, r)));
  void pollGit($, r);
  showStatus($, r);
}

/** session.end: the final report, awaited, inside a deadline on the engine's clock. */
async function end($: Engine, e: { reason: string; sessionId: string; resume?: { id: string } }, signal: AbortSignal | undefined): Promise<void> {
  const r = rt;
  if (!r) return;
  const now = await engineNow($);
  if (e.sessionId === r.state.id || !e.sessionId) {
    r.state = sessionEnd(r.state, e.reason, e.resume?.id ?? e.sessionId ?? r.state.id, now);
    // The hooks sandbox has no setTimeout: the deadline is the engine's clock. A sleep the dispatch
    // abandons rejects; either way the race is over.
    const deadline = $.clock.sleep(END_FLUSH_MS, signal ? { signal } : undefined).catch(() => undefined);
    await Promise.race([
      (async () => {
        await r.transport.idle();
        await flushOnce($, r, now, true);
      })(),
      deadline,
    ]);
  }
  // After /clear the process goes on under a new id (the flusher picks it up); otherwise it is ending.
  if (e.reason !== 'clear') {
    for (const t of r.timers) t.cancel();
    r.timers = [];
  }
}

/** /podium and /podium name <text>. */
async function podiumCommand($: Engine, args: string): Promise<string> {
  const r = rt;
  const m = /^name\s+([\s\S]+)$/i.exec(args.trim());
  if (m && r) {
    const name = m[1]!.trim().slice(0, 80);
    try {
      await $.store.set(`name:${r.state.id}`, name);
    } catch (err) {
      record($, 'store.set', err);
    }
    r.storedName = name;
    r.state = { ...r.state, dirty: true };
    return `Podium: this session is now named "${name}".`;
  }
  const w = /^warm(?:\s+(on|off))?$/i.exec(args.trim());
  if (w && r) return warmCommand($, r, w[1]?.toLowerCase() ?? null);
  if (!r) return 'Podium reporter is loaded but the session has not started yet.';
  const t = r.transport;
  const hooks = Object.entries(stats)
    .filter(([, s]) => s.calls)
    .map(([k, s]) => `${k} ${(s.totalMs / s.calls).toFixed(2)} ms avg, ${s.maxMs.toFixed(2)} max`)
    .slice(0, 8);
  return [
    `Podium fleet console: ${opts.serverUrl.replace(/\/+$/, '')}/#/`,
    `Connection: ${t.online === null ? 'not tried yet' : t.online ? 'online' : 'offline, retrying'}${t.liveSessions !== null ? ` (${t.liveSessions} live sessions)` : ''}`,
    `Versions: reporter ${VERSION}${t.serverVersion ? `, server ${t.serverVersion}` : ''}`,
    t.versionNotice() ?? '',
    `Reports sent: ${t.sent}, failed: ${t.failed}, rejected: ${t.rejected}; events queued: ${t.queue.length}${t.dropped ? `, dropped: ${t.dropped}` : ''}`,
    `Last error: ${t.lastError ?? errors[errors.length - 1]?.message ?? 'none'}`,
    `Session: ${r.state.id}${r.storedName ? ` (named "${r.storedName}")` : ''}`,
    hooks.length ? `Reporter time per hook: ${hooks.join('; ')}` : '',
    ttlLine(r),
    warmLine(r),
    'Name this session: /podium name <text>',
  ]
    .filter(Boolean)
    .join('\n');
}

function ttlLine(r: Runtime): string {
  const c = r.state.cache;
  const ttl = c.ttlMs >= TTL_LONG_MS ? '1 hour' : '5 minutes';
  return c.ttlKnown ? `Prompt cache lifetime: ${ttl}` : `Prompt cache lifetime: ${ttl}, assumed (Claude Code names it only on a model switch or a resume)`;
}

function warmLine(r: Runtime): string {
  const c = r.state.cache;
  const spent = c.pings ? ` (${c.pings} ping${c.pings === 1 ? '' : 's'} so far, about $${c.costUsd.toFixed(4)})` : '';
  if (!warmingOn(r)) return `Cache warming: off${spent}. Keep the prompt cache warm while this session waits: /podium warm on`;
  const stopped = c.on && c.stopped ? `; ${stopText(c.stopped, warmMaxMs())}` : '';
  return `Cache warming: on, at most ${opts.cacheWarmingMinutes} minutes per idle period${spent}${stopped}. Turn it off: /podium warm off`;
}

/** /podium warm on|off: for this session id only, kept in $.store so a reload keeps it. */
async function warmCommand($: Engine, r: Runtime, choice: string | null): Promise<string> {
  if (choice === null) return warmLine(r);
  const on = choice === 'on';
  r.warmOverride = on;
  r.state = withCache(r.state, setWarming(r.state.cache, on));
  try {
    await $.store.set(`warm:${r.state.id}`, on);
  } catch (err) {
    record($, 'store.set', err);
  }
  return on
    ? `Podium: Cache warming is on for this session. While it waits on you, one small request about a minute before the prompt cache expires keeps it warm, for at most ${opts.cacheWarmingMinutes} minutes per idle period. Each costs about a tenth of the prompt's input price. Nothing is added to the conversation. Turn it off with /podium warm off.`
    : 'Podium: Cache warming is off for this session.';
}

// ---- registration -------------------------------------------------------------------------------

export const register: Register = (on, rawOptions) => {
  opts = readOptions(rawOptions as Record<string, unknown>);
  rt = null;
  errors = [];
  stats = {};
  explained = new Set();
  earlyTtl = null;

  on('session.start', async ($, e, next) => {
    const res = await next(e);
    try {
      await start($, e);
    } catch (err) {
      record($, 'session.start', err);
    }
    return res;
  }).catch(($, e, next) => next(e));

  on('session.end', async ($, e, next) => {
    const res = await next(e);
    try {
      await end($, e, next.signal);
    } catch (err) {
      record($, 'session.end', err);
    }
    return res;
  }).catch(($, e, next) => next(e));

  on('turn.start', async ($, e, next) => {
    safe('turn.start', (r) => {
      r.state = turnStart(r.state);
      // Running again ends the idle period now, with any stop and any ping in flight, even for a turn shorter than a flush.
      r.state = withCache(r.state, idle(r.state.cache, false, nowMs()));
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  on('turn.step', async function* ($, e, next) {
    const r0 = rt;
    // A cache entry lives from the start of the request that read or wrote it: note when a main-thread one starts,
    // on the engine's clock (Date.now() plus the offset the flush last read: no host call before the request).
    const startedAt = !e.agentId && r0 ? nowMs() + r0.clockOffset : null;
    // Defensive until the live check (#27) shows whether a $.model.fork raises turn.step: a main-loop step while a
    // warming ping is in flight and the main loop is idle is the ping's own request. Its result (warmPing) is the
    // one place a ping is counted, so this step moves no step count, tokens, cost or lastRequestAt.
    const isPing = startedAt !== null && r0!.state.cache.inFlightSince !== null && r0!.state.mainIdle;
    const res = yield* next(e);
    if (isPing) return res;
    safe('turn.step', (r) => {
      r.state = step(r.state, { agentId: e.agentId, model: e.model, effort: e.effort, usage: res?.usage ?? null, stopReason: res?.stopReason ?? null }, nowMs());
      if (startedAt !== null && res?.usage) r.state = withCache(r.state, requestStarted(r.state.cache, startedAt));
    });
    return res;
  }).catch(async function* ($, e, next) {
    return yield* next(e);
  });

  on('turn.complete', async ($, e, next) => {
    const res = await next(e);
    safe('turn.complete', (r) => {
      r.state = turnComplete(r.state, { agentId: e.agentId, reason: e.reason, answer: e.answer }, nowMs());
    });
    return res;
  }).catch(($, e, next) => next(e));

  on('session.compact', async ($, e, next) => {
    const res = await next(e);
    safe('session.compact', (r) => {
      if (e.trigger === 'precompute' || !res || res.skip !== undefined || !res.messages) return;
      r.state = compaction(r.state, { agentId: e.agentId, trigger: e.trigger, tokensBefore: res.tokensBefore, tokensAfter: res.tokensAfter }, nowMs());
    });
    return res;
  }).catch(($, e, next) => next(e));

  // A client joining or leaving is a prompt to look at the roster now; the flush timer reads it too.
  on('session.attach', async ($, e, next) => {
    const res = await next(e);
    if (rt) await readSurfaces($, rt);
    return res;
  }).catch(($, e, next) => next(e));

  on('session.detach', async ($, e, next) => {
    const res = await next(e);
    if (rt) await readSurfaces($, rt);
    return res;
  }).catch(($, e, next) => next(e));

  on('session.measure', async ($, e, next) => {
    safe('session.measure', (r) => {
      r.state = measure(r.state, { context: e.context, cost: e.cost ?? null, rateLimits: e.rateLimits });
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e);
    safe('agent.spawn', (r) => {
      if (!res || res.deny !== undefined || !res.agentId) return;
      r.state = agentSpawned(
        r.state,
        {
          toolUseId: e.tool_use_id,
          agentId: res.agentId,
          model: res.model ?? e.model ?? null,
          subagentType: e.subagentType,
          description: e.description,
          prompt: e.prompt,
          parentAgentId: e.parentAgentId,
          fork: e.fork,
          isTeammate: e.isTeammate === true,
          name: e.name ?? res.teammateId,
        },
        nowMs(),
      );
    });
    return res;
  }).catch(($, e, next) => next(e));

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool);
    const input = e as unknown as Record<string, unknown>;
    safe('tool.call', (r) => {
      r.state = toolStarted(r.state, e.agentId, tool);
      if (tool === 'Agent' && e.tool_use_id) r.state = agentRequested(r.state, e.tool_use_id, input, nowMs());
      if (tool === 'Skill') r.skillCalls++;
    });
    let res: Awaited<ReturnType<typeof next>>;
    try {
      res = await next(e);
    } finally {
      safe('tool.call.done', (r) => {
        if (tool === 'Skill') r.skillCalls = Math.max(0, r.skillCalls - 1);
      });
    }
    safe('tool.call.result', (r) => {
      r.state = toolResult(r.state, { agentId: e.agentId, tool, input, result: (res ?? {}) as { deny?: string; isError?: boolean; text?: string } }, nowMs());
    });
    return res;
  }).catch(($, e, next) => next(e));

  // The reporter's own tool names the plan: answered here, recorded by the hook above.
  // The matcher is a literal (PLAN_TOOL) so the engine sees which tool this hook answers.
  on('tool.call', { tool: 'mcp__podium-reporter__plan' }, () => ({ result: { ok: true, note: 'Plan title recorded for the Podium fleet console.' } })).catch(
    () => ({ result: { ok: true, note: 'Plan title recorded for the Podium fleet console.' } }),
  );

  on('skill.prompt', async ($, e, next) => {
    safe('skill.prompt', (r) => {
      // A Skill tool call records its own loop; an agent may be preloading it: skip when ambiguous.
      const agentsRunning = Object.values(r.state.agents).some((a) => a.status === 'running');
      if (r.skillCalls === 0 && !agentsRunning) r.state = skillLoaded(r.state, undefined, e.skill, nowMs());
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  on('classic.PermissionRequest', async ($, e, next) => {
    safe('classic.PermissionRequest', (r) => {
      r.state = permissionRequest(r.state, e.tool_name, e.tool_input, nowMs());
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  on('classic.Notification', async ($, e, next) => {
    safe('classic.Notification', (r) => {
      r.state = notification(r.state, e.notification_type, e.message, nowMs());
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  // Where the session says which cache lifetime it uses (`5m` or `1h`); the new model's cache starts cold.
  on('classic.PostModelSwitch', async ($, e, next) => {
    safe('classic.PostModelSwitch', (r) => {
      r.state = withCache(r.state, modelSwitched(r.state.cache, { from: e.from_model, to: e.to_model, warm: e.prompt_cache_warm, ttl: e.cache_ttl }));
    });
    return next(e);
  }).catch(($, e, next) => next(e));

  // A resume says how long ago the last response was and whether the cache likely expired: between 5 minutes
  // and an hour that names the lifetime. It may come before session.start has built the runtime.
  on('classic.SessionStart', async ($, e, next) => {
    try {
      const ttl = ttlFromResume(e.seconds_since_last_response, e.prompt_cache_likely_expired);
      if (ttl && rt) rt.state = withCache(rt.state, setTtl(rt.state.cache, ttl));
      else if (ttl) earlyTtl = ttl;
    } catch (err) {
      remember('classic.SessionStart', err);
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on('command.run', { command: 'podium' }, async ($, e) => ({ text: await podiumCommand($, e.args ?? '') }));
};
