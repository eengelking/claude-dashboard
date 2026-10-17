// Responding to a waiting session from Podium (#206): the in-memory store, and the routes for the mod and the browser.
import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { PeopleStore } from './people.js';
import { createFleetRouter } from './routes.js';
import { createLogger, type Logger } from '../logging/logger.js';
import { createAdminRouter } from '../admin/adminRouter.js';
import { Lockout } from './lockout.js';
import { createRespondBridge } from './respondBridge.js';
import { CLOSED_KEEP_MS, RespondStore, commandOf, parseAnswer, questionSummary } from './respond.js';
import { DELIVERY_RESULTS, MAIN_LOOP, RESPOND_LIMITS, type Ask, type Report, type RespondKind } from './protocol.js';
import { fixtureReport } from './testing.js';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

const T0 = 1_800_000_000_000;
const ALL: RespondKind[] = ['question', 'message', 'plan-approve', 'plan-feedback', 'permission', 'command'];

const QUESTION: Ask = {
  id: 'toolu_q',
  kind: 'question',
  agentId: null,
  openedAt: T0,
  questions: [
    { question: 'Page size?', header: 'Page size', multiSelect: false, options: [{ label: '25/50/100', description: 'a', preview: null }, { label: 'Fixed 50', description: 'b', preview: null }] },
    { question: 'Back restores?', header: 'Back state', multiSelect: true, options: [{ label: 'Page', description: '', preview: null }, { label: 'Rows', description: '', preview: null }, { label: 'Scroll', description: '', preview: null }] },
  ],
};
const PLAN: Ask = { id: 'toolu_p', kind: 'plan', agentId: null, openedAt: T0, plan: { text: '# Plan\n\n1. Page it', filePath: '/Users/ed/.claude/plans/x.md' } };
const TOOL: Ask = { id: 'toolu_t', kind: 'permission', agentId: null, openedAt: T0, tool: { name: 'Bash', input: { command: 'git push -u origin main' }, cut: false } };

/** A store with one session whose report says it takes everything. */
function store(accepts: RespondKind[] = ALL) {
  let now = T0;
  const changes: string[] = [];
  const feed: string[] = [];
  const s = new RespondStore(
    () => now,
    (sid) => changes.push(sid),
    { add: (_sid, _loop, ref, e) => feed.push(`add ${ref} ${e.text} ${e.by}${e.note ? ` ${e.note}` : ''}`), update: (_sid, ref, note) => feed.push(`update ${ref} ${note}`), remove: (_sid, ref) => feed.push(`remove ${ref}`) },
  );
  const r = fixtureReport();
  r.sentAt = T0;
  r.session.respond = { level: 'everything', accepts, limits: [] };
  s.noteReport(r, true);
  return { s, sid: r.session.id, changes, feed, tick: (ms: number) => (now += ms) };
}

