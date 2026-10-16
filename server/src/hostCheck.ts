// Refuses a request whose Host header is not one the server expects (#256, DNS rebinding). A page on another site can
// point its own name at 127.0.0.1 after it has loaded; the browser then treats Podium as that page's own origin and the
// page can read the open routes. The name it used is in Host, so a name that is not ours gives it away. An IP address
// cannot be rebound, so an address typed in the bar is safe where a name is not.
import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import type { Logger } from './logging/logger.js';

export interface HostCheckOptions {
  /** The address the server listens on (`HOST`). Allowed as a Host; on a wildcard (0.0.0.0, ::, or empty) any IP is. */
  bind?: string;
  /** Names or addresses the owner allows (`PODIUM_ALLOWED_HOSTS`), with or without a port. The port is never compared. */
  allowed?: string[];
  logger?: Logger;
}

/** The hostname in a Host header or setting, lower-cased, without port, brackets or a trailing dot; null if malformed. */
export function hostnameOf(value: string | undefined): string | null {
  let h = (value ?? '').trim().toLowerCase();
  if (!h) return null;
  if (isIP(h) === 6) return h; // a bare IPv6 address, as a setting (`HOST=fe80::5`) is written; a Host header always brackets it
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end < 0) return null;
    const rest = h.slice(end + 1);
    if (rest !== '' && !/^:\d{0,5}$/.test(rest)) return null;
    h = h.slice(1, end);
    return isIP(h) === 6 ? h : null;
  }
  const colon = h.lastIndexOf(':');
  if (colon >= 0) {
    if (h.indexOf(':') !== colon || !/^:\d{0,5}$/.test(h.slice(colon))) return null;
    h = h.slice(0, colon);
  }
  if (h.endsWith('.')) h = h.slice(0, -1);
  return /^[a-z0-9._-]+$/.test(h) ? h : null;
}

const isLoopback = (h: string): boolean => h === 'localhost' || h === '::1' || (isIP(h) === 4 && h.startsWith('127.'));
const isWildcard = (bind: string): boolean => bind === '' || bind === '0.0.0.0' || bind === '::';

/** `PODIUM_ALLOWED_HOSTS`: names or addresses separated by commas. */
export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

const LOG_EVERY_MS = 60_000;
const LOG_HOSTS_MAX = 100;

export function hostCheck(opts: HostCheckOptions = {}): RequestHandler {
  const bind = hostnameOf(opts.bind) ?? '';
  const anyIp = isWildcard(opts.bind?.trim() ?? '');
  const allowed = new Set<string>();
  for (const a of opts.allowed ?? []) {
    const h = hostnameOf(a);
    if (h) allowed.add(h);
  }
  if (bind && !isWildcard(bind)) allowed.add(bind);
  const lastLogged = new Map<string, number>();

  return (req, res, next) => {
    const host = hostnameOf(req.headers.host);
    if (host && (isLoopback(host) || allowed.has(host) || (anyIp && isIP(host) !== 0))) return next();

    // One line per host a minute, with the name it sent and nothing else about the request.
    const shown = (req.headers.host ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 100);
    const now = Date.now();
    if (opts.logger && now - (lastLogged.get(shown) ?? 0) >= LOG_EVERY_MS) {
      if (lastLogged.size >= LOG_HOSTS_MAX) lastLogged.clear();
      lastLogged.set(shown, now);
      opts.logger.warn('http.host_refused', `podium: refused a request whose Host is "${shown}"; allow it with PODIUM_ALLOWED_HOSTS if it is yours`, { host: shown });
    }
    res.status(403).json({ error: 'host not allowed' });
  };
}
