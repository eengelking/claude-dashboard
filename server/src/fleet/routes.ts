// Express router for Podium, mounted at /api/fleet (SPEC 7.1, 7.7).
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Fleet } from './fleet.js';
import { checkReporter, REPORTER_SUPPORT, serverVersion } from './compat.js';
import { MAIN_LOOP, validateReport } from './protocol.js';
import { everyOf, type ActivityReply } from './activity.js';
import { OwnerConflict } from './ingest.js';
import { ADMIN_OWNER, nameKey, sourceAddress, type PeopleStore, type PersonRow } from './people.js';
import { parsePersonToken, safeEqualStr, tokenMatches } from './tokens.js';

export interface FleetRouterOptions {
  /** The admin secret (PODIUM_TOKEN). When set, POST /report, DELETE and POST /hook need a credential in X-Podium-Token: this, or a person's token. */
  token?: string | null;
  /** Per-person tokens. Without it only the admin secret works. */
  people?: PeopleStore | null;
  /** One line per error; never a report body. */
  log?: (line: string) => void;
}

export const BODY_LIMIT = '512kb';

/** Who a request's X-Podium-Token says it is. */
type Identity = { kind: 'person'; person: PersonRow } | { kind: 'admin' } | { kind: 'open' };

function identify(opts: FleetRouterOptions, given: unknown): Identity | null {
  const presented = typeof given === 'string' ? given : '';
  const parsed = presented ? parsePersonToken(presented) : null;
  if (parsed && opts.people) {
    const person = opts.people.findByKeyId(parsed.keyId);
    if (!person || person.revokedAt !== null || !tokenMatches(presented, person.tokenHash)) return null;
    return { kind: 'person', person };
  }
  if (opts.token) {
    if (!presented || !safeEqualStr(opts.token, presented)) return null;
    return !opts.people || opts.people.adminReportingAllowed() ? { kind: 'admin' } : null;
  }
  // Authentication is off. A token that was presented but is not a person's is simply ignored.
  return { kind: 'open' };
}

/** The address a report came from, as the Machines column shows it. */
const machineOf = (req: Request): string | null => (req.ip ? sourceAddress(req.ip) : null);

const ownerOf = (id: Identity): string | null => (id.kind === 'person' ? id.person.name : id.kind === 'admin' ? ADMIN_OWNER : null);