describe('RespondStore', () => {
  it('announces an ask and lists it without its content', () => {
    const { s, sid } = store();
    expect(s.announce(sid, QUESTION)).toBe('ok');
    expect(s.summaries(sid)).toEqual([{ id: 'toolu_q', kind: 'question', agentId: null, openedAt: T0, count: 2, state: 'open' }]);
    expect(s.detail(sid, 'toolu_q', 'Ed', 5)).toMatchObject({ ask: QUESTION, state: 'open', delivery: null, closed: null, lastSeenAt: 5 });
  });

  it('takes the first answer only, and refuses a later one with who answered and when', () => {
    const { s, sid, feed } = store();
    s.announce(sid, QUESTION);
    const first = s.answer(sid, 'toolu_q', 'Alex', { kind: 'question', answers: [{ options: [1] }, { options: [2, 0] }] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.delivery).toMatchObject({ askId: 'toolu_q', by: 'Alex', kind: 'question', answers: [{ options: [1] }, { options: [0, 2] }] });
    expect(feed).toEqual([`add ${first.delivery.id} answered: Fixed 50; Page, Scroll Alex`]);
    expect(s.answer(sid, 'toolu_q', 'Ed', { kind: 'question', answers: [{ options: [0] }, null] })).toEqual({ ok: false, err: { status: 409, error: 'answered', by: 'Alex', at: T0 } });
    expect(s.detail(sid, 'toolu_q', 'ed', 0)?.delivery).toMatchObject({ by: 'Alex', mine: false, result: null, handedOver: false });
    expect(s.summaries(sid)[0]!.state).toBe('pending');
  });

  it('refuses an answer to a closed ask with how and when it closed', () => {
    const { s, sid } = store();
    s.announce(sid, QUESTION);
    s.close(sid, 'toolu_q', { outcome: 'terminal', at: T0 + 5, answer: '25/50/100; Page' });
    expect(s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'hi' })).toEqual({ ok: false, err: { status: 410, error: 'closed', outcome: 'terminal', at: T0 + 5 } });
    expect(s.detail(sid, 'toolu_q', 'Ed', 0)?.closed).toEqual({ outcome: 'terminal', at: T0 + 5, by: null, answer: '25/50/100; Page', planApproved: false });
  });

  it('hands an answer to a held request at once, or as soon as it comes, and nothing after the wait', async () => {
    const { s, sid } = store();
    s.announce(sid, QUESTION);
    expect(await s.hold(sid, 'toolu_q', 5)).toEqual({ kind: 'none' });
    const waiting = s.hold(sid, 'toolu_q', 10_000);
    expect(s.holding).toBe(1);
    const a = s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'What is a busy day?' });
    const got = await waiting;
    expect(got).toMatchObject({ kind: 'delivery', delivery: { kind: 'reply', text: 'What is a busy day?' } });
    expect(s.holding).toBe(0);
    // Handed over but with no result yet: handed over again, for a mod that lost the reply.
    expect(await s.hold(sid, 'toolu_q', 5)).toEqual(got);
    expect(a.ok && s.detail(sid, 'toolu_q', 'Ed', 0)?.delivery?.handedOver).toBe(true);
    expect(await s.hold(sid, 'nope', 5)).toEqual({ kind: 'unknown' });
  });

  it('wakes a held request when the ask closes, and drops an answer the mod was never handed', async () => {
    const { s, sid, feed } = store();
    s.announce(sid, PLAN);
    const out = s.answer(sid, 'toolu_p', 'Ed', { kind: 'plan-approve', mode: 'acceptEdits' });
    expect(feed.at(-1)).toContain('approved the plan (auto-accept edits) Ed');
    s.close(sid, 'toolu_p', { outcome: 'terminal', at: T0, planApproved: true });
    expect(out.ok && feed.at(-1)).toBe(`remove ${out.ok ? out.delivery.id : ''}`);
    expect(s.detail(sid, 'toolu_p', 'Ed', 0)).toMatchObject({ state: 'closed', delivery: { result: 'closed' }, closed: { outcome: 'terminal', planApproved: true } });
    expect(await s.hold(sid, 'toolu_p', 10_000)).toEqual({ kind: 'closed', outcome: 'terminal' });
  });

  it('drops a held request whose connection closed, so a later answer is not taken as handed over', async () => {
    const { s, sid } = store();
    s.announce(sid, QUESTION);
    const gone = new AbortController();
    const waiting = s.hold(sid, 'toolu_q', 10_000, gone.signal);
    gone.abort();
    expect(await waiting).toEqual({ kind: 'none' });
    expect(s.holding).toBe(0);
    s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'x' });
    expect(s.detail(sid, 'toolu_q', 'Ed', 0)?.delivery?.handedOver).toBe(false);
  });

  it('opens an implicitly closed ask again when a report lists it, without the answer the close dropped', () => {
    const { s, sid, changes } = store();
    s.announce(sid, QUESTION);
    expect(s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'x' }).ok).toBe(true);
    const r = fixtureReport();
    r.sentAt = T0 + 60_000;
    r.session.respond = { level: 'everything', accepts: ALL, limits: [] };
    r.session.asks = [];
    s.noteReport(r, true);
    expect(s.summaries(sid)[0]!.state).toBe('closed');
    const before = changes.length;
    r.session.asks = [QUESTION];
    s.noteReport(r, true);
    expect(changes.length).toBeGreaterThan(before);
    expect(s.summaries(sid)[0]!.state).toBe('open');
    expect(s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'y' }).ok).toBe(true);
  });

  it('closes an ask as answered from Podium once the session took the answer', () => {
    const { s, sid } = store();
    s.announce(sid, TOOL);
    const out = s.answer(sid, 'toolu_t', 'Ed', { kind: 'allow-once' });
    if (!out.ok) throw new Error('refused');
    expect(s.result(sid, out.delivery.id, 'took')).toBe('new');
    expect(s.detail(sid, 'toolu_t', 'Ed', 0)).toMatchObject({ state: 'closed', closed: { outcome: 'podium', by: 'Ed' }, delivery: { result: 'took', mine: true } });
  });

  it('keeps an approval Claude Code did not take as not-taken, open to the terminal and closed to another answer', () => {
    const { s, sid, feed } = store();
    s.announce(sid, PLAN);
    const out = s.answer(sid, 'toolu_p', 'Ed', { kind: 'plan-approve', mode: 'auto' });
    if (!out.ok) throw new Error('refused');
    s.result(sid, out.delivery.id, 'not-taken');
    expect(s.summaries(sid)[0]!.state).toBe('not-taken');
    // It never happened, so the feed doesn't keep "approved the plan" (seen live, 2026-10-15).
    expect(feed.at(-1)).toBe(`remove ${out.delivery.id}`);
    expect(s.answer(sid, 'toolu_p', 'Ed', { kind: 'plan-feedback', text: 'x' })).toMatchObject({ ok: false, err: { status: 409 } });
    s.close(sid, 'toolu_p', { outcome: 'terminal', at: T0, planApproved: true });
    expect(s.summaries(sid)[0]!.state).toBe('closed');
  });

  it('opens an ask to an answer again when the mod refused the first', () => {
    const { s, sid } = store();
    s.announce(sid, QUESTION);
    const out = s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'x' });
    if (!out.ok) throw new Error('refused');
    s.result(sid, out.delivery.id, 'refused');
    expect(s.summaries(sid)[0]!.state).toBe('open');
    expect(s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'y' }).ok).toBe(true);
  });

  it('refuses a kind the session does not take, and Allow once for a tool input that was cut off', () => {
    const { s, sid } = store(['question', 'message', 'plan-feedback']);
    s.announce(sid, PLAN);
    s.announce(sid, TOOL);
    expect(s.answer(sid, 'toolu_p', 'Ed', { kind: 'plan-approve', mode: 'auto' })).toEqual({ ok: false, err: { status: 422, error: 'not accepted', kind: 'plan-approve' } });
    expect(s.answer(sid, 'toolu_p', 'Ed', { kind: 'plan-feedback', text: 'More tests.' }).ok).toBe(true);
    expect(s.answer(sid, 'toolu_t', 'Ed', { kind: 'deny' })).toMatchObject({ ok: false, err: { status: 422 } });
    expect(parseAnswer({ kind: 'allow-once' }, { ...TOOL, tool: { ...TOOL.tool!, cut: true } }, ALL)).toEqual({ ok: false, err: { status: 422, error: 'not accepted', kind: 'allow-once' } });
    expect(parseAnswer({ kind: 'deny', text: 'Not yet.' }, { ...TOOL, tool: { ...TOOL.tool!, cut: true } }, ALL)).toEqual({ ok: true, fields: { kind: 'deny', text: 'Not yet.' } });
  });

  it('checks a question answer against its ask', () => {
    const bad = (answers: unknown) => parseAnswer({ kind: 'question', answers }, QUESTION, ALL);
    expect(bad([{ options: [0] }])).toMatchObject({ ok: false, err: { status: 400, path: '$.answers' } });
    expect(bad([{ options: [2] }, null])).toMatchObject({ ok: false, err: { path: '$.answers[0].options' } });
    expect(bad([{ options: [0, 1] }, null])).toMatchObject({ ok: false, err: { error: 'choose exactly one option' } });
    expect(bad([{ options: [0] }, { options: [1, 1] }])).toMatchObject({ ok: false, err: { error: 'an option is chosen twice' } });
    expect(bad([null, null])).toMatchObject({ ok: false, err: { error: 'answer at least one question' } });
    expect(bad([{ text: 'x'.repeat(RESPOND_LIMITS.answer + 1) }, null])).toMatchObject({ ok: false, err: { path: '$.answers[0].text' } });
    expect(bad([{ text: '50, and remember it' }, null])).toEqual({ ok: true, fields: { kind: 'question', answers: [{ text: '50, and remember it' }, null] } });
    expect(parseAnswer({ kind: 'plan-approve', mode: 'yolo' }, PLAN, ALL)).toMatchObject({ ok: false, err: { path: '$.mode' } });
    expect(parseAnswer({ kind: 'question', answers: [] }, PLAN, ALL)).toMatchObject({ ok: false, err: { status: 422 } });
    expect(questionSummary(QUESTION, [{ text: 'Mine' }, { options: [0, 1] }])).toBe('Mine; Page, Rows');
    // Claude Code marks an option "(Recommended)" in its label; the feed reads the answer as the mockup does, without it.
    const rec = { ...QUESTION, questions: [{ ...QUESTION.questions![0]!, options: [{ label: '25/50/100, default 50 (Recommended)', description: '', preview: null }, ...QUESTION.questions![0]!.options.slice(1)] }] };
    expect(questionSummary(rec, [{ options: [0] }])).toBe('25/50/100, default 50');
  });

  it('takes as closed an open ask a later report no longer lists, but not one opened since that report began', () => {
    const { s, sid } = store();
    s.announce(sid, QUESTION);
    s.announce(sid, { ...TOOL, openedAt: T0 + 9000 });
    const r = fixtureReport();
    r.sentAt = T0 + 10_000;
    r.session.asks = [];
    s.noteReport(r, true);
    expect(s.summaries(sid).map((a) => [a.id, a.state])).toEqual([['toolu_q', 'closed'], ['toolu_t', 'open']]);
    // An explicit close from the mod replaces the guess.
    s.close(sid, 'toolu_q', { outcome: 'terminal', at: T0 + 11_000, answer: 'Fixed 50' });
    expect(s.detail(sid, 'toolu_q', 'Ed', 0)?.closed).toMatchObject({ outcome: 'terminal', answer: 'Fixed 50' });
  });

  it('learns the asks a report carries after a restart, and closes them all when the session ends', () => {
    const fresh = new RespondStore(() => T0);
    const r = fixtureReport();
    r.session.asks = [QUESTION];
    fresh.noteReport(r, true);
    expect(fresh.summaries(r.session.id)).toHaveLength(1);
    fresh.noteReport(r, false);
    expect(fresh.summaries(r.session.id)).toHaveLength(1);
    fresh.noteReport({ ...r, session: { ...r.session, status: 'done' } }, true);
    expect(fresh.detail(r.session.id, 'toolu_q', 'Ed', 0)?.closed?.outcome).toBe('ended');
  });

  it('forgets a closed ask after ten minutes, or when the next ask opens', () => {
    const { s, sid, tick } = store();
    s.announce(sid, QUESTION);
    s.close(sid, 'toolu_q', { outcome: 'closed', at: T0 });
    tick(CLOSED_KEEP_MS + 1);
    s.expire();
    expect(s.summaries(sid)).toEqual([]);
    s.announce(sid, PLAN);
    s.close(sid, 'toolu_p', { outcome: 'closed', at: T0 + CLOSED_KEEP_MS });
    s.announce(sid, TOOL);
    expect(s.summaries(sid).map((a) => a.id)).toEqual(['toolu_t']);
  });

  it('forgets a closed ask once the session goes idle with no open ask (#208)', () => {
    const { s, sid, tick } = store();
    const report = (status: 'running' | 'waiting', open: Ask[] = []): Report => {
      const r = fixtureReport();
      r.session.status = status;
      r.session.asks = open;
      r.sentAt = T0 + 2000;
      return r;
    };
    s.announce(sid, QUESTION);
    tick(500);
    s.close(sid, 'toolu_q', { outcome: 'terminal', at: T0 + 500 });
    // Still the turn the ask closed in: the outcome stays readable.
    tick(1500);
    s.noteReport(report('running'), true);
    expect(s.summaries(sid).map((a) => a.id)).toEqual(['toolu_q']);
    // The turn ended and nothing is open: the outcome goes, long before ten minutes.
    s.noteReport(report('waiting'), true);
    expect(s.summaries(sid)).toEqual([]);
  });

  it('keeps a closed ask for an idle report that the session never ran between, or that predates the close (#208)', () => {
    const { s, sid, tick } = store();
    s.announce(sid, QUESTION);
    tick(500);
    s.close(sid, 'toolu_q', { outcome: 'terminal', at: T0 + 500 });
    const idle = (sentAt: number): Report => {
      const r = fixtureReport();
      r.session.status = 'waiting';
      r.session.asks = [];
      r.sentAt = sentAt;
      return r;
    };
    s.noteReport(idle(T0 + 2000), true);
    expect(s.summaries(sid).map((a) => a.id)).toEqual(['toolu_q']);
    const before = fixtureReport();
    before.session.status = 'running';
    before.session.asks = [];
    before.sentAt = T0 + 100;
    s.noteReport(before, true);
    s.noteReport(idle(T0 + 3000), true);
    expect(s.summaries(sid).map((a) => a.id)).toEqual(['toolu_q']);
  });

  it('refuses a ninth open ask', () => {
    const { s, sid } = store();
    for (let i = 0; i < RESPOND_LIMITS.asks; i++) expect(s.announce(sid, { ...QUESTION, id: `q${i}` })).toBe('ok');
    expect(s.announce(sid, { ...QUESTION, id: 'q9' })).toBe('full');
  });

  it('queues messages for the reply, notes a queued one, and caps how many wait', () => {
    const { s, sid, feed } = store();
    const m = s.message(sid, 'Ed', { text: 'Also update the user guide.' });
    if (!m.ok) throw new Error('refused');
    expect(s.deliveriesFor(sid)).toEqual([m.delivery]);
    expect(s.result(sid, m.delivery.id, 'queued')).toBe('new');
    expect(feed.at(-1)).toBe(`update ${m.delivery.id} (queued until the session is idle)`);
    expect(s.deliveriesFor(sid)).toEqual([]);
    s.result(sid, m.delivery.id, 'took');
    expect(feed.at(-1)).toBe(`update ${m.delivery.id} null`);
    for (let i = 0; i < RESPOND_LIMITS.deliveries; i++) expect(s.message(sid, 'Ed', { text: `m${i}` }).ok).toBe(true);
    expect(s.message(sid, 'Ed', { text: 'one more' })).toMatchObject({ ok: false, err: { status: 429 } });
  });

  it('takes /clear and /compact only, and refuses any other command with the mockup message', () => {
    const { s, sid } = store();
    expect(s.message(sid, 'Ed', { text: '/clear' })).toMatchObject({ ok: true, delivery: { kind: 'command', command: 'clear' } });
    expect(s.message(sid, 'Ed', { command: 'compact' })).toMatchObject({ ok: true, delivery: { kind: 'command', command: 'compact' } });
    expect(s.message(sid, 'Ed', { text: '/model haiku' })).toEqual({ ok: false, err: { status: 400, error: '/model runs only in the terminal. From here you can send /clear and /compact.', path: '$.text' } });
    expect(s.message(sid, 'Ed', { command: 'effort' })).toMatchObject({ ok: false, err: { status: 400 } });
    expect(commandOf('/clear')).toEqual({ command: 'clear' });
    // A known command with something after it gets the console's own line (decided 2026-10-15), not "runs only in the terminal".
    expect(commandOf('/clear now')).toEqual({ refused: '/clear takes nothing after it from here. Send /clear on its own, or use the terminal.' });
    expect(commandOf('/compact focus on tests')).toEqual({ refused: '/compact takes nothing after it from here. Send /compact on its own, or use the terminal.' });
    expect(commandOf('hello')).toBeNull();
    const narrow = store(['question', 'message']);
    expect(narrow.s.message(narrow.sid, 'Ed', { text: '/compact' })).toMatchObject({ ok: false, err: { status: 422, kind: 'command' } });
  });

  it('lets the sender or an Admin discard an answer the mod has not been handed', () => {
    const { s, sid } = store();
    s.announce(sid, QUESTION);
    const a = s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'x' });
    if (!a.ok) throw new Error('refused');
    expect(s.discard(a.delivery.id, 'Alex', false)).toBe('forbidden');
    expect(s.discard(a.delivery.id, 'ed', false)).toBe('ok');
    expect(s.summaries(sid)[0]!.state).toBe('open');
    const b = s.answer(sid, 'toolu_q', 'Ed', { kind: 'reply', text: 'y' });
    if (!b.ok) throw new Error('refused');
    void s.hold(sid, 'toolu_q', 5);
    expect(s.discard(b.delivery.id, 'Alex', true)).toBe('handed-over');
    expect(s.discard('dlv_nope', 'Ed', true)).toBe('unknown');
  });
});

