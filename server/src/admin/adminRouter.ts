// The Admin API, mounted at /api/admin (issue #36). Opened with the admin secret (PODIUM_TOKEN); after that a random session id
// lives in an HttpOnly, SameSite=Strict cookie and in this process's memory only. A restart, a secret rotation (which needs a
// restart) or ten idle minutes ends it. Nothing here ever returns, logs or stores a token or the secret: a token is shown once,
// in the response that creates or rotates it.
import { randomBytes } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { PeopleError, sourceAddress, type PeopleStore, type PersonRow } from '../fleet/people.js';
import { safeEqualStr } from '../fleet/tokens.js';

export interface AdminRouterOptions {
  /** The admin secret. null when the server runs without authentication: Admin is then switched off. */
  secret: string | null;
  people: PeopleStore;
  now?: () => number;
  /** Idle time before a session ends. */
  idleMs?: number;
  /** Wrong tries before a source is locked out, and for how long. */
  maxFails?: number;
  lockMs?: number;
  log?: (line: string) => void;
}

const COOKIE = 'podium_admin';
const MAX_SESSIONS = 20;
const MAX_SOURCES = 1000;

const sourceOf = (req: Request): string => sourceAddress(req.ip);

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const idParam = (v: string): number | null => (/^\d{1,12}$/.test(v) ? Number(v) : null);

/** A person as the Admin UI sees one: never the key id or the hash. */
function publicPerson(p: PersonRow, groupName: string | null) {
  return {
    id: p.id,
    name: p.name,
    last4: p.last4,
    groupId: p.groupId,
    groupName,
    createdAt: p.createdAt,
    rotatedAt: p.rotatedAt,
    revokedAt: p.revokedAt,
    lastReportAt: p.lastReportAt,
    machines: [] as string[],
  };
}