function intParam(v: unknown): number | null | 'bad' {
  if (v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return 'bad';
  return Number(v);
}

export function createFleetRouter(fleet: Fleet, opts: FleetRouterOptions = {}): Router {
  const log = opts.log ?? ((line: string) => console.error(line));
  const router = Router();
  const json = express.json({ limit: BODY_LIMIT, type: ['application/json', 'application/*+json'] });

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    const id = identify(opts, req.get('x-podium-token'));
    if (id) {
      res.locals.identity = id;
      return next();
    }
    res.status(401).json({ ok: false, error: 'missing or wrong X-Podium-Token', path: '$' });
  };
  const identityOf = (res: Response): Identity => res.locals.identity as Identity;

  router.post('/report', requireToken, json, (req, res) => {
    const result = validateReport(req.body);
    if (!result.ok) {
      log(`podium: rejected report at ${result.path}: ${result.error}`);
      res.status(400).json({ ok: false, error: result.error, path: result.path });
      return;
    }
    const id = identityOf(res);
    // The token decides who the sender is; the name it carries must agree (a consistency check, since names are visible).
    if (id.kind === 'person' && nameKey(result.report.userName ?? '') !== nameKey(id.person.name)) {
      res.status(401).json({ ok: false, error: 'the token does not belong to that name', path: '$.userName' });
      return;
    }
    try {
      const out = fleet.ingest(result.report, ownerOf(id));
      if (id.kind === 'person') opts.people?.touch(id.person.id, machineOf(req), fleet.now()); // only a report that was stored counts
      res.json({ ok: true, serverTime: fleet.now(), ackedEvents: result.report.events.length, sessionId: out.sessionId, liveSessions: fleet.visibleCount(), serverVersion: serverVersion(), reporterSupport: REPORTER_SUPPORT, reporterCompat: checkReporter(result.report.reporter.version), watch: fleet.activity.watched(out.sessionId) });
    } catch (err) {
      if (err instanceof OwnerConflict) {
        res.status(409).json({ ok: false, error: 'that session belongs to someone else', path: '$.session.id' });
        return;
      }
      log(`podium: ingest failed for a report: ${(err as Error).message}`);
      res.status(500).json({ ok: false, error: 'ingest failed', path: '$' });
    }
  });

  // Classic settings hooks (T5.1): each hook POSTs its stdin payload here.
  router.post('/hook', requireToken, json, (req, res) => {
    try {
      const id = identityOf(res);
      const out = fleet.ingestHook(req.body, ownerOf(id));
      if (!out.ok) {
        log(`podium: rejected hook payload at ${out.path}: ${out.error}`);
        res.status(400).json(out);
        return;
      }
      if (id.kind === 'person') opts.people?.touch(id.person.id, machineOf(req), fleet.now());
      res.json({ ok: true, sessionId: out.sessionId });
    } catch (err) {
      if (err instanceof OwnerConflict) {
        res.status(409).json({ ok: false, error: 'that session belongs to someone else', path: '$.session_id' });
        return;
      }
      log(`podium: hook ingest failed: ${(err as Error).message}`);
      res.status(500).json({ ok: false, error: 'ingest failed', path: '$' });
    }
  });

  router.get('/state', (_req, res) => {
    res.json(fleet.state());
  });

  router.get('/stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (fleet.hub.isFull) {
      res.end('event: error\ndata: {"error":"too many clients"}\n\n');
      return;
    }
    res.flushHeaders();
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);
    const id = fleet.hub.add(
      {
        write: (chunk: string) => {
          if (res.writableEnded || res.destroyed) throw new Error('closed');
          res.write(chunk);
        },
        end: () => res.end(),
      },
      [fleet.snapshotMessage()],
    );
    // null here means the client vanished while being added: there is nobody left to tell.
    if (id === null) return;
    const drop = () => fleet.hub.remove(id);
    req.on('close', drop);
    res.on('error', drop);
  });

  router.get('/sessions/:id', (req, res) => {
    const view = fleet.view(req.params.id);
    if (!view) {
      res.status(404).json({ ok: false, error: 'unknown session', path: '$.id' });
      return;
    }
    res.json(view);
  });

  // The whole prompt and answer, fetched when the console opens them (issue #97). Not in the state or
  // the stream: they can be tens of kilobytes per agent.
  router.get('/sessions/:id/agents/:agentId/text', (req, res) => {
    const t = fleet.db.getAgentTexts(req.params.id, req.params.agentId);
    if (!t) {
      res.status(404).json({ ok: false, error: 'no full text for this agent', path: '$.agentId' });
      return;
    }
    res.json(t);
  });

  // An agent's recent activity (#118). Each fetch takes or renews the viewer's lease on that loop for `every` seconds
  // plus a margin; the reply to the next report then asks the mod for its entries. `@orchestrator` is the main loop.
  // In memory only, never in the state or the stream. No token, like the other reads.
  router.get('/sessions/:id/agents/:agentId/activity', (req, res) => {
    const { id, agentId } = req.params;
    if (!fleet.db.getSession(id) || (agentId !== MAIN_LOOP && !fleet.db.getAgents(id).some((a) => a.id === agentId))) {
      res.status(404).json({ ok: false, error: 'unknown session or agent', path: '$.agentId' });
      return;
    }
    // With the Admin's flag off (Admin > Settings > Feature flags) no lease is taken; the panel keeps asking and says so.
    let body: ActivityReply;
    if (!fleet.activity.on) body = { entries: [], since: null, live: fleet.isLive(id), enabled: false, serverTime: fleet.now() };
    else if (!fleet.isLive(id)) body = { entries: [], since: null, live: false, enabled: true, serverTime: fleet.now() };
    else body = { ...fleet.activity.watch(id, agentId, everyOf(req.query.every)), live: true, enabled: true, serverTime: fleet.now() };
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.delete('/sessions/:id', requireToken, (req, res) => {
    if (!fleet.deleteSession(req.params.id)) {
      res.status(404).json({ ok: false, error: 'unknown session', path: '$.id' });
      return;
    }
    res.json({ ok: true });
  });

  // Remove on a heartbeat-lost card. It only hides a card the server was about to drop anyway, so it takes
  // no token, like the other reads the dashboard makes. SPEC 7.1, 7.5.
  router.post('/sessions/:id/drop', (req, res) => {
    const out = fleet.dropSession(req.params.id);
    if (out === 'unknown') {
      res.status(404).json({ ok: false, error: 'unknown session', path: '$.id' });
      return;
    }
    if (out === 'not-stale') {
      res.status(409).json({ ok: false, error: 'session is not heartbeat lost', path: '$.id' });
      return;
    }
    res.json({ ok: true });
  });

  // Closing a wall notice and the Show/Hide link on the background-sessions note. Both only change how the wall
  // looks, like Remove above, so they take no token (and no admin cookie: the wall has none). SPEC 7.1, 8.1.
  router.post('/notices/:id/close', (req, res) => {
    if (!fleet.wall.setNotice(req.params.id, false)) {
      res.status(400).json({ ok: false, error: 'unknown notice', path: '$.id' });
      return;
    }
    opts.people?.log('wall_notice_changed', `Wall notice ${req.params.id} turned off from the wall`, machineOf(req) ?? '', fleet.now());
    res.json({ ok: true });
  });

  router.put('/wall/background-sessions', json, (req, res) => {
    const v = req.body?.show;
    if (typeof v !== 'boolean') {
      res.status(400).json({ ok: false, error: 'show must be true or false', path: '$.show' });
      return;
    }
    fleet.wall.setShowBackgroundSessions(v);
    opts.people?.log('wall_background_changed', `Background sessions ${v ? 'shown' : 'hidden'} on the wall`, machineOf(req) ?? '', fleet.now());
    res.json({ ok: true });
  });

  router.get('/events', (req, res) => {
    const before = intParam(req.query.before);
    const limit = intParam(req.query.limit);
    const sessionId = req.query.sessionId;
    if (before === 'bad' || limit === 'bad' || (sessionId !== undefined && typeof sessionId !== 'string')) {
      res.status(400).json({ ok: false, error: 'bad query', path: '$.query' });
      return;
    }
    const n = Math.max(1, Math.min(200, limit ?? 50));
    res.json({ events: fleet.events({ sessionId: sessionId || null, before, limit: n }) });
  });

  router.get('/history', (req, res) => {
    const day = typeof req.query.day === 'string' ? req.query.day : '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) {
      res.status(400).json({ ok: false, error: 'day must be YYYY-MM-DD', path: '$.query.day' });
      return;
    }
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const start = new Date(y, mo - 1, d);
    // Date rolls 2026-02-31 over to March 3rd; a day that does not exist is a 400.
    if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) {
      res.status(400).json({ ok: false, error: 'day is not a real date', path: '$.query.day' });
      return;
    }
    // The day's boundaries are the server's local midnight (the dashboard is for one machine).
    const from = start.getTime();
    const to = new Date(y, mo - 1, d + 1).getTime();
    res.json({ day, sessions: fleet.history(from, to) });
  });

  router.get('/health', (_req, res) => {
    res.json(fleet.health());
  });

  router.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'not found', path: '$' });
  });

  // Body-parser errors (malformed JSON, too large, bad charset) become 4xx; anything else 500.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router.use((err: { type?: string; status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ ok: false, error: `body over ${BODY_LIMIT}`, path: '$' });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, error: 'malformed JSON', path: '$' });
      return;
    }
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    log(`podium: request failed (${status}): ${err.type ?? err.message ?? 'error'}`);
    res.status(status).json({ ok: false, error: status === 500 ? 'internal error' : (err.type ?? 'bad request'), path: '$' });
  });

  return router;
}