// ---- routes ---------------------------------------------------------------------------------

const SECRET = 'admin-secret';
const H = { 'X-Podium-Respond': '1' };

function setup(opts: { secret?: string | null; respond?: boolean; onSignIn?: express.RequestHandler; logger?: Logger } = {}) {
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  const db = openDb(':memory:');
  const fleet = new Fleet(new FleetDb(db), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' });
  const people = new PeopleStore(db);
  const lockout = new Lockout(fleet.now);
  const respondBridge = createRespondBridge();
  const app = express();
  app.use('/api/fleet', createFleetRouter(fleet, { token: secret, people, lockout, respondBridge, onSignIn: opts.onSignIn, ...(opts.logger ? { logger: opts.logger } : { log: () => {} }) }));
  app.use('/api/admin', createAdminRouter({ secret, people, features: fleet.features, lockout, respondBridge, log: () => {} }));
  closers.push(() => fleet.close());
  if (opts.respond !== false) fleet.features.setFeature('respond', true);
  const ed = people.createPerson('Ed');
  const alex = people.createPerson('Alex');
  return { app, fleet, people, ed, alex };
}

/** A report from a reporter that responds at every level, carrying `asks`. */
function report(userName: string, id = 'sess-ed', asks: Ask[] = []): Report {
  const r = fixtureReport();
  r.session = { ...r.session, id, status: 'waiting', respond: { level: 'everything', accepts: ALL, limits: [] }, asks };
  r.userName = userName;
  return r;
}

async function signedIn(app: express.Express, name: string, token: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/fleet/respond/sign-in').set(H).send({ name, token });
  expect(res.status).toBe(200);
  return agent;
}

describe('the plain-HTTP note on sign-in (#306)', () => {
  it('runs ahead of the sign-in and never changes its answer', async () => {
    const seen = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
    const { app, ed } = setup({ onSignIn: seen });
    expect((await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: ed.token })).status).toBe(200);
    expect((await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: 'wrong' })).status).toBe(401);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('the switches', () => {
  it('is off with authentication off, and with either Admin flag off: the routes refuse and the reply says so', async () => {
    const off = setup({ secret: null });
    expect((await request(off.app).get('/api/fleet/respond/me')).body).toEqual({ enabled: false, signedIn: false, name: null, admin: false });
    expect((await request(off.app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: off.ed.token })).status).toBe(403);
    const r = await request(off.app).post('/api/fleet/report').send(report('Ed'));
    expect(r.body).toMatchObject({ respond: false, deliveries: [] });

    const flagOff = setup({ respond: false });
    const rep = await request(flagOff.app).post('/api/fleet/report').set('X-Podium-Token', flagOff.ed.token).send(report('Ed'));
    expect(rep.body).toMatchObject({ respond: false, deliveries: [] });
    expect((await request(flagOff.app).put('/api/fleet/sessions/sess-ed/asks/toolu_q').set('X-Podium-Token', flagOff.ed.token).send(QUESTION)).status).toBe(403);

    const feedOff = setup();
    feedOff.fleet.features.setFeature('activity-feed', false);
    expect((await request(feedOff.app).get('/api/fleet/respond/me')).body.enabled).toBe(false);
  });

  it('drops every ask and answer it held when the Respond flag goes off', async () => {
    const { app, fleet, ed } = setup();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [QUESTION]));
    expect(fleet.respond.summaries('sess-ed')).toHaveLength(1);
    fleet.features.setFeature('respond', false);
    expect(fleet.respond.summaries('sess-ed')).toEqual([]);
  });
});

