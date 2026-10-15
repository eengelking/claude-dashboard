// Routes for responding to a waiting session from Podium (#206, SPEC 7.1, 7.7), mounted on the fleet router.
//
// Two sides. The mod's routes (announce an ask, wait for an answer, say an ask closed, say what became of a delivery)
// take X-Podium-Token, checked as for a report, and the credential must own the session. The browser's routes live
// under /respond and need a sign-in: a name and a token, the same pair as the reporter's userName and token options,
// or Admin with the admin secret. A sign-in is a random id in an HttpOnly, SameSite=Strict cookie scoped to
// /api/fleet/respond, held in memory only. Every change needs X-Podium-Respond: 1 and, when an Origin is sent, this
// server's own host; no CORS is offered. Nothing here logs or stores the text of an answer, a question or a plan.
import { randomBytes } from 'node:crypto';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Fleet } from './fleet.js';
import type { Identity } from './routes.js';
import { ADMIN_OWNER, ADMIN_SECRET_ACTOR, nameKey, sourceAddress, type PeopleStore } from './people.js';
import { parsePersonToken, safeEqualStr, tokenMatches } from './tokens.js';
import type { Lockout } from './lockout.js';
import { logWords, type AnswerError } from './respond.js';
import { DELIVERY_RESULTS, RESPOND_LIMITS, validateAsk, type AskCloseOutcome, type Delivery, type DeliveryResult, type RespondMe } from './protocol.js';
import type { Logger } from '../logging/logger.js';
import type { SessionRow } from './db.js';

export interface RespondDeps {
  fleet: Fleet;
  /** The admin secret; null when authentication is off, and responding with it. */
  token: string | null;
  people: PeopleStore | null;
  logger: Logger;
  lockout: Lockout;
  requireToken: RequestHandler;
  identityOf: (res: Response) => Identity;
  /** Idle time before a sign-in ends. */
  signInIdleMs?: number;
}

const COOKIE = 'podium_respond';
const COOKIE_PATH = '/api/fleet/respond';
const SIGN_IN_IDLE_MS = 12 * 3600_000;
const MAX_SIGN_INS = 200;
const BODY_LIMIT = '64kb';
const CLOSE_OUTCOMES: readonly AskCloseOutcome[] = ['terminal', 'closed', 'ended'];

/** A browser's sign-in: the person (null for the admin secret) and their token's hash when it began, so a rotation ends it. */
interface SignIn {
  personId: number | null;
  tokenHash: string | null;
  last: number;
}