export function createAdminRouter(opts: AdminRouterOptions): Router {
  const { people } = opts;
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? 10 * 60_000;
  const maxFails = opts.maxFails ?? 5;
  const lockMs = opts.lockMs ?? 15 * 60_000;
  const log = opts.log ?? ((line: string) => console.error(line));
  const sessions = new Map<string, number>(); // session id -> last activity
  const fails = new Map<string, { n: number; lockedUntil: number }>();
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/session', (req, res) => {
    res.json({ enabled: opts.secret !== null, unlocked: opts.secret !== null && sessionValid(req) });
  });

  // Admin is off without a token: the console is open to everyone who can reach it, so there is nothing to gate it with.
  router.use((_req, res, next) => {
    if (opts.secret === null) {
      res.status(403).json({ ok: false, error: 'Admin is off: the server is running without a token. Start it with one.' });
      return;
    }
    next();
  });

  // Cross-site protection: no CORS is offered, a change must carry a header a page on another site cannot add without a
  // preflight, and an Origin that is not this server is refused. The cookie is SameSite=Strict on top of that.
  router.use((req, res, next) => {
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
    if (!sameOrigin || req.get('x-podium-admin') !== '1') {
      res.status(403).json({ ok: false, error: 'cross-site request refused' });
      return;
    }
    next();
  });

  router.use(express.json({ limit: '8kb' }));

  function sessionValid(req: Request): boolean {
    const sid = readCookie(req, COOKIE);
    if (!sid) return false;
    const last = sessions.get(sid);
    if (last === undefined) return false;
    if (now() - last > idleMs) {
      sessions.delete(sid);
      return false;
    }
    sessions.delete(sid); // re-insert so the oldest entry is the least recently used, which is the one evicted at the cap
    sessions.set(sid, now());
    return true;
  }

  router.post('/unlock', (req, res) => {
    const src = sourceOf(req);
    const state = fails.get(src);
    if (state && state.lockedUntil > now()) {
      res.status(429).json({ ok: false, error: 'too many wrong tries', retryAfterSec: Math.ceil((state.lockedUntil - now()) / 1000) });
      return;
    }
    const given = typeof req.body?.secret === 'string' ? req.body.secret : '';
    if (given && opts.secret !== null && safeEqualStr(opts.secret, given)) {
      fails.delete(src);
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
      const sid = randomBytes(32).toString('hex');
      sessions.set(sid, now());
      res.cookie(COOKIE, sid, { httpOnly: true, sameSite: 'strict', path: '/api/admin', secure: req.secure });
      people.log('unlock', 'Admin unlocked', src, now());
      res.json({ ok: true });
      return;
    }
    const n = (state?.n ?? 0) + 1; // a lock resets the count, so an expired lock starts from zero
    if (fails.size >= MAX_SOURCES) fails.delete(fails.keys().next().value as string);
    const locked = n >= maxFails;
    fails.set(src, { n: locked ? 0 : n, lockedUntil: locked ? now() + lockMs : 0 });
    people.log('unlock_failed', locked ? `Wrong secret (${n}); locked for ${Math.round(lockMs / 60_000)} minutes` : `Wrong secret (${n})`, src, now());
    res.status(401).json({ ok: false, error: 'wrong secret' });
  });

  // Everything below needs an unlocked session.
  router.use((req, res, next) => {
    if (sessionValid(req)) return next();
    res.status(401).json({ ok: false, error: 'locked' });
  });

  router.post('/lock', (req, res) => {
    const sid = readCookie(req, COOKIE);
    if (sid) sessions.delete(sid);
    res.clearCookie(COOKIE, { path: '/api/admin' });
    res.json({ ok: true });
  });

  const fail = (res: Response, err: unknown) => {
    if (err instanceof PeopleError) {
      res.status(err.code === 'duplicate' ? 409 : err.code === 'not_found' ? 404 : 400).json({ ok: false, error: err.message });
      return;
    }
    log(`podium: admin request failed: ${(err as Error).message}`);
    res.status(500).json({ ok: false, error: 'failed' });
  };
  const groupNameOf = (p: PersonRow) => (p.groupId === null ? null : (people.getGroup(p.groupId)?.name ?? null));
  const paging = (req: Request) => ({ page: Number(req.query.page), pageSize: Number(req.query.pageSize) });

  // ---- people ---------------------------------------------------------------------------------

  router.get('/people', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ ...people.list({ ...paging(req), q }), groups: people.allGroups() });
  });

  router.post('/people', (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      const groupId = typeof req.body?.groupId === 'number' ? req.body.groupId : null;
      const { person, token } = people.createPerson(name, groupId, now());
      people.log('person_created', `Added ${person.name}`, sourceOf(req), now());
      res.status(201).json({ ok: true, person: publicPerson(person, groupNameOf(person)), token });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/people/:id/rotate', (req, res) => {
    const id = idParam(req.params.id);
    if (id === null) return void res.status(400).json({ ok: false, error: 'bad id' });
    try {
      const out = people.rotate(id, now());
      if (!out) return void res.status(404).json({ ok: false, error: 'unknown person' });
      people.log('token_rotated', `Rotated the token of ${out.person.name}`, sourceOf(req), now());
      res.json({ ok: true, person: publicPerson(out.person, groupNameOf(out.person)), token: out.token });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/people/:id/revoke', (req, res) => {
    const id = idParam(req.params.id);
    if (id === null) return void res.status(400).json({ ok: false, error: 'bad id' });
    const p = people.getPerson(id);
    if (!p) return void res.status(404).json({ ok: false, error: 'unknown person' });
    if (people.revoke(id, now())) people.log('token_revoked', `Revoked the token of ${p.name}`, sourceOf(req), now());
    res.json({ ok: true });
  });

  router.put('/people/:id/group', (req, res) => {
    const id = idParam(req.params.id);
    if (id === null) return void res.status(400).json({ ok: false, error: 'bad id' });
    const raw = req.body?.groupId;
    if (raw !== null && typeof raw !== 'number') return void res.status(400).json({ ok: false, error: 'groupId must be a number or null' });
    const p = people.getPerson(id);
    if (!p || !people.setGroup(id, raw)) return void res.status(404).json({ ok: false, error: 'unknown person or group' });
    people.log('group_assigned', raw === null ? `${p.name} moved to no group` : `${p.name} moved to ${people.getGroup(raw)?.name}`, sourceOf(req), now());
    res.json({ ok: true });
  });

  // ---- groups ---------------------------------------------------------------------------------

  router.get('/groups', (req, res) => {
    res.json(people.listGroups(paging(req)));
  });

  router.post('/groups', (req, res) => {
    try {
      const g = people.createGroup(typeof req.body?.name === 'string' ? req.body.name : '', now());
      people.log('group_created', `Created the group ${g.name}`, sourceOf(req), now());
      res.status(201).json({ ok: true, ...g });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/groups/:id', (req, res) => {
    const id = idParam(req.params.id);
    if (id === null) return void res.status(400).json({ ok: false, error: 'bad id' });
    const g = people.getGroup(id);
    if (!g || !people.deleteGroup(id)) return void res.status(404).json({ ok: false, error: 'unknown group' });
    people.log('group_deleted', `Deleted the group ${g.name}`, sourceOf(req), now());
    res.json({ ok: true });
  });

  // ---- settings and log -----------------------------------------------------------------------

  router.get('/settings', (_req, res) => {
    res.json({ allowAdminSecretReporting: people.adminReportingAllowed() });
  });

  router.put('/settings', (req, res) => {
    const v = req.body?.allowAdminSecretReporting;
    if (typeof v !== 'boolean') return void res.status(400).json({ ok: false, error: 'allowAdminSecretReporting must be true or false' });
    people.setAdminReporting(v);
    people.log('admin_reporting_changed', `Reporting with the admin secret turned ${v ? 'on' : 'off'}`, sourceOf(req), now());
    res.json({ ok: true, allowAdminSecretReporting: v });
  });

  router.get('/log', (req, res) => {
    res.json(people.listLog(paging(req)));
  });

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    res.status(400).json({ ok: false, error: err instanceof SyntaxError ? 'bad JSON' : 'bad request' });
  });

  return router;
}