describe('signing in', () => {
  it('takes a person’s name (any case) with their token, and the name Admin with the admin secret', async () => {
    const { app, ed, people } = setup();
    const agent = await signedIn(app, 'ed', ed.token);
    expect((await agent.get('/api/fleet/respond/me')).body).toEqual({ enabled: true, signedIn: true, name: 'Ed', admin: false });
    const admin = await signedIn(app, 'Admin', SECRET);
    expect((await admin.get('/api/fleet/respond/me')).body).toEqual({ enabled: true, signedIn: true, name: 'Admin', admin: true });
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_sign_in').map((r) => r.actor)).toEqual(['Admin secret', 'Ed']);
  });

  it('refuses a token with someone else’s name, never saying which was wrong, and an empty field', async () => {
    const { app, ed } = setup();
    const res = await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Alex', token: ed.token });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'wrong name or token' });
    expect((await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: SECRET })).status).toBe(401);
    expect((await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: '' })).status).toBe(400);
  });

  it('locks an address out after five wrong tries, counted together with wrong Admin unlocks', async () => {
    const { app, ed } = setup();
    for (let i = 0; i < 3; i++) expect((await request(app).post('/api/admin/unlock').set('X-Podium-Admin', '1').send({ name: 'Admin', token: 'nope' })).status).toBe(401);
    for (let i = 0; i < 2; i++) expect((await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: 'nope' })).status).toBe(401);
    const locked = await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: ed.token });
    expect(locked.status).toBe(429);
    expect(locked.body.retryAfterSec).toBeGreaterThan(0);
  });

  it('refuses a change without the header or from another origin, and sets no CORS header', async () => {
    const { app, ed } = setup();
    expect((await request(app).post('/api/fleet/respond/sign-in').send({ name: 'Ed', token: ed.token })).status).toBe(403);
    const other = await request(app).post('/api/fleet/respond/sign-in').set(H).set('Origin', 'http://evil.example').send({ name: 'Ed', token: ed.token });
    expect(other.status).toBe(403);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(other.headers['cache-control']).toBe('no-store');
  });

  it('ends a sign-in on sign-out, and when the person’s token is rotated or revoked', async () => {
    const { app, ed, people } = setup();
    const a = await signedIn(app, 'Ed', ed.token);
    await a.post('/api/fleet/respond/sign-out').set(H);
    expect((await a.get('/api/fleet/respond/me')).body.signedIn).toBe(false);
    const b = await signedIn(app, 'Ed', ed.token);
    people.rotate(ed.person.id);
    expect((await b.get('/api/fleet/respond/me')).body.signedIn).toBe(false);
  });
});