/** Who a signed-in browser is, worked out afresh on each request. */
interface Viewer {
  /** As deliveries and the feed name the sender: a person's name, or `Admin`. */
  name: string;
  /** As the admin log names the actor: a person's name, or `Admin secret`. */
  actor: string;
  admin: boolean;
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const sourceOf = (req: Request): string => sourceAddress(req.ip);

/** Whether a mod's credential owns the session: a person's token their own sessions, the admin secret those owned by Admin. */
function credentialOwns(id: Identity, row: SessionRow): boolean {
  if (row.owner === null) return false;
  if (id.kind === 'person') return nameKey(id.person.name) === nameKey(row.owner);
  return id.kind === 'admin' && row.owner === ADMIN_OWNER;
}

/** Whether a signed-in viewer may respond to a session: its owner, or an Admin. A session owned by Admin needs an Admin. */
function viewerOwns(v: Viewer, row: SessionRow): boolean {
  if (v.admin) return true;
  return row.owner !== null && row.owner !== ADMIN_OWNER && nameKey(row.owner) === nameKey(v.name);
}

function answerError(res: Response, err: AnswerError): void {
  const { status, ...body } = err;
  res.status(status).json({ ok: false, ...body });
}

export function mountRespondRoutes(router: Router, d: RespondDeps): void {
  const { fleet, people, logger, lockout } = d;
  const now = fleet.now;
  const idleMs = d.signInIdleMs ?? SIGN_IN_IDLE_MS;
  const signIns = new Map<string, SignIn>();
  const json = express.json({ limit: BODY_LIMIT });

  /** Authentication on, and both of the Admin's flags. The reporter's own switches are the mod's to check. */
  const enabled = (): boolean => d.token !== null && fleet.respondFlagsOn();

  const refuse = (req: Request, res: Response, status: number, reason: string, extra: Record<string, unknown> = {}) => {
    logger.warn('respond.refused', `podium: refused ${req.method} ${req.baseUrl}${req.path} from ${sourceOf(req)}: ${reason}`, { status, reason, source: sourceOf(req), session_id: req.params.id ?? null });
    res.status(status).json({ ok: false, error: reason, ...extra });
  };

  // ---- the mod's side ---------------------------------------------------------------------------

  /** The session a mod route is about, when responding is on and the credential owns it; otherwise answers and returns null. */
  const modSession = (req: Request, res: Response): SessionRow | null => {
    if (!enabled()) {
      refuse(req, res, 403, 'responding is off');
      return null;
    }
    const row = fleet.db.getSession(req.params.id!);
    if (!row || !fleet.isLive(row.id)) {
      res.status(404).json({ ok: false, error: 'unknown session', path: '$.id' });
      return null;
    }
    if (!credentialOwns(d.identityOf(res), row)) {
      refuse(req, res, 403, 'not your session');
      return null;
    }
    return row;
  };

  router.put('/sessions/:id/asks/:askId', d.requireToken, express.json({ limit: '512kb' }), (req, res) => {
    const row = modSession(req, res);
    if (!row) return;
    const v = validateAsk(req.body);
    if (!v.ok) {
      res.status(400).json({ ok: false, error: v.error, path: v.path });
      return;
    }
    if (v.ask.id !== req.params.askId) {
      res.status(400).json({ ok: false, error: 'the ask id must match the path', path: '$.id' });
      return;
    }
    const out = fleet.respond.announce(row.id, v.ask);
    if (out === 'closed') res.status(409).json({ ok: false, error: 'closed' });
    else if (out === 'full') res.status(429).json({ ok: false, error: `at most ${RESPOND_LIMITS.asks} open asks per session` });
    else res.json({ ok: true });
  });

  router.get('/sessions/:id/asks/:askId/answer', d.requireToken, async (req, res) => {
    const row = modSession(req, res);
    if (!row) return;
    const raw = typeof req.query.wait === 'string' && /^\d{1,3}$/.test(req.query.wait) ? Number(req.query.wait) : RESPOND_LIMITS.holdSeconds;
    const wait = Math.max(1, Math.min(RESPOND_LIMITS.holdSeconds, raw));
    res.set('Cache-Control', 'no-store');
    const out = await fleet.respond.hold(row.id, req.params.askId!, wait * 1000);
    if (res.writableEnded || res.destroyed) return;
    if (out.kind === 'delivery') res.json({ delivery: out.delivery });
    else if (out.kind === 'none') res.status(204).end();
    else if (out.kind === 'unknown') res.status(404).json({ ok: false, error: 'unknown ask' });
    else res.status(410).json({ ok: false, error: 'closed', outcome: out.outcome });
  });

  router.post('/sessions/:id/asks/:askId/close', d.requireToken, json, (req, res) => {
    const row = modSession(req, res);
    if (!row) return;
    const b = req.body as Record<string, unknown> | undefined;
    const outcome = b?.outcome;
    if (typeof outcome !== 'string' || !(CLOSE_OUTCOMES as readonly string[]).includes(outcome)) {
      res.status(400).json({ ok: false, error: 'expected outcome terminal, closed or ended', path: '$.outcome' });
      return;
    }
    const answer = typeof b?.answer === 'string' ? b.answer.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, RESPOND_LIMITS.answer) : null;
    const at = typeof b?.at === 'number' && Number.isFinite(b.at) ? b.at : now();
    fleet.respond.close(row.id, req.params.askId!, { outcome: outcome as AskCloseOutcome, at, answer, planApproved: b?.planApproved === true });
    logger.debug('respond.closed', `podium: an ask in session ${row.id} closed (${outcome})`, { session_id: row.id, outcome });
    res.json({ ok: true });
  });

  router.post('/sessions/:id/deliveries/:deliveryId/result', d.requireToken, json, (req, res) => {
    const row = modSession(req, res);
    if (!row) return;
    const result = (req.body as Record<string, unknown> | undefined)?.result;
    if (typeof result !== 'string' || !(DELIVERY_RESULTS as readonly string[]).includes(result)) {
      res.status(400).json({ ok: false, error: `expected result ${DELIVERY_RESULTS.join(', ')}`, path: '$.result' });
      return;
    }
    if (!fleet.respond.result(row.id, req.params.deliveryId!, result as DeliveryResult)) {
      res.status(404).json({ ok: false, error: 'unknown delivery' });
      return;
    }
    logger.info('respond.delivered', `podium: a delivery to session ${row.id} came back ${result}`, { session_id: row.id, result });
    res.json({ ok: true });
  });

