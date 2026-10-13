// The main thread's prompt cache (issue #27): when its last request started, how long the cache lives,
// and the pure rules for cache warming. Pure; no `$` here. Times are the engine's clock (`$.clock.now()`),
// which is what the flush timer schedules by.
//
// Why warming has a limit. A ping reads the cached prompt at the read price (0.1x input at the standard
// rate) and a cold start writes it again at the write price (1.25x input), so a cold start costs about
// 1.15x the prompt's input price more than a warm request. Pings pay for themselves only while they add up
// to less than that: about 11 pings at the 0.1x read price (some 46 minutes at a ping every 4 minutes),
// about 24 at 0.05x and about 49 at 0.025x. Past that, or if the person never comes back, they cost more
// than they save. Hence WARM_MINUTES_DEFAULT (30), comfortably inside the standard break-even.
import { priceOf, costOf } from './models.ts';
import type { CacheReport, CacheWarming, WarmStop } from './protocol.ts';

/** The default lifetime of a cache entry, from the start of the request that wrote or read it. */
export const TTL_DEFAULT_MS = 300_000;
/** The optional longer lifetime; its writes cost 2x input instead of 1.25x. */
export const TTL_LONG_MS = 3_600_000;
/** A ping goes out this long before the cache would expire. */
export const PING_LEAD_MS = 60_000;
/** The longest an idle period is kept warm unless the `cacheWarmingMinutes` option says otherwise. */
export const WARM_MINUTES_DEFAULT = 30;
/** The one message a ping adds after the transcript; the reply is thrown away. */
export const PING_PROMPT = 'Reply with OK.';

export interface CacheState {
  /** When the main thread's latest model request (or ping) started; null before the first response. */
  lastRequestAt: number | null;
  ttlMs: number;
  /** Warming is on for this session: the option, or `/podium warm`. */
  on: boolean;
  /** When the current idle period began (the session waiting on the person); null while it runs. */
  idleSince: number | null;
  inFlight: boolean;
  /** Warming stopped for this idle period, and why; cleared when the session runs again. */
  stopped: WarmStop | null;
  pings: number;
  costUsd: number;
  lastPingAt: number | null;
}

export function newCache(on = false): CacheState {
  return { lastRequestAt: null, ttlMs: TTL_DEFAULT_MS, on, idleSince: null, inFlight: false, stopped: null, pings: 0, costUsd: 0, lastPingAt: null };
}

/** A main-thread model request started at `at` (only one that got a response refreshes the cache). */
export function requestStarted(c: CacheState, at: number): CacheState {
  if (c.lastRequestAt !== null && c.lastRequestAt >= at) return c;
  return { ...c, lastRequestAt: at };
}

/** The lifetime the session asks for, as Claude Code names it (`5m` or `1h`); anything else is the default. */
export function setTtl(c: CacheState, ttl: string | null | undefined): CacheState {
  const ttlMs = ttl === '1h' ? TTL_LONG_MS : TTL_DEFAULT_MS;
  return ttlMs === c.ttlMs ? c : { ...c, ttlMs };
}

/** Warming turned on or off. Either way an earlier stop is forgotten: the person just made a choice. */
export function setWarming(c: CacheState, on: boolean): CacheState {
  if (on === c.on && c.stopped === null) return c;
  return { ...c, on, stopped: null };
}

/** Whether the session waits on the person now. Running again ends the idle period and any stop with it. */
export function idle(c: CacheState, isIdle: boolean, now: number): CacheState {
  if (!isIdle) return c.idleSince === null && c.stopped === null ? c : { ...c, idleSince: null, stopped: null };
  return c.idleSince === null ? { ...c, idleSince: now } : c;
}

export function stop(c: CacheState, reason: WarmStop): CacheState {
  return { ...c, stopped: reason, inFlight: false };
}

export type WarmAction = 'ping' | 'wait' | WarmStop;

/**
 * What warming should do now: ping a minute before the cache would expire, only while on and idle, one at a
 * time, never for a cache that has already expired, and not past the idle period's maximum duration.
 */
