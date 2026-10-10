// Express router for Podium, mounted at /api/fleet (SPEC 7.1, 7.7).
import { timingSafeEqual } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Fleet } from './fleet.js';
import { validateReport } from './protocol.js';

export interface FleetRouterOptions {
  /** When set, POST /report, DELETE and POST /hook require it as X-Podium-Token. */
  token?: string | null;
  /** One line per error; never a report body. */
  log?: (line: string) => void;
}

export const BODY_LIMIT = '512kb';

function tokenOk(expected: string | null | undefined, given: unknown): boolean {
  if (!expected) return true;
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
    if (tokenOk(opts.token, req.get('x-podium-token'))) return next();
    res.status(401).json({ ok: false, error: 'missing or wrong X-Podium-Token', path: '$' });
  };

  router.post('/report', requireToken, json, (req, res) => {
    const result = validateReport(req.body);
    if (!result.ok) {
      log(`podium: rejected report at ${result.path}: ${result.error}`);
      res.status(400).json({ ok: false, error: result.error, path: result.path });
      return;
    }
    try {
      const out = fleet.ingest(result.report);
      res.json({ ok: true, serverTime: fleet.now(), ackedEvents: result.report.events.length, sessionId: out.sessionId });
    } catch (err) {
      log(`podium: ingest failed for a report: ${(err as Error).message}`);
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
    if (id === null) {
      res.end('event: error\ndata: {"error":"too many clients"}\n\n');
      return;
    }
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

  router.delete('/sessions/:id', requireToken, (req, res) => {
    if (!fleet.deleteSession(req.params.id)) {
      res.status(404).json({ ok: false, error: 'unknown session', path: '$.id' });
      return;
    }
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
    const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    const to = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime();
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