  // ---- the browser's side -----------------------------------------------------------------------

  const browser = Router();

  browser.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Cross-site protection, as in the Admin API: a change must carry a header a page on another site cannot add without
  // a preflight, and an Origin that is not this server is refused. The cookie is SameSite=Strict on top of that.
  browser.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    let sameOrigin = true;
    if (origin) {
      try {
        sameOrigin = new URL(origin).host === req.get('host');
      } catch {
        sameOrigin = false;
      }
    }
    if (!sameOrigin || req.get('x-podium-respond') !== '1') {
      refuse(req, res, 403, 'cross-site request refused');
      return;
    }
    next();
  });

  browser.use(json);

  /** Who a request's cookie says is signed in, or null. A revoked or rotated token, or an idle sign-in, ends it. */
  const viewerOf = (req: Request): Viewer | null => {
    const sid = readCookie(req, COOKIE);
    const s = sid ? signIns.get(sid) : undefined;
    if (!sid || !s) return null;
    let viewer: Viewer | null = null;
    if (now() - s.last <= idleMs) {
      if (s.personId === null) viewer = d.token !== null ? { name: ADMIN_OWNER, actor: ADMIN_SECRET_ACTOR, admin: true } : null;
      else {
        const p = people?.getPerson(s.personId);
        if (p && p.revokedAt === null && p.tokenHash === s.tokenHash) viewer = { name: p.name, actor: p.name, admin: people!.isAdministrator(p.id) };
      }
    }
    signIns.delete(sid);
    if (!viewer) return null;
    signIns.set(sid, { ...s, last: now() }); // re-inserted, so the oldest entry is the least recently used
    return viewer;
  };

  browser.get('/me', (req, res) => {
    const v = enabled() ? viewerOf(req) : null;
    const me: RespondMe = { enabled: enabled(), signedIn: !!v, name: v?.name ?? null, admin: v?.admin ?? false };
    res.json(me);
  });

  browser.post('/sign-in', (req, res) => {
    if (!enabled()) {
      refuse(req, res, 403, 'responding is off');
      return;
    }
    const src = sourceOf(req);
    const lockedFor = lockout.lockedFor(src);
    if (lockedFor > 0) {
      res.status(429).json({ ok: false, error: 'too many wrong tries', retryAfterSec: Math.ceil(lockedFor / 1000) });
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!name || !token) {
      res.status(400).json({ ok: false, error: 'enter your name and your token' });
      return;
    }
    // A person's token only with that person's name; the admin secret only with the name Admin (7.7).
    let signIn: SignIn | null = null;
    let viewer: Viewer | null = null;
    const parsed = parsePersonToken(token);
    if (parsed && people) {
      const p = people.findByKeyId(parsed.keyId);
      if (p && p.revokedAt === null && tokenMatches(token, p.tokenHash) && nameKey(p.name) === nameKey(name)) {
        signIn = { personId: p.id, tokenHash: p.tokenHash, last: now() };
        viewer = { name: p.name, actor: p.name, admin: people.isAdministrator(p.id) };
      }
    } else if (d.token !== null && nameKey(name) === nameKey(ADMIN_OWNER) && safeEqualStr(d.token, token)) {
      signIn = { personId: null, tokenHash: null, last: now() };
      viewer = { name: ADMIN_OWNER, actor: ADMIN_SECRET_ACTOR, admin: true };
    }
    if (!signIn || !viewer) {
      const { n, locked } = lockout.fail(src);
      people?.log('respond_sign_in_failed', locked ? `Wrong name or token (${n}); locked for ${Math.round(lockout.lockMs / 60_000)} minutes` : `Wrong name or token (${n})`, src, now(), null);
      logger.warn('respond.sign_in_failed', `podium: a sign-in to respond from ${src} was refused`, { source: src, failures: n, locked });
      res.status(401).json({ ok: false, error: 'wrong name or token' });
      return;
    }
    lockout.succeed(src);
    if (signIns.size >= MAX_SIGN_INS) signIns.delete(signIns.keys().next().value as string);
    const sid = randomBytes(32).toString('hex');
    signIns.set(sid, signIn);
    res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'strict', path: COOKIE_PATH, secure: req.secure });
    people?.log('respond_sign_in', 'Signed in to respond', src, now(), viewer.actor);
    logger.info('respond.sign_in', `podium: ${viewer.name} signed in to respond from ${src}`, { source: src, admin: viewer.admin });
    res.json({ ok: true, name: viewer.name, admin: viewer.admin });
  });

  browser.post('/sign-out', (req, res) => {
    const sid = readCookie(req, COOKIE);
    if (sid) signIns.delete(sid);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    res.json({ ok: true });
  });

  /** The signed-in viewer and the live session they may respond to; otherwise answers and returns null. */
  const browserSession = (req: Request, res: Response): { v: Viewer; row: SessionRow } | null => {
    if (!enabled()) {
      refuse(req, res, 403, 'responding is off');
      return null;
    }
    const v = viewerOf(req);
    if (!v) {
      refuse(req, res, 403, 'sign in to respond');
      return null;
    }
    const row = fleet.db.getSession(req.params.id!);
    if (!row || !fleet.isLive(row.id)) {
      res.status(404).json({ ok: false, error: 'unknown session', path: '$.id' });
      return null;
    }
    if (!viewerOwns(v, row)) {
      refuse(req, res, 403, 'not your session', { owner: row.owner });
      return null;
    }
    return { v, row };
  };

  /** Each answer, message and command the server takes: the admin log and the server log, never its text (7.7). */
  const audit = (req: Request, v: Viewer, row: SessionRow, delivery: Delivery) => {
    const src = sourceOf(req);
    people?.log('respond_sent', `${logWords(delivery)} in ${row.name} (${row.id.slice(0, 8)})`, src, now(), v.actor);
    logger.info('respond.sent', `podium: ${logWords(delivery).toLowerCase()} in session ${row.id}`, { session_id: row.id, kind: delivery.kind, admin: v.admin, source: src });
  };

  browser.get('/sessions/:id/asks/:askId', (req, res) => {
    const got = browserSession(req, res);
    if (!got) return;
    const detail = fleet.respond.detail(got.row.id, req.params.askId!, got.v.name, got.row.last_seen_at);
    if (!detail) {
      res.status(404).json({ ok: false, error: 'unknown ask' });
      return;
    }
    res.json(detail);
  });

  browser.post('/sessions/:id/asks/:askId/answer', (req, res) => {
    const got = browserSession(req, res);
    if (!got) return;
    const out = fleet.respond.answer(got.row.id, req.params.askId!, got.v.name, req.body);
    if (!out.ok) {
      if (out.err.status !== 400) logger.info('respond.refused', `podium: an answer to session ${got.row.id} was refused: ${out.err.error}`, { session_id: got.row.id, status: out.err.status, reason: out.err.error });
      answerError(res, out.err);
      return;
    }
    audit(req, got.v, got.row, out.delivery);
    res.status(202).json({ ok: true, deliveryId: out.delivery.id });
  });

  browser.post('/sessions/:id/messages', (req, res) => {
    const got = browserSession(req, res);
    if (!got) return;
    const out = fleet.respond.message(got.row.id, got.v.name, req.body);
    if (!out.ok) {
      answerError(res, out.err);
      return;
    }
    audit(req, got.v, got.row, out.delivery);
    res.status(202).json({ ok: true, deliveryId: out.delivery.id, queued: got.row.status === 'running' });
  });

  browser.delete('/deliveries/:deliveryId', (req, res) => {
    if (!enabled()) {
      refuse(req, res, 403, 'responding is off');
      return;
    }
    const v = viewerOf(req);
    if (!v) {
      refuse(req, res, 403, 'sign in to respond');
      return;
    }
    const out = fleet.respond.discard(req.params.deliveryId!, v.name, v.admin);
    if (out === 'unknown') res.status(404).json({ ok: false, error: 'unknown delivery' });
    else if (out === 'forbidden') refuse(req, res, 403, 'not your answer');
    else if (out === 'handed-over') res.status(409).json({ ok: false, error: 'handed over' });
    else res.json({ ok: true });
  });

  router.use('/respond', browser);
}

/** For the report route: whether this session takes answers now, and what waits for it (6.1). */
export function replyFor(fleet: Fleet, token: string | null, sessionId: string): { respond: boolean; deliveries: Delivery[] } {
  const owner = fleet.db.getSession(sessionId)?.owner ?? null;
  const respond = token !== null && fleet.respondFlagsOn() && owner !== null;
  return { respond, deliveries: respond ? fleet.respond.deliveriesFor(sessionId) : [] };
}

