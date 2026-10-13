// The main thread's prompt cache (issue #27). Pure: the reporter says when the last request started and how
// long the cache lives, in its own clock; the server moves those times into its own clock when it stores
// them, and owns the rest of the time, as it does for stale and drop.
import type { CacheAlert, CacheAlertMode, CacheReport, CacheView, SessionStatusView } from './protocol.js';

/** How long before expiry a waiting session starts cooling (CACHE_WARN_MS). */
export const DEFAULT_CACHE_WARN_MS = 60_000;
/** How many alerts carry the tip about cache warming; in `auto` mode, also how many are shown at all. */
export const CACHE_TIP_ALERTS = 2;
/** The settings row that keeps the count across restarts. */
export const CACHE_ALERTS_KEY = 'cache_alerts_shown';

/** What sessions.cache_json holds: the report's block with its times in the server's clock. */
export interface StoredCache extends CacheReport {
  /** `lastRequestAt` as the reporter sent it, so an unchanged request keeps the time first stored. */
  rawLastRequestAt: number | null;
}

/**
 * The report's cache block in the server's clock: each time moves by `serverTime - sentAt`, the reporter's
 * clock offset (plus the report's transit, a few milliseconds). A request start the reporter sent before keeps
 * the time stored then, so the expiry does not jitter from report to report.
 */
export function storeCache(c: CacheReport | null, sentAt: number, serverTime: number, prev: StoredCache | null): StoredCache | null {
  if (!c) return null;
  const shift = (t: number | null) => (t === null ? null : t + (serverTime - sentAt));
  const same = prev !== null && prev.rawLastRequestAt === c.lastRequestAt;
  const lastRequestAt = same ? prev.lastRequestAt : shift(c.lastRequestAt);
  const lastPingAt = c.warming.lastPingAt !== null && c.warming.lastPingAt === c.lastRequestAt ? lastRequestAt : shift(c.warming.lastPingAt);
  return {
    ...c,
    lastRequestAt,
    rawLastRequestAt: c.lastRequestAt,
    warming: { ...c.warming, lastPingAt, untilAt: shift(c.warming.untilAt) },
  };
}

export function parseStoredCache(json: string | null): StoredCache | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as StoredCache;
  } catch {
    return null;
  }
}

/** Warm, cooling or cold now. A running session is warm: it sends its own requests. */
export function cacheStateOf(c: StoredCache, status: SessionStatusView, now: number, warnMs: number): { state: CacheView['state']; expiresAt: number | null } {
  const expiresAt = c.lastRequestAt === null ? null : c.lastRequestAt + c.ttlMs;
  if (status === 'running') return { state: 'warm', expiresAt };
  if (expiresAt === null || now >= expiresAt) return { state: 'cold', expiresAt };
  return { state: now >= expiresAt - warnMs ? 'cooling' : 'warm', expiresAt };
}

/** Whether a cooling alert applies at all: the session waits on the person, its cache is cooling, and nothing keeps it warm. */
export function alertEligible(c: StoredCache, status: SessionStatusView, now: number, warnMs: number): boolean {
  return status === 'waiting' && !c.warming.on && cacheStateOf(c, status, now, warnMs).state === 'cooling';
}

/** The alert the next one would be, given the mode and how many were shown: the tip twice, then none (auto) or no tip (on). */
export function nextAlert(mode: CacheAlertMode, shown: number): CacheAlert {
  if (mode === 'off') return null;
  if (shown < CACHE_TIP_ALERTS) return 'tip';
  return mode === 'on' ? 'plain' : null;
}

export function cacheView(c: StoredCache | null, status: SessionStatusView, now: number, warnMs: number, alert: CacheAlert): CacheView | null {
  if (!c) return null;
  const { state, expiresAt } = cacheStateOf(c, status, now, warnMs);
  return {
    state,
    expiresAt,
    ttlMs: c.ttlMs,
    tokens: c.tokens,
    coldCostUsd: c.coldCostUsd,
    warming: c.warming,
    alert: alertEligible(c, status, now, warnMs) ? alert : null,
  };
}
