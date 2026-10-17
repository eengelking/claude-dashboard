// Responding to a waiting session from Podium (#206, SPEC 5.3, 7.1, 7.2). Held in memory only: the open asks with their
// content, a closed ask's outcome for a while, and the answers and messages sent from the browser until the mod says
// what became of them. Nothing here is written to the database, and a restart loses it all; the mod re-sends its open
// asks with every report, so they come back by themselves.
import { randomBytes } from 'node:crypto';
import {
  PLAN_MODES,
  RESPOND_LIMITS,
  type Ask,
  type AskClose,
  type AskDetail,
  type AskOutcome,
  type AskState,
  type AskSummary,
  type Delivery,
  type DeliveryKind,
  type DeliveryResult,
  type PlanMode,
  type PodiumCommand,
  type QuestionAnswer,
  type Report,
  type RespondInfo,
  type RespondKind,
} from './protocol.js';
import { nameKey } from './people.js';

/** How long a closed ask stays readable, unless the session's next ask opens first. */
export const CLOSED_KEEP_MS = 10 * 60_000;
/** An ask a report no longer lists is taken as closed only when it opened this long before the report was made. */
const REPORT_GRACE_MS = 5000;
const MAX_WAITERS_PER_ASK = 4;
const MAX_WAITERS = 200;

/** Where a feed entry for something sent from Podium goes: the activity feed of the loop it is about (8.1). */
export interface PodiumFeed {
  add(sessionId: string, loop: string | null, ref: string, entry: { at: number; text: string; by: string; note: string | null }): void;
  update(sessionId: string, ref: string, note: string | null): void;
  remove(sessionId: string, ref: string): void;
}

interface DeliveryEntry {
  d: Delivery;
  /** The sender's name, compared case-insensitively. */
  byKey: string;
  result: DeliveryResult | null;
  handedOver: boolean;
}

interface Closed {
  outcome: AskOutcome;
  at: number;
  by: string | null;
  answer: string | null;
  planApproved: boolean;
  /** Taken as closed because a report stopped listing it; an explicit close from the mod replaces it. */
  implicit: boolean;
}

interface AskEntry {
  ask: Ask;
  delivery: DeliveryEntry | null;
  closed: Closed | null;
  /** A report made after the ask closed found the session running: the turn it closed in is going (#208). */
  ran?: boolean;
}

/** Why the server let go of a delivery that has no result (#304, #326, #333, #334). */
export type DropWhy = 'discarded' | 'ask-closed' | 'session-ended' | 'queued-session-ended' | 'session-deleted' | 'responding-off';

/** What became of a delivery after the server took it, for the admin log (#304): never its text. */
export type DeliveryTrail =
  | { kind: 'result'; sessionId: string; delivery: Delivery; result: DeliveryResult }
  | { kind: 'dropped'; sessionId: string; delivery: Delivery; why: DropWhy; /** Who discarded it; the sender for every other reason. */ by: string };

export type HoldResult = { kind: 'delivery'; delivery: Delivery } | { kind: 'none' } | { kind: 'unknown' } | { kind: 'closed'; outcome: AskOutcome };