export function decide(c: CacheState, now: number, maxMs: number, leadMs = PING_LEAD_MS): WarmAction {
  if (!c.on || c.idleSince === null || c.stopped !== null || c.inFlight || c.lastRequestAt === null) return 'wait';
  if (now - c.idleSince >= maxMs) return 'max-duration';
  const expiresAt = c.lastRequestAt + c.ttlMs;
  if (now >= expiresAt) return 'expired';
  return now >= expiresAt - leadMs ? 'ping' : 'wait';
}

export function pingStarted(c: CacheState, now: number): CacheState {
  return { ...c, inFlight: true, lastPingAt: now };
}

/** What `$.model.fork` resolved to, as far as warming cares. */
export type ForkOutcome =
  | { isAnswered: true; text?: string; usage: Usage }
  | { isAnswered: false; reason: string; usage?: Usage; status?: number | null; error?: string };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/**
 * A ping came back. One that reached the model (an answer, or a reply with no text) refreshed the cache from
 * its start and counts, with its cost from the usage it returned; anything else stops warming for this idle
 * period, so nothing is retried in a loop.
 */
export function pingDone(c: CacheState, start: number, res: ForkOutcome, model: string | null): { cache: CacheState; costUsd: number | null; stop: WarmStop | null } {
  const reached = res.isAnswered || res.reason === 'empty-reply';
  if (!reached) {
    const reason: WarmStop = res.reason === 'nothing-to-fork' ? 'nothing-to-fork' : res.reason === 'aborted' ? 'aborted' : 'api-error';
    return { cache: stop(c, reason), costUsd: null, stop: reason };
  }
  const u = res.usage;
  const costUsd = u ? costOf({ input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 }, model) : null;
  const next = requestStarted({ ...c, inFlight: false, pings: c.pings + 1, costUsd: c.costUsd + (costUsd ?? 0) }, start);
  return { cache: next, costUsd, stop: null };
}

/** The extra cost of a cold start: writing `tokens` to the cache instead of reading them. null without a price or a count. */
export function coldCost(tokens: number | null, model: string | null | undefined, ttlMs: number): number | null {
  const p = priceOf(model);
  if (!p || tokens === null) return null;
  const write = ttlMs >= TTL_LONG_MS ? p.input * 2 : p.cacheWrite;
  return (tokens * (write - p.cacheRead)) / 1e6;
}

/** Dollars to the 6 decimals the report carries. */
const usd6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function warmingReport(c: CacheState, maxMs: number): CacheWarming {
  const state: CacheWarming['state'] = !c.on ? 'off' : c.stopped ? 'stopped' : c.idleSince !== null ? 'warming' : 'ready';
  return {
    on: c.on,
    state,
    stopReason: c.on ? c.stopped : null,
    pings: c.pings,
    costUsdEst: usd6(c.costUsd),
    lastPingAt: c.lastPingAt,
    untilAt: state === 'warming' && c.idleSince !== null ? c.idleSince + maxMs : null,
  };
}

export function cacheReport(c: CacheState, tokens: number | null, model: string | null, maxMs: number): CacheReport {
  const cold = coldCost(tokens, model, c.ttlMs);
  return {
    lastRequestAt: c.lastRequestAt,
    ttlMs: c.ttlMs,
    tokens,
    coldCostUsd: cold === null ? null : usd6(cold),
    warming: warmingReport(c, maxMs),
  };
}

function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** How a ping reads in the activity list: what it read (and wrote) and roughly what it cost. */
export function pingText(usage: Usage | undefined, costUsd: number | null): string {
  const read = usage?.cache_read_input_tokens ?? 0;
  const wrote = usage?.cache_creation_input_tokens ?? 0;
  return `cache warming ping: ${kTokens(read)} tokens read from the cache${wrote ? `, ${kTokens(wrote)} written` : ''}${costUsd !== null ? `, about $${costUsd.toFixed(4)}` : ''}`;
}

/** How a stop reads in the activity list and in `/podium`. */
export function stopText(reason: WarmStop, maxMs: number): string {
  switch (reason) {
    case 'max-duration':
      return `cache warming stopped: ${Math.round(maxMs / 60_000)}-minute limit reached`;
    case 'api-error':
      return 'cache warming stopped: the ping got an API error';
    case 'nothing-to-fork':
      return 'cache warming stopped: nothing to keep warm';
    case 'aborted':
      return 'cache warming stopped: the ping was cut short';
    case 'expired':
      return 'cache warming stopped: the cache had already expired';
  }
}