describe('answering, end to end', () => {
  it('runs a question from the mod’s announcement to the browser’s answer, the held request, and the session taking it', async () => {
    const { app, fleet, ed, people } = setup();
    const rep = await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
    expect(rep.body).toMatchObject({ respond: true, deliveries: [] });
    expect((await request(app).put('/api/fleet/sessions/sess-ed/asks/toolu_q').set('X-Podium-Token', ed.token).send(QUESTION)).status).toBe(200);
    expect(fleet.view('sess-ed')?.asks).toEqual([{ id: 'toolu_q', kind: 'question', agentId: null, openedAt: T0, count: 2, state: 'open' }]);
    expect(JSON.stringify(fleet.state())).not.toContain('Page size?');

    // The modal reads the whole ask; the mod waits for an answer.
    fleet.activity.watch('sess-ed', MAIN_LOOP, 5);
    const browser = await signedIn(app, 'Ed', ed.token);
    expect((await browser.get('/api/fleet/respond/sessions/sess-ed/asks/toolu_q')).body).toMatchObject({ ask: QUESTION, state: 'open' });
    const held = request(app).get('/api/fleet/sessions/sess-ed/asks/toolu_q/answer?wait=5').set('X-Podium-Token', ed.token).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const sent = await browser.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_q/answer').set(H).send({ kind: 'question', answers: [{ options: [0] }, { options: [1] }] });
    expect(sent.status).toBe(202);
    const got = await held;
    expect(got.status).toBe(200);
    expect(got.body.delivery).toMatchObject({ id: sent.body.deliveryId, askId: 'toolu_q', by: 'Ed', kind: 'question', answers: [{ options: [0] }, { options: [1] }] });
    expect(fleet.activity.watch('sess-ed', MAIN_LOOP, 5).entries).toEqual([expect.objectContaining({ kind: 'podium', text: 'answered: 25/50/100; Rows', by: 'Ed' })]);
    expect((await browser.get('/api/fleet/respond/sessions/sess-ed/asks/toolu_q')).body.state).toBe('pending');

    // The session took it.
    expect((await request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${sent.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result: 'took', at: T0 })).status).toBe(200);
    expect((await browser.get('/api/fleet/respond/sessions/sess-ed/asks/toolu_q')).body).toMatchObject({ state: 'closed', closed: { outcome: 'podium', by: 'Ed' } });

    // The admin log names who and what, never the text.
    const log = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_sent');
    expect(log).toEqual([expect.objectContaining({ actor: 'Ed', detail: `Answered a question in invoice-v2 (sess-ed) [${sent.body.deliveryId.slice(0, 12)}]` })]);
    expect(JSON.stringify(log)).not.toContain('25/50/100');

    // And what became of it, matched to the answer by the short id (#304).
    const result = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_result');
    expect(result).toEqual([expect.objectContaining({ actor: 'Ed', detail: `Answered a question in invoice-v2 (sess-ed) [${sent.body.deliveryId.slice(0, 12)}]: the session took it` })]);
  });

  describe('the admin log says what became of a delivery (#304)', () => {
    const WORDS: Record<string, string> = {
      took: 'the session took it',
      queued: 'the session queued it',
      'not-taken': 'the session did not take it',
      refused: 'the session refused it',
      closed: 'it had closed before the session got it',
    };

    for (const result of DELIVERY_RESULTS) {
      it(`writes respond_result for ${result}`, async () => {
        const { app, ed, people } = setup();
        await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
        const b = await signedIn(app, 'Ed', ed.token);
        const m = await b.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: 'secret words about issue #205' });
        await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
        const post = await request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${m.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result });
        expect(post.status).toBe(200);
        const rows = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_result');
        expect(rows).toEqual([expect.objectContaining({ actor: 'Ed', detail: `Sent a message in invoice-v2 (sess-ed) [${m.body.deliveryId.slice(0, 12)}]: ${WORDS[result]}` })]);
        expect(JSON.stringify(people.listLog({ page: 1, pageSize: 50 }).rows)).not.toContain('secret words');
      });
    }

    it('names the admin secret as the actor for a delivery Admin sent', async () => {
      const { app, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', SECRET).send({ ...report('Admin'), userName: 'Admin' });
      const admin = await signedIn(app, 'Admin', SECRET);
      const m = await admin.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: 'hello' });
      await request(app).post('/api/fleet/report').set('X-Podium-Token', SECRET).send({ ...report('Admin'), userName: 'Admin' });
      await request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${m.body.deliveryId}/result`).set('X-Podium-Token', SECRET).send({ result: 'took' });
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'respond_result')?.actor).toBe('Admin secret');
    });

    it('writes one respond_result row when the mod posts the same result for an answer twice (#327)', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [TOOL]));
      const b = await signedIn(app, 'Ed', ed.token);
      const sent = await b.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_t/answer').set(H).send({ kind: 'allow-once' });
      const post = () => request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${sent.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result: 'took' });
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_result')).toHaveLength(1);
    });

    it('writes one respond_result row when the mod posts queued twice for a message (#327)', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
      const b = await signedIn(app, 'Ed', ed.token);
      const m = await b.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: 'hello' });
      const post = (result: string) => request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${m.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result });
      expect((await post('queued')).status).toBe(200);
      expect((await post('queued')).status).toBe(200);
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_result')).toHaveLength(1);
    });

    it('still writes a row for each different result of one message, queued and then took (#327)', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
      const b = await signedIn(app, 'Ed', ed.token);
      const m = await b.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: 'hello' });
      for (const result of ['queued', 'took']) {
        expect((await request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${m.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result })).status).toBe(200);
      }
      const rows = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_result');
      expect(rows.map((r) => r.detail.split(': ')[1]).sort()).toEqual(['the session queued it', 'the session took it']);
    });

    it('logs respond.delivered once when the mod posts the same result twice, and answers 200 both times (#330)', async () => {
      const lines: string[] = [];
      const { app, ed } = setup({ logger: createLogger({ format: 'json', write: (l) => lines.push(l) }) });
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [TOOL]));
      const b = await signedIn(app, 'Ed', ed.token);
      const sent = await b.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_t/answer').set(H).send({ kind: 'allow-once' });
      const post = (result: string) => request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${sent.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result });
      expect((await post('took')).status).toBe(200);
      expect((await post('took')).status).toBe(200);
      const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.event === 'respond.delivered');
      expect(events()).toHaveLength(1);
      expect(events()[0]).toMatchObject({ result: 'took' });
    });

    it('logs respond.delivered for each different result of one message (#330)', async () => {
      const lines: string[] = [];
      const { app, ed } = setup({ logger: createLogger({ format: 'json', write: (l) => lines.push(l) }) });
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
      const b = await signedIn(app, 'Ed', ed.token);
      const m = await b.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: 'hello' });
      for (const result of ['queued', 'queued', 'took']) {
        expect((await request(app).post(`/api/fleet/sessions/sess-ed/deliveries/${m.body.deliveryId}/result`).set('X-Podium-Token', ed.token).send({ result })).status).toBe(200);
      }
      const got = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.event === 'respond.delivered').map((e) => e.result);
      expect(got).toEqual(['queued', 'took']);
    });

    it('writes no row for a result the server does not hold a delivery for', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
      const r = await request(app).post('/api/fleet/sessions/sess-ed/deliveries/dlv_nope/result').set('X-Podium-Token', ed.token).send({ result: 'took' });
      expect(r.status).toBe(404);
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.filter((x) => x.kind === 'respond_result')).toEqual([]);
    });

    it('writes respond_dropped when the sender discards an answer before the session has it', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [TOOL]));
      const b = await signedIn(app, 'Ed', ed.token);
      const sent = await b.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_t/answer').set(H).send({ kind: 'allow-once' });
      expect(sent.status).toBe(202);
      expect((await b.delete(`/api/fleet/respond/deliveries/${sent.body.deliveryId}`).set(H)).status).toBe(200);
      const rows = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_dropped');
      expect(rows).toEqual([expect.objectContaining({ actor: 'Ed', detail: `Allowed a tool once in invoice-v2 (sess-ed) [${sent.body.deliveryId.slice(0, 12)}]: discarded by its sender, so it never reached the session` })]);
    });

    it('writes respond_dropped when the terminal closes the ask before the session has the answer', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [TOOL]));
      const b = await signedIn(app, 'Ed', ed.token);
      const sent = await b.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_t/answer').set(H).send({ kind: 'deny' });
      await request(app).post('/api/fleet/sessions/sess-ed/asks/toolu_t/close').set('X-Podium-Token', ed.token).send({ outcome: 'terminal', answer: 'allowed', at: T0 });
      const rows = people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_dropped');
      expect(rows).toEqual([expect.objectContaining({ actor: 'Ed', detail: `Denied a tool in invoice-v2 (sess-ed) [${sent.body.deliveryId.slice(0, 12)}]: the ask closed first, so it never reached the session` })]);
    });

    it('writes no dropped row for an answer the session already has', async () => {
      const { app, ed, people } = setup();
      await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [TOOL]));
      const b = await signedIn(app, 'Ed', ed.token);
      await b.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_t/answer').set(H).send({ kind: 'deny' });
      await request(app).get('/api/fleet/sessions/sess-ed/asks/toolu_t/answer?wait=1').set('X-Podium-Token', ed.token);
      await request(app).post('/api/fleet/sessions/sess-ed/asks/toolu_t/close').set('X-Podium-Token', ed.token).send({ outcome: 'terminal', answer: 'allowed', at: T0 });
      expect(people.listLog({ page: 1, pageSize: 50 }).rows.filter((r) => r.kind === 'respond_dropped')).toEqual([]);
    });
  });

  it('refuses a second answer, an answer to a closed ask, someone else’s session, and no sign-in', async () => {
    const { app, ed, alex } = setup();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [QUESTION, TOOL]));
    const edB = await signedIn(app, 'Ed', ed.token);
    const alexB = await signedIn(app, 'Alex', alex.token);
    const alexTry = await alexB.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_q/answer').set(H).send({ kind: 'reply', text: 'hi' });
    expect(alexTry.status).toBe(403);
    expect(alexTry.body).toEqual({ ok: false, error: 'not your session', owner: 'Ed' });
    expect((await request(app).post('/api/fleet/respond/sessions/sess-ed/asks/toolu_q/answer').set(H).send({ kind: 'reply', text: 'hi' })).status).toBe(403);
    expect((await edB.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_q/answer').set(H).send({ kind: 'reply', text: 'hi' })).status).toBe(202);
    const admin = await signedIn(app, 'Admin', SECRET);
    const second = await admin.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_q/answer').set(H).send({ kind: 'reply', text: 'me too' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'answered', by: 'Ed' });
    await request(app).post('/api/fleet/sessions/sess-ed/asks/toolu_t/close').set('X-Podium-Token', ed.token).send({ outcome: 'terminal', answer: 'allowed', at: T0 });
    const late = await edB.post('/api/fleet/respond/sessions/sess-ed/asks/toolu_t/answer').set(H).send({ kind: 'deny' });
    expect(late.status).toBe(410);
    expect(late.body).toMatchObject({ error: 'closed', outcome: 'terminal' });
  });

  it('lets only the session’s own credential announce or wait, and refuses no token', async () => {
    const { app, alex, ed } = setup();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
    expect((await request(app).put('/api/fleet/sessions/sess-ed/asks/toolu_q').send(QUESTION)).status).toBe(401);
    expect((await request(app).put('/api/fleet/sessions/sess-ed/asks/toolu_q').set('X-Podium-Token', alex.token).send(QUESTION)).status).toBe(403);
    expect((await request(app).put('/api/fleet/sessions/sess-ed/asks/other').set('X-Podium-Token', ed.token).send(QUESTION)).status).toBe(400);
    expect((await request(app).get('/api/fleet/sessions/sess-ed/asks/toolu_q/answer?wait=1').set('X-Podium-Token', alex.token)).status).toBe(403);
    expect((await request(app).get('/api/fleet/sessions/sess-ed/asks/toolu_q/answer?wait=1').set('X-Podium-Token', ed.token)).status).toBe(404);
  });

  it('hands messages over in the reply to a report, and refuses one the session does not take', async () => {
    const { app, ed } = setup();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
    const b = await signedIn(app, 'Ed', ed.token);
    const m = await b.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: 'Start on issue #205.' });
    expect(m.status).toBe(202);
    expect(m.body).toMatchObject({ ok: true, queued: false });
    const reply = await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed'));
    expect(reply.body.deliveries).toEqual([expect.objectContaining({ id: m.body.deliveryId, kind: 'message', text: 'Start on issue #205.', by: 'Ed', askId: null })]);
    expect((await b.post('/api/fleet/respond/sessions/sess-ed/messages').set(H).send({ text: '/effort low' })).body.error).toBe('/effort runs only in the terminal. From here you can send /clear and /compact.');
    expect((await b.delete(`/api/fleet/respond/deliveries/${m.body.deliveryId}`).set(H)).status).toBe(409);
  });

  it('serves the whole ask only to its owner or an Admin', async () => {
    const { app, ed, alex } = setup();
    await request(app).post('/api/fleet/report').set('X-Podium-Token', ed.token).send(report('Ed', 'sess-ed', [PLAN]));
    const alexB = await signedIn(app, 'Alex', alex.token);
    expect((await alexB.get('/api/fleet/respond/sessions/sess-ed/asks/toolu_p')).status).toBe(403);
    const admin = await signedIn(app, 'Admin', SECRET);
    expect((await admin.get('/api/fleet/respond/sessions/sess-ed/asks/toolu_p')).body.ask.plan.text).toBe('# Plan\n\n1. Page it');
  });
});

describe('opening Admin from a sign-in to respond (#215)', () => {
  const AH = { 'X-Podium-Admin': '1' };

  it('scopes the sign-in cookie to /api so the Admin routes receive it', async () => {
    const { app, ed } = setup();
    const res = await request(app).post('/api/fleet/respond/sign-in').set(H).send({ name: 'Ed', token: ed.token });
    expect(String(res.headers['set-cookie'])).toMatch(/podium_respond=[^;]+; Path=\/api;/);
  });

  it('opens Admin, with no second sign-in, for an Administrator signed in to respond', async () => {
    const { app, people } = setup();
    const admins = people.allGroups().find((g) => g.name === 'Administrators')!;
    const priya = people.createPerson('Priya', admins.id);
    const agent = await signedIn(app, 'Priya', priya.token);
    expect((await agent.get('/api/admin/people').set(AH)).status).toBe(401);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
    expect((await agent.get('/api/admin/people').set(AH)).status).toBe(200);
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'unlock')?.actor).toBe('Priya');
  });

  it('opens Admin for the admin secret signed in as Admin', async () => {
    const { app, people } = setup();
    const agent = await signedIn(app, 'Admin', SECRET);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
    expect(people.listLog({ page: 1, pageSize: 50 }).rows.find((r) => r.kind === 'unlock')?.actor).toBe('Admin secret');
  });

  it('refuses an ordinary person, and a browser that is not signed in', async () => {
    const { app, ed } = setup();
    const agent = await signedIn(app, 'Ed', ed.token);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(401);
    expect((await agent.get('/api/admin/people').set(AH)).status).toBe(401);
    expect((await request(app).post('/api/admin/unlock/from-respond').set(AH)).status).toBe(401);
  });

  it('stays locked after an explicit Lock Admin, until the person unlocks with a name and token or signs in again (#272)', async () => {
    const { app, people } = setup();
    const admins = people.allGroups().find((g) => g.name === 'Administrators')!;
    const priya = people.createPerson('Priya', admins.id);
    const agent = await signedIn(app, 'Priya', priya.token);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
    expect((await agent.post('/api/admin/lock').set(AH)).status).toBe(200);
    // A reload tries from-respond again and is refused, so it shows the sign-in.
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(401);
    expect((await agent.get('/api/admin/people').set(AH)).status).toBe(401);
    // The console sign-in itself stands.
    expect((await agent.get('/api/fleet/respond/me')).body.signedIn).toBe(true);
    // Typing the name and token opens Admin and lifts the hold, so the idle lock lets the person back in as before.
    expect((await agent.post('/api/admin/unlock').set(AH).send({ name: 'Priya', token: priya.token })).status).toBe(200);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
  });

  it('keeps the hold when a different Administrator unlocks Admin with their own name and token in that browser (#272)', async () => {
    const { app, people } = setup();
    const admins = people.allGroups().find((g) => g.name === 'Administrators')!;
    const priya = people.createPerson('Priya', admins.id);
    const quinn = people.createPerson('Quinn', admins.id);
    const agent = await signedIn(app, 'Priya', priya.token);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
    expect((await agent.post('/api/admin/lock').set(AH)).status).toBe(200);
    expect((await agent.post('/api/admin/unlock').set(AH).send({ name: 'Quinn', token: quinn.token })).status).toBe(200);
    // Priya's console sign-in must not reopen Admin as Priya just because Quinn typed a token.
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(401);
  });

  it('lets a new sign-in to respond open Admin again after Lock Admin (#272)', async () => {
    const { app, people } = setup();
    const admins = people.allGroups().find((g) => g.name === 'Administrators')!;
    const priya = people.createPerson('Priya', admins.id);
    const agent = await signedIn(app, 'Priya', priya.token);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
    expect((await agent.post('/api/admin/lock').set(AH)).status).toBe(200);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(401);
    expect((await agent.post('/api/fleet/respond/sign-in').set(H).send({ name: 'Priya', token: priya.token })).status).toBe(200);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
  });

  it('does not hold another browser signed in as the same Administrator (#272)', async () => {
    const { app, people } = setup();
    const admins = people.allGroups().find((g) => g.name === 'Administrators')!;
    const priya = people.createPerson('Priya', admins.id);
    const laptop = await signedIn(app, 'Priya', priya.token);
    const desk = await signedIn(app, 'Priya', priya.token);
    expect((await laptop.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
    expect((await laptop.post('/api/admin/lock').set(AH)).status).toBe(200);
    expect((await desk.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(200);
  });

  it('refuses once the person has left Administrators, and without the Admin header', async () => {
    const { app, people } = setup();
    const admins = people.allGroups().find((g) => g.name === 'Administrators')!;
    const priya = people.createPerson('Priya', admins.id);
    const agent = await signedIn(app, 'Priya', priya.token);
    expect((await agent.post('/api/admin/unlock/from-respond')).status).toBe(403);
    people.setGroup(priya.person.id, null);
    expect((await agent.post('/api/admin/unlock/from-respond').set(AH)).status).toBe(401);
  });
});