interface Waiter {
  sessionId: string;
  askId: string;
  resolve: (r: HoldResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SessionEntry {
  info: RespondInfo | null;
  asks: Map<string, AskEntry>;
  messages: DeliveryEntry[];
}

export type AnswerError =
  | { status: 400; error: string; path: string }
  | { status: 404; error: 'unknown ask' }
  | { status: 409; error: 'answered'; by: string; at: number }
  | { status: 410; error: 'closed'; outcome: AskOutcome; at: number }
  | { status: 422; error: 'not accepted'; kind: string }
  | { status: 429; error: string };

// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Text sent from the browser: control characters other than line breaks and tabs removed; null when over `max`. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL_KEEP_NEWLINE, ' ');
  return s.length > max ? null : s;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The kind of answer each kind of ask takes for a message sent in its place, and which `accepts` entry allows it. */
const REPLY_NEEDS: Record<Ask['kind'], RespondKind> = { question: 'question', plan: 'plan-feedback', permission: 'permission' };
const NEEDS: Record<Exclude<DeliveryKind, 'reply' | 'message' | 'command'>, { ask: Ask['kind']; kind: RespondKind }> = {
  question: { ask: 'question', kind: 'question' },
  'plan-approve': { ask: 'plan', kind: 'plan-approve' },
  'plan-feedback': { ask: 'plan', kind: 'plan-feedback' },
  'allow-once': { ask: 'permission', kind: 'permission' },
  deny: { ask: 'permission', kind: 'permission' },
};

const PLAN_LABEL: Record<PlanMode, string> = { auto: 'and use auto mode', acceptEdits: 'auto-accept edits', default: 'manually approve edits' };
const ASK_WORD: Record<Ask['kind'], string> = { question: 'question', plan: 'plan', permission: 'request' };

/** A short name for the call a permission ask is about, for the feed: a Bash command, else the tool's name. */
function toolShort(ask: Ask): string {
  const t = ask.tool;
  if (!t) return 'the tool';
  const cmd = t.input.command;
  if (t.name === 'Bash' && typeof cmd === 'string') return cmd.replace(/\s+/g, ' ').trim().slice(0, 120);
  return t.name;
}

/** What a question answer reads as: each answered question's options (joined with ", ") or typed text, joined with "; ". */
export function questionSummary(ask: Ask, answers: readonly QuestionAnswer[]): string {
  return (ask.questions ?? [])
    .map((q, i) => {
      const a = answers[i];
      if (!a) return '';
      if ('text' in a) return a.text.trim();
      // Without Claude Code's "(Recommended)" mark, as the console shows the option (cleanLabel) and the mockup the answer.
      return a.options.map((n) => (q.options[n]?.label ?? '').replace(/\s*\(Recommended\)\s*$/i, '')).join(', ');
    })
    .filter(Boolean)
    .join('; ');
}

/** The feed text for a delivery, as the mockup words it ("answered: …", "approved the plan (…)", "allowed once: …"). */
function feedText(d: Delivery, ask: Ask | null): string {
  switch (d.kind) {
    case 'question':
      return `answered: ${ask ? questionSummary(ask, d.answers ?? []) : ''}`;
    case 'plan-approve':
      return `approved the plan (${PLAN_LABEL[d.mode ?? 'auto']})`;
    case 'plan-feedback':
      return d.text?.trim() ? `No, keep planning: ${d.text.trim()}` : 'No, keep planning';
    case 'allow-once':
      return `allowed once: ${ask ? toolShort(ask) : ''}`;
    case 'deny':
      return `denied: ${ask ? toolShort(ask) : ''}${d.text?.trim() ? `. ${d.text.trim()}` : ''}`;
    case 'command':
      return `/${d.command}`;
    default:
      return (d.text ?? '').trim();
  }
}

/** The admin log's words for a delivery's kind: what was done, never what was said (7.7). */
export function logWords(d: Delivery): string {
  switch (d.kind) {
    case 'question':
      return 'Answered a question';
    case 'reply':
      return 'Sent a message in place of an answer';
    case 'plan-approve':
      return `Approved a plan (${d.mode})`;
    case 'plan-feedback':
      return 'Sent a plan back';
    case 'allow-once':
      return 'Allowed a tool once';
    case 'deny':
      return 'Denied a tool';
    case 'command':
      return `Ran /${d.command}`;
    default:
      return 'Sent a message';
  }
}

/** The feed note for a delivery that waits: an answer replaced by a message, a message queued, a /clear done. */
function noteFor(d: Delivery, ask: Ask | null, result: DeliveryResult | null): string | null {
  if (d.kind === 'reply' && ask) return `(in place of an answer; the ${ASK_WORD[ask.kind]} closes)`;
  if (d.kind === 'command' && d.command === 'clear' && result === 'took') return '(the conversation was cleared; a new session id follows)';
  if ((d.kind === 'message' || d.kind === 'command') && result === 'queued') return '(queued until the session is idle)';
  return null;
}

function newId(): string {
  return `dlv_${randomBytes(12).toString('hex')}`;
}

/** The short id the admin log shows for a delivery, so its rows match: `dlv_` and the first 8 hex digits. */
export function shortDeliveryId(d: Delivery): string {
  return d.id.slice(0, 12);
}

export class RespondStore {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly waiters = new Set<Waiter>();
  /** Told what became of each delivery (#304). The routes set it to write the admin log. */
  trail: (t: DeliveryTrail) => void = () => {};

  constructor(
    private readonly now: () => number,
    /** A session's asks changed: its card and the modal need a fresh SessionView. */
    private readonly onChange: (sessionId: string) => void = () => {},
    private readonly feed: PodiumFeed | null = null,
  ) {}

  private entry(sessionId: string): SessionEntry {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { info: null, asks: new Map(), messages: [] };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** Report.session.respond as last reported; null when no report since the server started has said. */
  info(sessionId: string): RespondInfo | null {
    return this.sessions.get(sessionId)?.info ?? null;
  }

  /**
   * A validated report. Keeps what the session says it takes, and, when it carries its asks (responding is on), learns
   * any it does not know (a restarted server) and takes as closed an open one it no longer lists. A finished session
   * closes them all.
   */
  noteReport(report: Report, takeAsks: boolean): void {
    const sid = report.session.id;
    if (report.session.respond) this.entry(sid).info = report.session.respond;
    else if (this.sessions.has(sid)) this.entry(sid).info = null;
    if (report.session.status === 'done') {
      this.endSession(sid);
      return;
    }
    if (!takeAsks || !report.session.asks) return;
    const listed = new Set(report.session.asks.map((a) => a.id));
    for (const a of report.session.asks) this.announce(sid, a);
    const s = this.sessions.get(sid);
    if (!s) return;
    for (const [id, e] of s.asks) {
      if (e.closed || listed.has(id) || e.ask.openedAt > report.sentAt - REPORT_GRACE_MS) continue;
      this.setClosed(sid, e, { outcome: 'closed', at: this.now(), by: null, answer: null, planApproved: false, implicit: true });
    }
    this.forgetOnIdle(sid, report);
  }

  /**
   * A closed ask's outcome is stale once its turn is over (#208): the session was seen running after the ask closed and
   * now reports itself idle (`waiting`) with no open ask. An idle report with no running one between could still be the
   * moment before the session takes the answer, and one made before the ask closed says nothing about it.
   */
  private forgetOnIdle(sessionId: string, report: Report): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const status = report.session.status;
    if (status === 'running') {
      for (const e of s.asks.values()) if (e.closed && e.closed.at < report.sentAt) e.ran = true;
      return;
    }
    if (status !== 'waiting') return;
    for (const e of s.asks.values()) if (!e.closed) return;
    let changed = false;
    for (const [id, e] of s.asks) {
      if (e.closed && e.ran) {
        s.asks.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange(sessionId);
  }

  /** The mod announces an ask (PUT). Idempotent: a changed body replaces the stored one while no answer is pending. */
  announce(sessionId: string, ask: Ask): 'ok' | 'closed' | 'full' {
    const s = this.entry(sessionId);
    const known = s.asks.get(ask.id);
    if (known) {
      if (known.closed && !known.closed.implicit) return 'closed';
      if (known.closed?.implicit) {
        // Open again: an answer the implicit close dropped is gone, so the ask takes a new one.
        known.closed = null;
        if (known.delivery?.result === 'closed') known.delivery = null;
        this.onChange(sessionId);
      }
      if (!known.delivery) known.ask = ask;
      return 'ok';
    }
    const open = [...s.asks.values()].filter((e) => !e.closed).length;
    if (open >= RESPOND_LIMITS.asks) return 'full';
    // A new ask ends the readable life of every closed one before it.
    for (const [id, e] of s.asks) if (e.closed) s.asks.delete(id);
    s.asks.set(ask.id, { ask, delivery: null, closed: null });
    this.onChange(sessionId);
    return 'ok';
  }

  /**
   * The mod's held request: an answer now, or once one arrives, or nothing within `waitMs`. `signal` aborts when the
   * mod's connection closes, so an answer that comes later is not marked handed over to a request nobody reads.
   */
  hold(sessionId: string, askId: string, waitMs: number, signal?: AbortSignal): Promise<HoldResult> {
    if (signal?.aborted) return Promise.resolve({ kind: 'none' });
    const e = this.sessions.get(sessionId)?.asks.get(askId);
    if (!e) return Promise.resolve({ kind: 'unknown' });
    if (e.closed) return Promise.resolve({ kind: 'closed', outcome: e.closed.outcome });
    const ready = this.handOver(sessionId, e);
    if (ready) return Promise.resolve({ kind: 'delivery', delivery: ready });
    return new Promise((resolve) => {
      const mine = [...this.waiters].filter((w) => w.sessionId === sessionId && w.askId === askId);
      if (mine.length >= MAX_WAITERS_PER_ASK) this.release(mine[0]!, { kind: 'none' });
      if (this.waiters.size >= MAX_WAITERS) this.release(this.waiters.values().next().value as Waiter, { kind: 'none' });
      const w: Waiter = { sessionId, askId, resolve, timer: setTimeout(() => this.release(w, { kind: 'none' }), waitMs) };
      w.timer.unref?.();
      this.waiters.add(w);
      signal?.addEventListener('abort', () => this.release(w, { kind: 'none' }), { once: true });
    });
  }

  /** How many held requests are waiting, for tests. */
  get holding(): number {
    return this.waiters.size;
  }

  private release(w: Waiter, r: HoldResult): void {
    if (!this.waiters.delete(w)) return;
    clearTimeout(w.timer);
    w.resolve(r);
  }

  private wake(sessionId: string, askId: string, r: HoldResult | (() => HoldResult)): void {
    for (const w of [...this.waiters]) if (w.sessionId === sessionId && w.askId === askId) this.release(w, typeof r === 'function' ? r() : r);
  }

  /** The answer the mod should be handed for an ask: taken, with no result yet. Marks it handed over. */
  private handOver(sessionId: string, e: AskEntry): Delivery | null {
    const d = e.delivery;
    if (!d || d.result !== null) return null;
    if (!d.handedOver) {
      d.handedOver = true;
      this.onChange(sessionId);
    }
    return d.d;
  }

  /** The mod says an ask closed without an answer from Podium. An answer not yet handed over is dropped. */
  close(sessionId: string, askId: string, close: AskClose): void {
    const e = this.sessions.get(sessionId)?.asks.get(askId);
    if (!e || (e.closed && !e.closed.implicit)) return;
    this.setClosed(sessionId, e, { outcome: close.outcome, at: close.at, by: null, answer: close.answer ?? null, planApproved: close.planApproved === true, implicit: false });
  }

  private setClosed(sessionId: string, e: AskEntry, closed: Closed): void {
    e.closed = closed;
    const d = e.delivery;
    if (d && d.result === null && !d.handedOver) {
      d.result = 'closed';
      this.feed?.remove(sessionId, d.d.id);
      this.trail({ kind: 'dropped', sessionId, delivery: d.d, why: 'ask-closed', by: d.d.by });
    }
    this.wake(sessionId, e.ask.id, { kind: 'closed', outcome: closed.outcome });
    this.onChange(sessionId);
  }

  /** The session ended or left the live set: every open ask closes as `ended`, and waiting messages go. */
  endSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    for (const e of s.asks.values()) if (!e.closed) this.setClosed(sessionId, e, { outcome: 'ended', at: this.now(), by: null, answer: null, planApproved: false, implicit: false });
    // A message or command with no result yet never reached the session. One the session queued may still be read, so the
    // row for it says only that the session ended first (#334); one with a final result already has its row.
    for (const m of s.messages) {
      if (m.result === null) this.trail({ kind: 'dropped', sessionId, delivery: m.d, why: 'session-ended', by: m.d.by });
      else if (m.result === 'queued') this.trail({ kind: 'dropped', sessionId, delivery: m.d, why: 'queued-session-ended', by: m.d.by });
    }
    s.messages = [];
  }

  /** A row for each answer, message or command held with no result yet, as the entry is about to go (#333). */
  private dropPending(sessionId: string, s: SessionEntry, why: DropWhy): void {
    const waiting = [...s.messages, ...[...s.asks.values()].flatMap((e) => (e.delivery ? [e.delivery] : []))];
    for (const d of waiting) if (d.result === null) this.trail({ kind: 'dropped', sessionId, delivery: d.d, why, by: d.d.by });
  }

  /** The session is gone: everything it held goes. */
  dropSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.dropPending(sessionId, s, 'session-deleted');
    for (const e of s.asks.values()) this.wake(sessionId, e.ask.id, { kind: 'closed', outcome: 'ended' });
    this.sessions.delete(sessionId);
  }

  /** The Admin turned responding off: every ask and delivery goes, everywhere. */
  clear(): void {
    for (const w of [...this.waiters]) this.release(w, { kind: 'closed', outcome: 'ended' });
    const ids = [...this.sessions.keys()];
    for (const [id, s] of this.sessions) this.dropPending(id, s, 'responding-off');
    this.sessions.clear();
    for (const id of ids) this.onChange(id);
  }

  /** Once a second: a closed ask older than CLOSED_KEEP_MS goes. */
  expire(): void {
    const now = this.now();
    for (const [sid, s] of this.sessions) {
      let changed = false;
      for (const [id, e] of s.asks) {
        if (e.closed && now - e.closed.at > CLOSED_KEEP_MS) {
          s.asks.delete(id);
          changed = true;
        }
      }
      if (changed) this.onChange(sid);
    }
  }

  /** The asks of a session as the state carries them: no content. */
  summaries(sessionId: string): AskSummary[] {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    return [...s.asks.values()].map((e) => ({
      id: e.ask.id,
      kind: e.ask.kind,
      agentId: e.ask.agentId,
      openedAt: e.ask.openedAt,
      count: e.ask.kind === 'question' ? (e.ask.questions?.length ?? 1) : 1,
      state: stateOf(e),
    }));
  }

  /** The whole ask, for its owner or an Admin. `viewer` is the signed-in name, to mark their own answer. */
  detail(sessionId: string, askId: string, viewer: string, lastSeenAt: number): AskDetail | null {
    const e = this.sessions.get(sessionId)?.asks.get(askId);
    if (!e) return null;
    const d = e.delivery;
    return {
      ask: e.ask,
      state: stateOf(e),
      delivery: d ? { ...d.d, result: d.result, mine: d.byKey === nameKey(viewer), handedOver: d.handedOver } : null,
      closed: e.closed ? { outcome: e.closed.outcome, at: e.closed.at, by: e.closed.by, answer: e.closed.answer, planApproved: e.closed.planApproved } : null,
      lastSeenAt,
    };
  }

  /**
   * An answer from the browser. `accepts` is what the session's last report said it takes. Only the first answer to an
   * ask is taken; a later one is refused with who answered and when.
   */
  answer(sessionId: string, askId: string, by: string, body: unknown): { ok: true; delivery: Delivery } | { ok: false; err: AnswerError } {
    const e = this.sessions.get(sessionId)?.asks.get(askId);
    if (!e) return { ok: false, err: { status: 404, error: 'unknown ask' } };
    if (e.closed) return { ok: false, err: { status: 410, error: 'closed', outcome: e.closed.outcome, at: e.closed.at } };
    if (e.delivery && e.delivery.result !== 'refused') return { ok: false, err: { status: 409, error: 'answered', by: e.delivery.d.by, at: e.delivery.d.at } };
    const parsed = parseAnswer(body, e.ask, this.info(sessionId)?.accepts ?? []);
    if (!parsed.ok) return { ok: false, err: parsed.err };
    const delivery: Delivery = { id: newId(), askId, by, at: this.now(), ...parsed.fields };
    e.delivery = { d: delivery, byKey: nameKey(by), result: null, handedOver: false };
    this.feed?.add(sessionId, e.ask.agentId, delivery.id, { at: delivery.at, text: feedText(delivery, e.ask), by, note: noteFor(delivery, e.ask, null) });
    this.wake(sessionId, askId, () => ({ kind: 'delivery', delivery: this.handOver(sessionId, e) ?? delivery }));
    this.onChange(sessionId);
    return { ok: true, delivery };
  }

  /** A new message or command from the browser. One sent while the session runs waits in Claude Code's queue (5.3). */
  message(sessionId: string, by: string, body: unknown): { ok: true; delivery: Delivery } | { ok: false; err: AnswerError } {
    const accepts = this.info(sessionId)?.accepts ?? [];
    const parsed = parseMessage(body, accepts);
    if (!parsed.ok) return { ok: false, err: parsed.err };
    const s = this.entry(sessionId);
    if (s.messages.filter((m) => m.result === null).length >= RESPOND_LIMITS.deliveries) {
      return { ok: false, err: { status: 429, error: `at most ${RESPOND_LIMITS.deliveries} messages can wait for one session` } };
    }
    const delivery: Delivery = { id: newId(), askId: null, by, at: this.now(), ...parsed.fields };
    s.messages.push({ d: delivery, byKey: nameKey(by), result: null, handedOver: false });
    this.feed?.add(sessionId, null, delivery.id, { at: delivery.at, text: feedText(delivery, null), by, note: null });
    return { ok: true, delivery };
  }

  /** The messages and commands for the reply to a report: not yet given a result, oldest first. Marks them handed over. */
  deliveriesFor(sessionId: string): Delivery[] {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    return s.messages
      .filter((m) => m.result === null)
      .slice(0, RESPOND_LIMITS.deliveries)
      .map((m) => {
        m.handedOver = true;
        return m.d;
      });
  }

  /** The mod says what became of a delivery: 'new' for a result not yet recorded, 'repeat' for one it already has (#330), 'unknown' for a delivery the server no longer holds. */
  result(sessionId: string, deliveryId: string, result: DeliveryResult): 'new' | 'repeat' | 'unknown' {
    const s = this.sessions.get(sessionId);
    if (!s) return 'unknown';
    const msg = s.messages.find((m) => m.d.id === deliveryId);
    if (msg) {
      if (msg.result === result) return 'repeat'; // a retry of what is already recorded (#327)
      msg.result = result;
      this.trail({ kind: 'result', sessionId, delivery: msg.d, result });
      if (result === 'refused' || result === 'closed') this.feed?.remove(sessionId, deliveryId);
      else this.feed?.update(sessionId, deliveryId, noteFor(msg.d, null, result));
      // A message with its final result is done; keep only those still waiting for one.
      s.messages = s.messages.filter((m) => m.result === null || m.result === 'queued');
      return 'new';
    }
    const e = [...s.asks.values()].find((a) => a.delivery?.d.id === deliveryId);
    if (!e || !e.delivery) return 'unknown';
    const d = e.delivery;
    if (d.result === result) return 'repeat'; // a retry of what is already recorded (#327)
    d.result = result;
    this.trail({ kind: 'result', sessionId, delivery: d.d, result });
    if (result === 'took') {
      if (!e.closed || e.closed.implicit) e.closed = { outcome: 'podium', at: this.now(), by: d.d.by, answer: null, planApproved: d.d.kind === 'plan-approve', implicit: false };
      this.wake(sessionId, e.ask.id, { kind: 'closed', outcome: 'podium' });
    } else if (result === 'refused') {
      // The session would not take it, so the ask is open to an answer again, from the terminal or from here.
      e.delivery = null;
      this.feed?.remove(sessionId, deliveryId);
    } else if (result === 'closed' || result === 'not-taken') {
      // It never reached Claude (closed first, or an approval Claude Code didn't take), so the feed doesn't claim it.
      this.feed?.remove(sessionId, deliveryId);
    }
    this.onChange(sessionId);
    return 'new';
  }

  /** "Discard my answer": drops an answer or message the mod has not been handed yet. */
  discard(deliveryId: string, viewer: string, admin: boolean): 'ok' | 'handed-over' | 'unknown' | 'forbidden' {
    for (const [sid, s] of this.sessions) {
      const mi = s.messages.findIndex((m) => m.d.id === deliveryId);
      const ask = [...s.asks.values()].find((a) => a.delivery?.d.id === deliveryId);
      const d = mi >= 0 ? s.messages[mi]! : ask?.delivery;
      if (!d) continue;
      if (!admin && d.byKey !== nameKey(viewer)) return 'forbidden';
      if (d.handedOver || d.result !== null) return 'handed-over';
      if (mi >= 0) s.messages.splice(mi, 1);
      else if (ask) ask.delivery = null;
      this.feed?.remove(sid, deliveryId);
      this.trail({ kind: 'dropped', sessionId: sid, delivery: d.d, why: 'discarded', by: viewer });
      this.onChange(sid);
      return 'ok';
    }
    return 'unknown';
  }
}

function stateOf(e: AskEntry): AskState {
  if (e.closed) return 'closed';
  const d = e.delivery;
  if (d?.result === 'not-taken') return 'not-taken';
  if (d && d.result !== 'refused') return 'pending';
  return 'open';
}

type Parsed = { ok: true; fields: Omit<Delivery, 'id' | 'askId' | 'by' | 'at'> } | { ok: false; err: AnswerError };

const bad = (error: string, path: string): Parsed => ({ ok: false, err: { status: 400, error, path } });
const notAccepted = (kind: string): Parsed => ({ ok: false, err: { status: 422, error: 'not accepted', kind } });

/** Checks an answer from the browser against its ask and what the session takes (7.7). Nothing over a limit is cut: it is refused. */
export function parseAnswer(body: unknown, ask: Ask, accepts: readonly RespondKind[]): Parsed {
  if (!isObj(body)) return bad('expected an object', '$');
  const kind = body.kind;
  if (kind === 'reply') {
    if (!accepts.includes(REPLY_NEEDS[ask.kind])) return notAccepted('reply');
    const text = cleanText(body.text, RESPOND_LIMITS.message);
    if (text === null || !text.trim()) return bad(`expected a message of 1 to ${RESPOND_LIMITS.message} characters`, '$.text');
    return { ok: true, fields: { kind, text } };
  }
  if (typeof kind !== 'string' || !(kind in NEEDS)) return bad('expected kind question, reply, plan-approve, plan-feedback, allow-once or deny', '$.kind');
  const need = NEEDS[kind as keyof typeof NEEDS];
  if (need.ask !== ask.kind || !accepts.includes(need.kind)) return notAccepted(kind);
  switch (kind) {
    case 'question': {
      const qs = ask.questions ?? [];
      if (!Array.isArray(body.answers) || body.answers.length !== qs.length) return bad(`expected ${qs.length} answers, one per question`, '$.answers');
      const answers: QuestionAnswer[] = [];
      for (const [i, a] of (body.answers as unknown[]).entries()) {
        const p = `$.answers[${i}]`;
        const q = qs[i]!;
        if (a === null) answers.push(null);
        else if (isObj(a) && 'text' in a) {
          const t = cleanText(a.text, RESPOND_LIMITS.answer);
          if (t === null || !t.trim()) return bad(`expected an answer of 1 to ${RESPOND_LIMITS.answer} characters`, `${p}.text`);
          answers.push({ text: t });
        } else if (isObj(a) && Array.isArray(a.options)) {
          const opts = a.options as unknown[];
          if (!opts.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < q.options.length)) return bad('an option index is out of range', `${p}.options`);
          if (new Set(opts).size !== opts.length) return bad('an option is chosen twice', `${p}.options`);
          if (opts.length === 0 || (!q.multiSelect && opts.length !== 1)) return bad(q.multiSelect ? 'choose at least one option' : 'choose exactly one option', `${p}.options`);
          answers.push({ options: [...(opts as number[])].sort((x, y) => x - y) });
        } else return bad('expected options, text or null', p);
      }
      if (answers.every((a) => a === null)) return bad('answer at least one question', '$.answers');
      return { ok: true, fields: { kind, answers } };
    }
    case 'plan-approve': {
      if (typeof body.mode !== 'string' || !(PLAN_MODES as readonly string[]).includes(body.mode)) return bad('expected mode auto, acceptEdits or default', '$.mode');
      return { ok: true, fields: { kind, mode: body.mode as PlanMode } };
    }
    case 'plan-feedback': {
      const text = body.text === undefined ? '' : cleanText(body.text, RESPOND_LIMITS.message);
      if (text === null) return bad(`expected feedback of at most ${RESPOND_LIMITS.message} characters`, '$.text');
      return { ok: true, fields: { kind, text } };
    }
    case 'allow-once':
      // The person could not see all of what they would allow (7.7). Deny still works.
      if (ask.tool?.cut) return notAccepted('allow-once');
      return { ok: true, fields: { kind } };
    default: {
      const text = body.text === undefined ? '' : cleanText(body.text, RESPOND_LIMITS.answer);
      if (text === null) return bad(`expected a reason of at most ${RESPOND_LIMITS.answer} characters`, '$.text');
      return { ok: true, fields: { kind: 'deny', text } };
    }
  }
}

/** The command a typed text names, or what it would be refused with. `/clear` and `/compact` only (7.1). */
export function commandOf(text: string): { command: PodiumCommand } | { refused: string } | null {
  const t = text.trim();
  if (!t.startsWith('/')) return null;
  const name = t.slice(1).split(/\s/)[0] ?? '';
  if (name === 'clear' || name === 'compact') {
    if (t === `/${name}`) return { command: name };
    return { refused: `/${name} takes nothing after it from here. Send /${name} on its own, or use the terminal.` };
  }
  return { refused: `/${name} runs only in the terminal. From here you can send /clear and /compact.` };
}

/** Checks a new message or command from the browser. */
export function parseMessage(body: unknown, accepts: readonly RespondKind[]): Parsed {
  if (!isObj(body)) return bad('expected an object', '$');
  if (body.command !== undefined) {
    if (body.command !== 'clear' && body.command !== 'compact') return bad('/clear and /compact are the only commands', '$.command');
    if (!accepts.includes('command')) return notAccepted('command');
    return { ok: true, fields: { kind: 'command', command: body.command } };
  }
  const text = cleanText(body.text, RESPOND_LIMITS.message);
  if (text === null || !text.trim()) return bad(`expected a message of 1 to ${RESPOND_LIMITS.message} characters`, '$.text');
  const cmd = commandOf(text);
  if (cmd && 'refused' in cmd) return bad(cmd.refused, '$.text');
  if (cmd) {
    if (!accepts.includes('command')) return notAccepted('command');
    return { ok: true, fields: { kind: 'command', command: cmd.command } };
  }
  if (!accepts.includes('message')) return notAccepted('message');
  return { ok: true, fields: { kind: 'message', text } };
}

