import { describe, test, expect } from 'claude-code/testing'
import { Transport, BACKOFF_MS, QUEUE_MAX, type FetchLike, type HttpResult } from './transport.ts'
import type { ActivityEvent, Report } from './protocol.ts'
import { scriptedReport } from './scripted.ts'

const ev = (i: number): ActivityEvent => ({ id: `e${i}`, t: i, kind: 'note', agentId: null, text: `n${i}`, data: null })
const build = (events: ActivityEvent[]): Report => ({ ...scriptedReport(), events })

function fake(responses: (HttpResult | Error)[]) {
  const calls: { url: string; headers: Record<string, string>; body: Report }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Report })
    const r = responses.shift() ?? { status: 200, ok: true, text: '{"ok":true}' }
    if (r instanceof Error) throw r
    return r
  }
  return { fetch, calls }
}

const ok = (acked?: number, live?: number): HttpResult => ({ status: 200, ok: true, text: JSON.stringify({ ok: true, ackedEvents: acked, liveSessions: live }) })

describe('transport', () => {
  test('posts one JSON report with the content type, and the token only when configured', async () => {
    const a = fake([ok()])
    await new Transport(a.fetch, { serverUrl: 'http://h:1/', token: '', heartbeatMs: 5000 }).send(build, 0)
    expect(a.calls).toHaveLength(1)
    expect(a.calls[0]!.url).toBe('http://h:1/api/fleet/report')
    expect(a.calls[0]!.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(a.calls[0]!.body.v).toBe(1)
    const b = fake([ok()])
    await new Transport(b.fetch, { serverUrl: 'http://h:1', token: 's3', heartbeatMs: 5000 }).send(build, 0)
    expect(b.calls[0]!.headers['X-Podium-Token']).toBe('s3')
  })

  test('success clears the acknowledged events and records the live count', async () => {
    const f = fake([ok(2, 4)])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    t.enqueue([ev(1), ev(2), ev(3)])
    expect(await t.send(build, 10)).toBe('ok')
    expect(f.calls[0]!.body.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(t.queue.map((e) => e.id)).toEqual(['e3'])
    expect(t.statusText()).toBe('podium ● 4 live')
    expect(t.online).toBe(true)
  })

  test('reads where the server places this reporter, and says what to do about it', async () => {
    const reply = (c: unknown): HttpResult => ({ status: 200, ok: true, text: JSON.stringify({ ok: true, liveSessions: 2, serverVersion: '0.3.0', reporterCompat: c }) })
    const run = async (r: HttpResult) => {
      const t = new Transport(fake([r]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
      await t.send(build, 0)
      return t
    }
    const outdated = await run(reply('outdated'))
    expect(outdated.statusText()).toBe('podium ● 2 live · update mod')
    expect(outdated.versionNotice()).toContain('update the podium-reporter mod')
    const newer = await run(reply('newer'))
    expect(newer.statusText()).toBe('podium ● 2 live · upgrade server')
    expect(newer.versionNotice()).toContain('upgrade the Podium server')
    for (const quiet of [reply('ok'), reply('unknown'), reply('garbage'), ok(0, 2)]) {
      const t = await run(quiet)
      expect(t.statusText()).toBe('podium ● 2 live')
      expect(t.versionNotice()).toBeNull()
    }
  })

  test('clears the notice once the server says the versions match again', async () => {
    const bad = { status: 200, ok: true, text: '{"ok":true,"reporterCompat":"outdated"}' }
    const good = { status: 200, ok: true, text: '{"ok":true,"reporterCompat":"ok"}' }
    const t = new Transport(fake([bad, good]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    await t.send(build, 0)
    expect(t.versionNotice()).not.toBeNull()
    await t.send(build, 10)
    expect(t.versionNotice()).toBeNull()
  })

  test('sends at most 100 events per report', async () => {
    const f = fake([ok()])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    t.enqueue(Array.from({ length: 250 }, (_, i) => ev(i)))
    await t.send(build, 0)
    expect(f.calls[0]!.body.events).toHaveLength(100)
    expect(t.queue).toHaveLength(150)
  })

  test('a 400 drops that report and its events, and is not retried', async () => {
    const f = fake([{ status: 400, ok: false, text: '{"ok":false,"error":"bad","path":"$.v"}' }])
    const logs: string[] = []
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 }, (l) => logs.push(l))
    t.enqueue([ev(1)])
    expect(await t.send(build, 0)).toBe('rejected')
    expect(t.queue).toEqual([])
    expect(t.rejected).toBe(1)
    expect(logs).toHaveLength(1)
  })

  test('a 409 (the session belongs to someone else) is a rejection, not an outage', async () => {
    const f = fake([{ status: 409, ok: false, text: '{"ok":false,"error":"that session belongs to someone else"}' }])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    t.enqueue([ev(1)])
    expect(await t.send(build, 0)).toBe('rejected')
    expect(t.queue).toEqual([])
    expect(t.failures).toBe(0)
  })

  test('a rejected report backs off like a failure, so a persistently rejected snapshot is not re-posted every tick', async () => {
    const bad: HttpResult = { status: 400, ok: false, text: '{"ok":false}' }
    const f = fake([bad, bad, bad, ok()])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    expect(await t.send(build, 100)).toBe('rejected')
    expect(t.due(100, true)).toBe(false)
    expect(t.due(1099, true)).toBe(false)
    expect(t.due(1100, true)).toBe(true)
    expect(await t.send(build, 1100)).toBe('rejected')
    expect(t.nextAttemptAt).toBe(1100 + 2000)
    expect(await t.send(build, 3100)).toBe('rejected')
    expect(t.nextAttemptAt).toBe(3100 + 5000)
    // a success clears the backoff
    expect(await t.send(build, 8100)).toBe('ok')
    expect(t.nextAttemptAt).toBe(0)
    expect(t.due(8101, true)).toBe(true)
  })

  test('a 401 keeps the events, logs once, waits a minute, and a later success clears the refusal', async () => {
    const no: HttpResult = { status: 401, ok: false, text: '{"ok":false,"error":"missing or wrong X-Podium-Token","path":"$"}' }
    const f = fake([no, no, ok()])
    const logs: string[] = []
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: 'pdm_x', heartbeatMs: 5000 }, (l) => logs.push(l))
    t.enqueue([ev(1)])
    expect(await t.send(build, 100)).toBe('refused')
    expect(t.queue.map((e) => e.id)).toEqual(['e1'])
    expect(t.nextAttemptAt).toBe(100 + 60_000)
    expect(t.due(100 + 59_999, true)).toBe(false)
    expect(t.due(100 + 60_000, true)).toBe(true)
    expect(t.statusText()).toBe('podium ○ token refused')
    expect(t.refusalNotice()).toContain('token')
    expect(await t.send(build, 60_100)).toBe('refused')
    expect(logs).toHaveLength(1)
    expect(logs.join('')).not.toContain('pdm_x')
    expect(await t.send(build, 120_100)).toBe('ok')
    expect(t.refusalNotice()).toBeNull()
    expect(t.queue).toEqual([])
  })

  test('a network error keeps the events and backs off 1, 2, 5, 10, 10 s', async () => {
    const f = fake([new Error('ECONNREFUSED'), new Error('x'), new Error('x'), new Error('x'), { status: 503, ok: false, text: '' }])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    t.enqueue([ev(1), ev(2)])
    const waits: number[] = []
    let now = 0
    for (let i = 0; i < 5; i++) {
      expect(await t.send(build, now)).toBe('failed')
      waits.push(t.nextAttemptAt - now)
      expect(t.due(now + waits[i]! - 1, true)).toBe(false)
      now = t.nextAttemptAt
      expect(t.due(now, true)).toBe(true)
    }
    expect(waits).toEqual([...BACKOFF_MS, 10_000])
    expect(t.queue.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(t.statusText()).toBe('podium ○ offline')
    expect(t.lastError).toBe('HTTP 503')
    // the first success afterwards sends the full snapshot plus every queued event, and resets the backoff
    expect(await t.send(build, now)).toBe('ok')
    expect(f.calls.at(-1)!.body.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(t.failures).toBe(0)
    expect(t.queue).toEqual([])
  })

  test('the queue holds at most 500 events, dropping the oldest', () => {
    const t = new Transport(fake([]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    t.enqueue(Array.from({ length: 520 }, (_, i) => ev(i)))
    expect(t.queue).toHaveLength(QUEUE_MAX)
    expect(t.queue[0]!.id).toBe('e20')
    expect(t.dropped).toBe(20)
  })

  test('due: on change, on queued events, or when the heartbeat is due; never twice at once', async () => {
    let release: (r: HttpResult) => void = () => {}
    const fetch: FetchLike = () => new Promise((res) => (release = res))
    const t = new Transport(fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000 })
    expect(t.due(1000, false)).toBe(true) // never sent: heartbeat due
    const p = t.send(build, 1000)
    expect(t.due(1001, true)).toBe(false)
    expect(await t.send(build, 1001)).toBe('busy')
    release(ok())
    await p
    expect(t.due(2000, false)).toBe(false)
    expect(t.due(2000, true)).toBe(true)
    expect(t.due(6000, false)).toBe(true)
  })
})
