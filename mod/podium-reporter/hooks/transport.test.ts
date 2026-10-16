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
    await new Transport(a.fetch, { serverUrl: 'http://h:1/', token: '', heartbeatMs: 5000, version: '0.11.0' }).send(build, 0)
    expect(a.calls).toHaveLength(1)
    expect(a.calls[0]!.url).toBe('http://h:1/api/fleet/report')
    expect(a.calls[0]!.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(a.calls[0]!.body.v).toBe(1)
    const b = fake([ok()])
    await new Transport(b.fetch, { serverUrl: 'http://h:1', token: 's3', heartbeatMs: 5000, version: '0.11.0' }).send(build, 0)
    expect(b.calls[0]!.headers['X-Podium-Token']).toBe('s3')
  })

  test('success clears the acknowledged events and records the live count', async () => {
    const f = fake([ok(2, 4)])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    t.enqueue([ev(1), ev(2), ev(3)])
    expect(await t.send(build, 10)).toBe('ok')
    expect(f.calls[0]!.body.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(t.queue.map((e) => e.id)).toEqual(['e3'])
    expect(t.statusText()).toBe('podium v0.11.0 ● 4 live')
    expect(t.online).toBe(true)
  })

  test('reads which loops someone is watching from the reply, and nothing from a server that does not say (#118)', async () => {
    const reply = (watch: unknown): HttpResult => ({ status: 200, ok: true, text: JSON.stringify({ ok: true, watch }) })
    const run = async (r: HttpResult) => {
      const t = new Transport(fake([r]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.13.0' })
      await t.send(build, 0)
      return t.watch
    }
    expect(await run(reply(['a1', '@orchestrator']))).toEqual(['a1', '@orchestrator'])
    expect(await run(reply(['a1', 7, null]))).toEqual(['a1'])
    expect(await run(reply('a1'))).toEqual([])
    expect(await run(ok())).toEqual([])
  })

  test('reads whether the server takes answers, and the messages it hands over, and nothing from an older server (#206)', async () => {
    const d = { id: 'dlv_1', askId: null, by: 'Ed', at: 1, kind: 'message', text: 'hi' }
    const run = async (body: unknown) => {
      const t = new Transport(fake([{ status: 200, ok: true, text: JSON.stringify(body) }]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.14.0' })
      await t.send(build, 0)
      return [t.respond, t.deliveries]
    }
    expect(await run({ ok: true, respond: true, deliveries: [d, { id: 7 }, null] })).toEqual([true, [d]])
    expect(await run({ ok: true, respond: false, deliveries: [d] })).toEqual([false, []])
    expect(await run({ ok: true })).toEqual([false, []])
  })

  test('reads where the server places this reporter, and says what to do about it', async () => {
    const reply = (c: unknown): HttpResult => ({ status: 200, ok: true, text: JSON.stringify({ ok: true, liveSessions: 2, serverVersion: '0.3.0', reporterCompat: c }) })
    const run = async (r: HttpResult) => {
      const t = new Transport(fake([r]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
      await t.send(build, 0)
      return t
    }
    const outdated = await run(reply('outdated'))
    expect(outdated.statusText()).toBe('podium v0.11.0 ● 2 live · update mod')
    expect(outdated.versionNotice()).toContain('update the podium-reporter mod')
    const newer = await run(reply('newer'))
    expect(newer.statusText()).toBe('podium v0.11.0 ● 2 live · upgrade server')
    expect(newer.versionNotice()).toContain('upgrade the Podium server')
    for (const quiet of [reply('ok'), reply('unknown'), reply('garbage'), ok(0, 2)]) {
      const t = await run(quiet)
      expect(t.statusText()).toBe('podium v0.11.0 ● 2 live')
      expect(t.versionNotice()).toBeNull()
    }
  })

  test('clears the notice once the server says the versions match again', async () => {
    const bad = { status: 200, ok: true, text: '{"ok":true,"reporterCompat":"outdated"}' }
    const good = { status: 200, ok: true, text: '{"ok":true,"reporterCompat":"ok"}' }
    const t = new Transport(fake([bad, good]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    await t.send(build, 0)
    expect(t.versionNotice()).not.toBeNull()
    await t.send(build, 10)
    expect(t.versionNotice()).toBeNull()
  })

  test('shows the version before the server has answered', () => {
    const t = new Transport(fake([]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    expect(t.statusText()).toBe('podium v0.11.0 ○ connecting')
  })

  test('says an update is available when the server supports a newer minor, and not at or above it', async () => {
    const reply = (version: string, max: string, compat = 'ok'): HttpResult => ({
      status: 200,
      ok: true,
      text: JSON.stringify({ ok: true, liveSessions: 3, serverVersion: '0.12.0', reporterSupport: { min: '0.9.0', max }, reporterCompat: compat }),
    })
    const run = async (version: string, r: HttpResult) => {
      const t = new Transport(fake([r]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version })
      await t.send(build, 0)
      return t
    }
    const behind = await run('0.11.0', reply('0.11.0', '0.12.0'))
    expect(behind.statusText()).toBe('podium v0.11.0 ● 3 live · update available')
    // the mild hint is for /podium only: versionNotice also drives a toast
    expect(behind.versionNotice()).toBeNull()
    expect(behind.updateNotice()).toContain('0.12')
    // a patch difference is not flagged
    expect((await run('0.11.0', reply('0.11.0', '0.11.4'))).statusText()).toBe('podium v0.11.0 ● 3 live')
    expect((await run('0.12.0', reply('0.12.0', '0.12.0'))).statusText()).toBe('podium v0.12.0 ● 3 live')
    // below min keeps the stronger hint, and only that one
    expect((await run('0.8.0', reply('0.8.0', '0.12.0', 'outdated'))).statusText()).toBe('podium v0.8.0 ● 3 live · update mod')
    expect((await run('0.13.0', reply('0.13.0', '0.12.0', 'newer'))).statusText()).toBe('podium v0.13.0 ● 3 live · upgrade server')
    // an older server never says what it supports: no hint
    expect((await run('0.11.0', ok(0, 3))).statusText()).toBe('podium v0.11.0 ● 3 live')
  })

  test('sends at most 100 events per report', async () => {
    const f = fake([ok()])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    t.enqueue(Array.from({ length: 250 }, (_, i) => ev(i)))
    await t.send(build, 0)
    expect(f.calls[0]!.body.events).toHaveLength(100)
    expect(t.queue).toHaveLength(150)
  })

  test('a 400 drops that report and its events, and is not retried', async () => {
    const f = fake([{ status: 400, ok: false, text: '{"ok":false,"error":"bad","path":"$.v"}' }])
    const logs: string[] = []
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' }, (l) => logs.push(l))
    t.enqueue([ev(1)])
    expect(await t.send(build, 0)).toBe('rejected')
    expect(t.queue).toEqual([])
    expect(t.rejected).toBe(1)
    expect(logs).toHaveLength(1)
  })

  test('a 409 (the session belongs to someone else) is a rejection, not an outage', async () => {
    const f = fake([{ status: 409, ok: false, text: '{"ok":false,"error":"that session belongs to someone else"}' }])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    t.enqueue([ev(1)])
    expect(await t.send(build, 0)).toBe('rejected')
    expect(t.queue).toEqual([])
    expect(t.failures).toBe(0)
  })

  test('a rejected report backs off like a failure, so a persistently rejected snapshot is not re-posted every tick', async () => {
    const bad: HttpResult = { status: 400, ok: false, text: '{"ok":false}' }
    const f = fake([bad, bad, bad, ok()])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
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
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: 'pdm_x', heartbeatMs: 5000, version: '0.11.0' }, (l) => logs.push(l))
    t.enqueue([ev(1)])
    expect(await t.send(build, 100)).toBe('refused')
    expect(t.queue.map((e) => e.id)).toEqual(['e1'])
    expect(t.nextAttemptAt).toBe(100 + 60_000)
    expect(t.due(100 + 59_999, true)).toBe(false)
    expect(t.due(100 + 60_000, true)).toBe(true)
    expect(t.statusText()).toBe('podium v0.11.0 ○ token refused')
    expect(t.refusalNotice()).toContain('token')
    expect(await t.send(build, 60_100)).toBe('refused')
    expect(logs).toHaveLength(1)
    expect(logs.join('')).not.toContain('pdm_x')
    expect(await t.send(build, 120_100)).toBe('ok')
    expect(t.refusalNotice()).toBeNull()
    expect(t.queue).toEqual([])
  })

  test('a 409 says the session belongs to someone else instead of "connecting", logs once, and a later success clears it (#209)', async () => {
    const conflict: HttpResult = { status: 409, ok: false, text: '{"ok":false,"error":"that session belongs to someone else","path":"$.session.id"}' }
    const f = fake([conflict, conflict, ok()])
    const logs: string[] = []
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: 'pdm_x', heartbeatMs: 5000, version: '0.11.0' }, (l) => logs.push(l))
    expect(t.ownerNotice()).toBeNull()
    expect(await t.send(build, 100)).toBe('rejected')
    expect(t.statusText()).toBe('podium v0.11.0 ○ refused: session belongs to someone else')
    expect(t.ownerNotice()).toContain('Start a new session')
    expect(await t.send(build, 1100)).toBe('rejected')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('belongs to someone else')
    expect(logs.join('')).not.toContain('pdm_x')
    expect(await t.send(build, 4100)).toBe('ok')
    expect(t.statusText()).toBe('podium v0.11.0 ● 1 live')
    expect(t.ownerNotice()).toBeNull()
  })

  test('a 400 is not shown as a refusal by someone else (#209)', async () => {
    const f = fake([{ status: 400, ok: false, text: '{"ok":false}' }])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    expect(await t.send(build, 100)).toBe('rejected')
    expect(t.ownerNotice()).toBeNull()
    expect(t.statusText()).toBe('podium v0.11.0 ○ connecting')
  })

  test('a network error keeps the events and backs off 1, 2, 5, 10, 10 s', async () => {
    const f = fake([new Error('ECONNREFUSED'), new Error('x'), new Error('x'), new Error('x'), { status: 503, ok: false, text: '' }])
    const t = new Transport(f.fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
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
    expect(t.statusText()).toBe('podium v0.11.0 ○ offline')
    expect(t.lastError).toBe('HTTP 503')
    // the first success afterwards sends the full snapshot plus every queued event, and resets the backoff
    expect(await t.send(build, now)).toBe('ok')
    expect(f.calls.at(-1)!.body.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(t.failures).toBe(0)
    expect(t.queue).toEqual([])
  })

  test('the queue holds at most 500 events, dropping the oldest', () => {
    const t = new Transport(fake([]).fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
    t.enqueue(Array.from({ length: 520 }, (_, i) => ev(i)))
    expect(t.queue).toHaveLength(QUEUE_MAX)
    expect(t.queue[0]!.id).toBe('e20')
    expect(t.dropped).toBe(20)
  })

  test('due: on change, on queued events, or when the heartbeat is due; never twice at once', async () => {
    let release: (r: HttpResult) => void = () => {}
    const fetch: FetchLike = () => new Promise((res) => (release = res))
    const t = new Transport(fetch, { serverUrl: 'http://h', token: '', heartbeatMs: 5000, version: '0.11.0' })
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
