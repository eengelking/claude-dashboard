// Responding signs a person in with a name, a token and a session cookie. Over plain HTTP beyond loopback they cross the
// network unencrypted unless a TLS proxy sits in front. The server says so in its log and never blocks (#306).
import type { Request, RequestHandler } from 'express';
import { hostnameOf, isLoopback as isLoopbackName } from './hostCheck.js';
import type { Logger } from './logging/logger.js';

const EVENT = 'server.respond_plain_http';
const NOTE_EVERY_MS = 60_000;
const HOST_SHOWN_MAX = 100;

/** Whether a bind address (`HOST`) reaches this machine only. A wildcard, an empty value or any other address does not. */
export function isLoopbackBind(bind: string | undefined): boolean {
  const h = hostnameOf(bind);
  return h !== null && isLoopbackName(h);
}

export interface PlainHttpWatchOptions {
  /** The address the server listens on (`HOST`). */
  bind: string;
  /** Whether the Respond from Podium flag is on now; it lives in the database, so it is asked each time. */
  respondOn: () => boolean;
  logger: Logger;
  now?: () => number;
}

export interface PlainHttpWatch {
  /** Once, as the server starts. */
  atStart(): void;
  /** When the Admin turns Respond from Podium on. */
  onFlagOn(): void;
  /** On the sign-in to respond: notes a connection that is plain HTTP to a name that is not loopback. Always calls next. */
  onSignIn: RequestHandler;
}

export function createPlainHttpWatch(opts: PlainHttpWatchOptions): PlainHttpWatch {
  const now = opts.now ?? Date.now;
  const loopback = isLoopbackBind(opts.bind);
  let lastNote = -Infinity;

  const bindWarning = (trigger: 'start' | 'flag'): void => {
    if (loopback || !opts.respondOn()) return;
    opts.logger.warn(
      EVENT,
      'podium: Respond from Podium is on and the server is reachable beyond this machine; unless a TLS proxy is in front, the sign-in name, token and cookie travel over plain HTTP, unencrypted',
      { trigger, bind: opts.bind },
    );
  };

  return {
    atStart: () => bindWarning('start'),
    onFlagOn: () => bindWarning('flag'),
    onSignIn: (req: Request, _res, next) => {
      // `req.protocol` follows X-Forwarded-Proto only when Express is told to trust the proxy; until then it is the socket's.
      const host = hostnameOf(req.headers.host);
      const t = now();
      if (req.protocol !== 'https' && !(host && isLoopbackName(host)) && t - lastNote >= NOTE_EVERY_MS) {
        lastNote = t;
        const shown = (host ?? (req.headers.host ?? '')).replace(/[^\x20-\x7e]/g, '?').slice(0, HOST_SHOWN_MAX);
        opts.logger.warn(EVENT, `podium: a sign-in to respond reached ${shown} over plain HTTP; the name, token and cookie are not encrypted in transit`, { trigger: 'sign_in', request_host: shown });
      }
      next();
    },
  };
}
