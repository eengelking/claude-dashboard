import { describe, test, expect } from 'claude-code/testing'
import {
  cacheReport,
  coldCost,
  decide,
  idle,
  newCache,
  pingDone,
  pingStarted,
  requestStarted,
  setTtl,
  setWarming,
  stop,
  PING_LEAD_MS,
  TTL_DEFAULT_MS,
  TTL_LONG_MS,
} from './cache.ts'

const T = 1_800_000_000_000
const MAX = 30 * 60_000
const usage = (cacheRead: number, cacheWrite = 0) => ({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite })

/** Warming on, the last request at T, idle since T. */
const ready = () => idle(requestStarted(setWarming(newCache(), true), T), true, T)

describe('cache: when the last request started, and which lifetime', () => {
  test('5 minutes unless the session says 1 hour', () => {
    expect(newCache().ttlMs).toBe(TTL_DEFAULT_MS)
    expect(setTtl(newCache(), '1h').ttlMs).toBe(TTL_LONG_MS)
    expect(setTtl(setTtl(newCache(), '1h'), '5m').ttlMs).toBe(TTL_DEFAULT_MS)
    expect(setTtl(newCache(), 'weekly').ttlMs).toBe(TTL_DEFAULT_MS)
  })

  test('the latest request start wins; an older one never moves it back', () => {
    const c = requestStarted(requestStarted(newCache(), T + 5000), T)
    expect(c.lastRequestAt).toBe(T + 5000)
  })
})

describe('cache: deciding when to ping', () => {
  test('nothing is sent while warming is off, however close the expiry', () => {
    const off = idle(requestStarted(newCache(), T), true, T)
    expect(decide(off, T + TTL_DEFAULT_MS - 1000, MAX)).toBe('wait')
  })

  test('a ping a minute before the cache would expire, and not before', () => {
    expect(decide(ready(), T + TTL_DEFAULT_MS - PING_LEAD_MS - 1, MAX)).toBe('wait')
    expect(decide(ready(), T + TTL_DEFAULT_MS - PING_LEAD_MS, MAX)).toBe('ping')
  })

  test('only while idle: a running session sends its own requests', () => {
    const running = idle(ready(), false, T + 1000)
    expect(decide(running, T + TTL_DEFAULT_MS - 1000, MAX)).toBe('wait')
  })

  test('nothing to keep warm before the first response', () => {
    const fresh = idle(setWarming(newCache(), true), true, T)
    expect(decide(fresh, T + 10 * 60_000, MAX)).toBe('wait')
  })

  test('one at a time: never while a ping is in flight', () => {
    expect(decide(pingStarted(ready(), T + 240_000), T + 241_000, MAX)).toBe('wait')
  })

  test('a cache that has already expired is not rewritten', () => {
    expect(decide(ready(), T + TTL_DEFAULT_MS, MAX)).toBe('expired')
  })

  test('stops once the idle period reaches the maximum duration', () => {
    let c = ready()
    // pinged at 4, 8, ... minutes: each ping restarts the five minutes
    c = requestStarted(c, T + 28 * 60_000)
    expect(decide(c, T + MAX - 1, MAX)).toBe('wait')
    expect(decide(c, T + MAX, MAX)).toBe('max-duration')
  })

  test('a stopped period stays stopped until the session runs and goes idle again', () => {
    let c = stop(ready(), 'api-error')
    expect(decide(c, T + TTL_DEFAULT_MS - 1000, MAX)).toBe('wait')
    c = idle(c, false, T + 100_000)
    expect(c.stopped).toBeNull()
    c = idle(requestStarted(c, T + 100_000), true, T + 110_000)
    expect(decide(c, T + 100_000 + TTL_DEFAULT_MS - 1000, MAX)).toBe('ping')
  })

  test('the 1-hour lifetime pings a minute before its own expiry', () => {
    const c = setTtl(ready(), '1h')
    expect(decide(c, T + TTL_DEFAULT_MS - 1000, 2 * 3600_000)).toBe('wait')
    expect(decide(c, T + TTL_LONG_MS - PING_LEAD_MS, 2 * 3600_000)).toBe('ping')
  })
})

