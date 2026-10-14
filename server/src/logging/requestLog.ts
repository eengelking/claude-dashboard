// Access logging (#140): one `http.request` line per request at debug, so it is off at the default level.
// It records the method, the path without its query string, the route pattern, the status and the time taken;
// never a header, a query string or a body.
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import { sourceAddress } from '../fleet/people.js';
import type { Logger } from './logger.js';

/** `/api/fleet/sessions/:id` for a request a router matched, or null (static files, 404s). */
export function routeOf(req: Request): string | null {
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof pattern !== 'string') return null;
  // A router's mount point is gone from req.baseUrl once the response has finished, so take it from the path:
  // the API routers are mounted two segments deep (/api/fleet, /api/admin).
  const path = (req.originalUrl ?? '').split('?')[0] ?? '';
  const mount = path.startsWith('/api/') ? path.split('/').slice(0, 3).join('/') : req.baseUrl || '';
  return `${mount}${pattern}`;
}

export function requestLog(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!logger.isEnabled('debug')) return next();
    const t0 = performance.now();
    res.once('finish', () => {
      const path = (req.originalUrl ?? '').split('?')[0]!.slice(0, 200);
      const route = routeOf(req);
      logger.debug('http.request', `${req.method} ${route ?? path} ${res.statusCode}`, {
        method: req.method,
        path,
        route,
        status: res.statusCode,
        duration_ms: Math.round((performance.now() - t0) * 10) / 10,
        source: req.ip ? sourceAddress(req.ip) : null,
      });
    });
    next();
  };
}