describe('cache: what a ping did', () => {
  test('an answered ping counts, costs what its usage says, and restarts the lifetime from its start', () => {
    const start = T + 240_000
    const out = pingDone(pingStarted(ready(), start), start, { isAnswered: true, text: 'OK', usage: usage(40_000) }, 'claude-opus-5-5')
    expect(out.stop).toBeNull()
    expect(out.cache).toMatchObject({ pings: 1, inFlight: false, lastRequestAt: start, lastPingAt: start })
    // 10 in at $4, 2 out at $20, 40,000 read at $0.20 per million
    expect(Math.abs(out.costUsd! - ((10 * 4 + 2 * 20 + 40_000 * 0.2) / 1e6))).toBeLessThan(1e-10)
    expect(Math.abs(out.cache.costUsd - (out.costUsd!))).toBeLessThan(1e-10)
  })

  test('a reply with no text still read the cache: it counts', () => {
    const out = pingDone(pingStarted(ready(), T + 240_000), T + 240_000, { isAnswered: false, reason: 'empty-reply', usage: usage(40_000) }, 'claude-opus-5-5')
    expect(out.cache.pings).toBe(1)
    expect(out.cache.lastRequestAt).toBe(T + 240_000)
  })

  test('an API error stops warming for this idle period and is not retried', () => {
    const out = pingDone(pingStarted(ready(), T + 240_000), T + 240_000, { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: usage(0) }, 'claude-opus-5-5')
    expect(out.stop).toBe('api-error')
    expect(out.cache).toMatchObject({ pings: 0, stopped: 'api-error', inFlight: false, lastRequestAt: T })
    expect(decide(out.cache, T + 250_000, MAX)).toBe('wait')
  })

  test('nothing to fork (after /clear) stops it', () => {
    const out = pingDone(pingStarted(ready(), T + 240_000), T + 240_000, { isAnswered: false, reason: 'nothing-to-fork' }, 'claude-opus-5-5')
    expect(out.stop).toBe('nothing-to-fork')
    expect(out.cache.pings).toBe(0)
  })

  test('an aborted ping stops it too', () => {
    const out = pingDone(pingStarted(ready(), T + 240_000), T + 240_000, { isAnswered: false, reason: 'aborted', usage: usage(0) }, 'claude-opus-5-5')
    expect(out.stop).toBe('aborted')
  })
})

describe('cache: the report', () => {
  test('a cold start costs the cache write instead of the read', () => {
    // Opus: write $5, read $0.20 per million at the 5-minute lifetime
    expect(Math.abs(coldCost(100_000, 'claude-opus-5-5', TTL_DEFAULT_MS)! - (100_000 * (5 - 0.2) / 1e6))).toBeLessThan(1e-10)
    // a 1-hour write costs twice the input price
    expect(Math.abs(coldCost(100_000, 'claude-opus-5-5', TTL_LONG_MS)! - (100_000 * (8 - 0.2) / 1e6))).toBeLessThan(1e-10)
    expect(coldCost(100_000, 'gemma4:12b', TTL_DEFAULT_MS)).toBeNull()
    expect(coldCost(null, 'claude-opus-5-5', TTL_DEFAULT_MS)).toBeNull()
  })

  test('off, ready, warming and stopped', () => {
    expect(cacheReport(newCache(), 1000, 'opus', MAX).warming).toEqual({ on: false, state: 'off', stopReason: null, pings: 0, costUsdEst: 0, lastPingAt: null, untilAt: null })
    expect(cacheReport(setWarming(newCache(), true), 1000, 'opus', MAX).warming.state).toBe('ready')
    const w = cacheReport(ready(), 1000, 'opus', MAX)
    expect(w.warming).toMatchObject({ on: true, state: 'warming', untilAt: T + MAX })
    expect(w).toMatchObject({ lastRequestAt: T, ttlMs: TTL_DEFAULT_MS, tokens: 1000 })
    expect(cacheReport(stop(ready(), 'max-duration'), 1000, 'opus', MAX).warming).toMatchObject({ state: 'stopped', stopReason: 'max-duration', untilAt: null })
  })

  test('turning warming off ends a stop; turning it on starts afresh', () => {
    const c = setWarming(stop(ready(), 'api-error'), false)
    expect(c.stopped).toBeNull()
    expect(setWarming(c, true).stopped).toBeNull()
  })
})
