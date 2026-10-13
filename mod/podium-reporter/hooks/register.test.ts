import { describe, test, expect, mock, type Engine } from 'claude-code/testing'
import type { AgentSpawnInput, CommandRunInput, On } from 'claude-code'
import type { Report } from './protocol.ts'

// The test runner has a console; the hooks sandbox's declarations do not.
declare const console: { log: (...args: unknown[]) => void }

const SID = 'sess-e2e-0001'
/** A compaction leaves at least one message: its summary. */
const SUMMARY = [{ role: 'user' as const, text: 'Summary of the work so far.', toolUses: [] }]
const CWD = '/Users/dev/app/.claude/worktrees/feat-x'

interface World {
  posts: Report[]
  headers: Record<string, string>[]
  clock: ReturnType<typeof mock.clock>
  lastToolUseId: () => string
  sessionId: { value: string }
  fetchMode: { mode: 'ok' | 'down' | 'hang' }
  /** The clients attached to the session, as `$.session.surfaces()` answers. */
  surfaces: { value: ('terminal' | 'desktop' | 'vscode' | 'mobile')[]; fail: boolean }
  /** Every command the plugin ran, as its argument vector. */
  ran: string[][]
  /** `$.model.fork`: each prompt it was given, and how the next call answers (`hang`: not until `release()`). */
  fork: { prompts: string[]; reply: 'ok' | 'api-error' | 'nothing' | 'hang'; release: () => void }
}

const GIT: Record<string, string> = {
  'rev-parse --abbrev-ref HEAD': 'feat/x',
  'rev-parse --git-dir': '/Users/dev/app/.git/worktrees/feat-x',
  'rev-parse --git-common-dir': '/Users/dev/app/.git',
  'rev-parse --show-toplevel': CWD,
  'status --porcelain=v1 -b': '## feat/x...origin/feat/x [ahead 2]\n M src/a.ts\n',
}

/** Everything beneath the plugin: the engine's answers, from memory. */
function world(on: On, store: Record<string, unknown> = {}): World {
  const posts: Report[] = []
  const headers: Record<string, string>[] = []
  const sessionId = { value: SID }
  const fetchMode: World['fetchMode'] = { mode: 'ok' }
  const surfaces: World['surfaces'] = { value: ['terminal'], fail: false }
  let toolUseId = ''
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on, store)
  const ran: string[][] = []
  const fork: World['fork'] = { prompts: [], reply: 'ok', release: () => {} }
  const answered = { value: { isAnswered: true as const, text: 'OK', usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0 } } }
  on('model.fork', (_$, e) => {
    fork.prompts.push(e.prompt)
    if (fork.reply === 'nothing') return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
    if (fork.reply === 'api-error') return { value: { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    if (fork.reply === 'hang') return new Promise((resolve) => (fork.release = () => resolve(answered)))
    return answered
  })
  on('session.id', () => ({ value: sessionId.value }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: CWD }))
  on('session.repo', () => ({ value: { root: '/Users/dev/app', remote: 'git@github.com:acme/app.git', internal: false, name: null } }))
  on('session.version', () => ({ value: { version: '2.1.296' } }))
  on('session.usage', () => ({ value: { startedAt: 1_800_000_000_000, context: { tokens: 120_000, window: 1_000_000, percent: 12 }, rateLimits: [], cost: { usd: 1.25 } } }))
  on('session.surfaces', () => {
    if (surfaces.fail) throw new Error('no roster')
    return { value: surfaces.value }
  })
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', (_$, e) => ({ clientId: e.clientId }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'podium' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__podium-reporter__plan' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'hostname') return { value: { exitCode: 0, stdout: 'Devs-MBP.local\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: e.argv[1] === 'rev-parse' || e.argv[1] === 'status' ? 0 : 1, stdout: GIT[e.argv.slice(1).join(' ')] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_$, e) => {
    if (fetchMode.mode === 'down') throw new Error('ECONNREFUSED')
    const body = JSON.parse(e.init?.body ?? '{}') as Report
    if (fetchMode.mode === 'hang') return new Promise(() => {})
    posts.push(body)
    headers.push(e.init?.headers ?? {})
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, ackedEvents: body.events.length, liveSessions: 3 }) } }
  })
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', () => ({ messages: SUMMARY, tokensBefore: 1_000_000, tokensAfter: 300_000 }))
  on('agent.spawn', (_$, e) => ({ model: e.fork ? e.parentModel : e.model === 'haiku' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5', agentId: e.fork ? 'a-fork' : e.description === 'Backfill dry run' ? 'a-fail' : 'a-sub' }))
  on('tool.call', (_$, e) => {
    toolUseId = e.tool_use_id
    if (e.tool === 'TaskCreate') return { result: { task: { id: '1', subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
    if (e.tool === 'Bash' && e.command.startsWith('npm test')) return { isError: true, result: 'Exit code 1\nFAIL src/a.test.ts', text: 'Exit code 1\nFAIL src/a.test.ts' }
    return { result: { ok: true }, text: 'ok' }
  })
  on('turn.step', async function* (_$, e) {
    const big = e.agentId === 'a-fail'
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: big ? 'model_context_window_exceeded' : 'end_turn',
      usage: { input_tokens: big ? 990_000 : 2000, output_tokens: 300, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 1000, model: e.model },
    }
  })
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.SessionStart', () => ({}))
  return { posts, headers, clock, lastToolUseId: () => toolUseId, sessionId, fetchMode, surfaces, ran, fork }
}

type StepArgs = Parameters<Engine['turn']['step']>[0]

/** Raises one model request and reads its stream to the end, as the engine's loop does. */
async function stepOnce($: Engine, input: StepArgs) {
  // `for await` drops a generator's return value, which is the step's result: read it by hand.
  const s = $.turn.step(input)
  let r = await s.next()
  while (!r.done) r = await s.next()
  return r.value
}

const spawnInput = (over: Partial<AgentSpawnInput> & { tool_use_id: string }): AgentSpawnInput => ({
  prompt: 'Do the task.',
  description: 'Map call sites',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
  ...over,
})

/** `/podium <args>` typed at the prompt. */
const podium = (args: string): CommandRunInput => ({ command: 'podium', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

/** One prompt on the main loop: a turn with one model request, then the session waits on the person. */
async function mainTurn($: Engine, turnId = 't1') {
  await $.turn.start({ text: 'go', turnId })
  await stepOnce($, { turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
}

const MIN = 60_000

describe('podium-reporter end to end', () => {
  test('raises every hooked event and posts agents, plan, failure, blowouts and skills', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    expect(w.posts.length).toBe(1)
    expect(w.posts[0]!.session).toMatchObject({ id: SID, name: 'x', repoName: 'acme/app', costUsd: 1.25 })
    expect(w.posts[0]!.events.map((e) => e.kind)).toContain('start')

    await $.turn.start({ text: 'go', turnId: 't1' })
    await stepOnce($, { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Map call sites', description: 'find them', metadata: { planTitle: 'Migrate invoices' } })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await $.tool.call({ tool: 'Skill', skill: 'repo-map' })

    // a subagent: the Agent call asks for effort low; its own steps then show medium
    await $.tool.call({ tool: 'Agent', description: 'Map call sites', prompt: 'Do the task.', subagent_type: 'Explore', model: 'haiku', effort: 'low' })
    await $.agent.spawn(spawnInput({ tool_use_id: w.lastToolUseId(), model: 'haiku' }))
    await stepOnce($, { turnId: 'ta', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 2, agentId: 'a-sub' })
    await $.turn.complete({ answer: 'Found 3 call sites.', durationMs: 900, isAborted: false, turnId: 'ta', agentId: 'a-sub', reason: 'answer' })

    // a fork: inherits model and effort
    await $.tool.call({ tool: 'Agent', description: 'Draft schema', prompt: 'Draft it.', subagent_type: 'fork', effort: 'max' })
    await $.agent.spawn(spawnInput({ tool_use_id: w.lastToolUseId(), description: 'Draft schema', subagentType: 'fork', fork: true }))

    // a subagent that exceeds its window, auto-compacts, and dies on an API error
    await $.agent.spawn(spawnInput({ tool_use_id: 'tu-fail', description: 'Backfill dry run', subagentType: 'general-purpose', model: 'sonnet' }))
    await stepOnce($, { turnId: 'tf', index: 0, model: 'claude-sonnet-5-5', messageCount: 9, agentId: 'a-fail' })
    await $.session.compact({ trigger: 'auto', agentId: 'a-fail', messages: SUMMARY })
    await $.turn.complete({ answer: '', durationMs: 900, isAborted: false, turnId: 'tf', agentId: 'a-fail', reason: 'error' })

    // the orchestrator: a failing Bash, a permission prompt, an automatic compaction
    await $.tool.call({ tool: 'Bash', command: 'npm test -- a.test.ts' })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } })
    await w.clock.advance(1000)
    const waiting = w.posts.at(-1)!.session
    expect(waiting).toMatchObject({ status: 'waiting', waitReason: 'permission', waitNote: 'Bash(rm -rf dist)' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.session.compact({ trigger: 'auto', messages: SUMMARY })
    await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(1000)

    const r = w.posts.at(-1)!
    const agent = (id: string) => r.agents.find((a) => a.id === id)!
    expect(agent('a-sub')).toMatchObject({ kind: 'subagent', type: 'Explore', status: 'done', model: 'claude-haiku-5-5', effort: 'medium', effortSource: 'observed', answerExcerpt: 'Found 3 call sites.' })
    expect(agent('a-fork')).toMatchObject({ kind: 'fork', type: 'fork', status: 'running', model: 'claude-opus-5-5', effort: 'high', effortSource: 'inherited' })
    expect(agent('a-fail')).toMatchObject({ status: 'failed', blowouts: 1 })
    expect(agent('a-fail').failure!.class).toBe('Context window exhausted')
    expect(agent('a-fail').failure!.evidence[0]).toContain('exceeded the context window 1 time')
    expect(r.session.plan).toMatchObject({ title: 'Migrate invoices', source: 'TaskCreate' })
    expect(r.session.plan!.steps[0]).toMatchObject({ id: '1', state: 'active', ownerAgentId: 'a-sub', ownerLabel: 'Explore · Haiku medium' })
    expect(r.session.blowouts).toBe(1)
    expect(r.session.git).toEqual({ branch: 'feat/x', detached: false, isWorktree: true, worktreePath: CWD, ahead: 2, behind: 0, dirty: 1 })
    expect(r.session.status).toBe('running') // the fork still runs
    expect(r.session.waitReason).toBeNull()
    const all = w.posts.flatMap((p) => p.events)
    expect(all.some((e) => e.kind === 'skill' && e.text === 'repo-map loaded into orchestrator')).toBe(true)
    expect(all.filter((e) => e.kind === 'blow').map((e) => e.data?.kind)).toEqual(['window-exceeded', 'auto-compact'])
    expect(all.some((e) => e.kind === 'fail' && e.agentId === 'a-fail')).toBe(true)
    expect(all.some((e) => e.kind === 'wait')).toBe(true)
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)

    // session.end flushes the final report before the hook returns
    const before = w.posts.length
    await $.session.end({ reason: 'prompt_input_exit', sessionId: SID, resume: { id: SID } })
    expect(w.posts.length).toBe(before + 1)
    expect(w.posts.at(-1)!.session).toMatchObject({ status: 'done', endReason: 'prompt_input_exit', resumeId: SID })
    expect(agent('a-fork').status).toBe('running')
    expect(w.posts.at(-1)!.agents.find((a) => a.id === 'a-fork')!.status).toBe('aborted')
    // timers stop with the process
    await w.clock.advance(10_000)
    expect(w.posts.length).toBe(before + 1)
  })

  test('the token header is sent only when configured', { options: { token: 's3cret' } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect(w.headers[0]!['X-Podium-Token']).toBe('s3cret')
  })

  test('every hook passes the engine result through unchanged', async ($, on) => {
    world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    expect(await $.tool.call({ tool: 'Bash', command: 'npm test' })).toMatchObject({ isError: true, text: 'Exit code 1\nFAIL src/a.test.ts' })
    expect(await $.tool.call({ tool: 'Read', file_path: '/x' })).toMatchObject({ result: { ok: true }, text: 'ok' })
    expect(await $.turn.start({ text: 'x', turnId: 'q' })).toEqual({ turnId: 'q' })
    const st = await stepOnce($, { turnId: 'q', index: 0, model: 'opus', messageCount: 1 })
    expect(st.stopReason).toBe('end_turn')
    expect(await $.session.compact({ trigger: 'manual', messages: SUMMARY })).toMatchObject({ tokensAfter: 300_000 })
    expect(await $.agent.spawn(spawnInput({ tool_use_id: 'z' }))).toEqual({ model: 'claude-sonnet-5-5', agentId: 'a-sub' })
  })

  test('the tool path never waits for the network', async ($, on) => {
    const w = world(on)
    w.fetchMode.mode = 'hang'
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000) // a flush is now stuck in fetch
    const t0 = Date.now()
    const res = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(res).toMatchObject({ text: 'ok' })
    await $.turn.start({ text: 'x', turnId: 'q' })
    await stepOnce($, { turnId: 'q', index: 0, model: 'opus', messageCount: 1 })
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  test('with the server down, events wait in the queue and arrive once it is back', async ($, on) => {
    const w = world(on)
    w.fetchMode.mode = 'down'
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Skill', skill: `skill-${i}` })
    await w.clock.advance(30_000)
    expect(w.posts.length).toBe(0)
    w.fetchMode.mode = 'ok'
    await w.clock.advance(11_000)
    const kinds = w.posts.flatMap((p) => p.events).map((e) => e.text)
    for (let i = 0; i < 5; i++) expect(kinds).toContain(`skill-${i} loaded into orchestrator`)
    const help = await $.command.run(podium(''))
    expect(help.text).toContain('Connection: online')
    expect(help.text).toMatch(/failed: [1-9]/)
  })

  test('with the server down the reporter adds under 5 ms per hook (its own time, measured)', async ($, on) => {
    const w = world(on)
    w.fetchMode.mode = 'down'
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    for (let i = 0; i < 300; i++) {
      await $.tool.call({ tool: 'Read', file_path: `/f${i % 7}` })
      if (i % 10 === 0) await w.clock.advance(1000)
      await stepOnce($, { turnId: 'q', index: i, model: 'claude-opus-5-5', effort: 'high', messageCount: i })
    }
    const text = (await $.command.run(podium(''))).text ?? ''
    const line = text.split('\n').find((l) => l.startsWith('Reporter time per hook:')) ?? ''
    console.log(`[podium-latency] ${line}`)
    const avgs = [...line.matchAll(/([\w.]+) ([\d.]+) ms avg, ([\d.]+) max/g)].map((m) => ({ hook: m[1]!, avg: Number(m[2]), max: Number(m[3]) }))
    expect(avgs.length).toBeGreaterThan(2)
    for (const a of avgs) expect(a.avg).toBeLessThan(5)
    expect(text).toContain('offline')
  })

  test('server down for 2 minutes, then up: no event is lost', async ($, on) => {
    const w = world(on)
    w.fetchMode.mode = 'down'
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    // events keep arriving all through the outage: 24 skills, one every 5 s
    for (let i = 0; i < 24; i++) {
      await $.tool.call({ tool: 'Skill', skill: `outage-${i}` })
      await w.clock.advance(5000)
    }
    expect(w.posts.length).toBe(0)
    w.fetchMode.mode = 'ok'
    await w.clock.advance(12_000)
    const texts = new Set(w.posts.flatMap((p) => p.events).map((e) => e.text))
    for (let i = 0; i < 24; i++) expect(texts.has(`outage-${i} loaded into orchestrator`)).toBe(true)
    expect(texts.has('session.start · Opus')).toBe(true)
  })

  test('fullPrompts off (default): only the 400-character excerpt leaves', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput({ tool_use_id: 'f1', prompt: '# Task\n\nDo it.' }))
    await w.clock.advance(3000)
    const a = w.posts.at(-1)!.agents[0]!
    expect(a.promptExcerpt).toBe('# Task Do it.')
    expect('promptText' in a).toBe(false)
  })

  test('fullPrompts on: the whole prompt goes out once, then not again', { options: { fullPrompts: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput({ tool_use_id: 'f1', prompt: '# Task\n\nDo it.' }))
    await w.clock.advance(3000)
    const first = w.posts.filter((p) => p.agents[0]?.promptText)
    expect(first.length).toBe(1)
    expect(first[0]!.agents[0]!.promptText).toBe('# Task\n\nDo it.')
    await w.clock.advance(12_000)
    expect(w.posts.filter((p) => p.agents[0]?.promptText).length).toBe(1)
    expect(w.posts.length).toBeGreaterThan(1)
  })

  test('explainFailures off (default): no model call', async ($, on) => {
    const w = world(on)
    let calls = 0
    on('model.complete', () => {
      calls++
      return { value: { isAnswered: true, text: 'x', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput({ tool_use_id: 'f1', description: 'Backfill dry run', subagentType: 'general-purpose' }))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a-fail', reason: 'error' })
    await w.clock.advance(3000)
    expect(calls).toBe(0)
    expect(w.posts.at(-1)!.agents[0]!.failure!.explanation).toBeNull()
  })

  test('explainFailures on: one haiku call per failure, from the redacted record, never retried', { options: { explainFailures: true } }, async ($, on) => {
    const w = world(on)
    const prompts: string[] = []
    let fail = true
    on('model.complete', (_$, e) => {
      prompts.push(String(e.prompt))
      expect(e.model).toBe('haiku')
      expect(e.effort).toBe('low')
      if (fail) {
        fail = false
        return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
      }
      return { value: { isAnswered: true, text: 'The staging database was not reachable.   Start it first.', usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    // first failure: the call errors, and is not retried
    await $.agent.spawn(spawnInput({ tool_use_id: 'f1', description: 'Backfill dry run', subagentType: 'general-purpose', prompt: 'password=hunter2 run it' }))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a-fail', reason: 'error' })
    await w.clock.advance(1000)
    await w.clock.advance(5000)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Class: Model API error')
    expect(prompts[0]).not.toContain('hunter2')
    expect(w.posts.at(-1)!.agents.find((a) => a.id === 'a-fail')!.failure!.explanation).toBeNull()
    // second failure (another agent): explained once
    await $.agent.spawn(spawnInput({ tool_use_id: 'f2', description: 'Second', subagentType: 'general-purpose' }))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'y', agentId: 'a-sub', reason: 'error' })
    await w.clock.advance(1000)
    await w.clock.advance(2000)
    expect(prompts).toHaveLength(2)
    const a = w.posts.at(-1)!.agents.find((x) => x.id === 'a-sub')!
    expect(a.failure!.explanation).toBe('The staging database was not reachable. Start it first.')
    expect(a.costUsdEst).toBeGreaterThan(0)
  })

  test('explainFailures on: a later failure of the same agent is explained again, but one failure only once', { options: { explainFailures: true } }, async ($, on) => {
    const w = world(on)
    const prompts: string[] = []
    on('model.complete', (_$, e) => {
      prompts.push(String(e.prompt))
      return { value: { isAnswered: true, text: `explanation ${prompts.length}`, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput({ tool_use_id: 'r1', description: 'Backfill dry run', subagentType: 'general-purpose' }))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a-fail', reason: 'error' })
    await w.clock.advance(1000)
    await w.clock.advance(3000)
    await w.clock.advance(3000) // several flushes later: still one call for this failure
    expect(prompts).toHaveLength(1)
    expect(w.posts.at(-1)!.agents.find((a) => a.id === 'a-fail')!.failure!.explanation).toBe('explanation 1')
    // the same agent id is retried and fails again later: a new failure, a new explanation
    await $.agent.spawn(spawnInput({ tool_use_id: 'r2', description: 'Backfill dry run', subagentType: 'general-purpose' }))
    await w.clock.advance(5000)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'y', agentId: 'a-fail', reason: 'error' })
    await w.clock.advance(1000)
    await w.clock.advance(3000)
    expect(prompts).toHaveLength(2)
    expect(w.posts.at(-1)!.agents.find((a) => a.id === 'a-fail')!.failure!.explanation).toBe('explanation 2')
  })

  test('a throw inside the reporter leaves the session unaffected', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    // a malformed classic payload makes the reporter's own reducer throw
    const res = await $.classic.Notification({ notification_type: 'idle_prompt', message: undefined as unknown as string })
    expect(res).toEqual({})
    // the session goes on, and the reporter keeps reporting
    expect(await $.tool.call({ tool: 'Read', file_path: '/x' })).toMatchObject({ text: 'ok' })
    await w.clock.advance(1000)
    expect(w.posts.length).toBe(1)
  })

  test('/podium shows the dashboard URL and state; /podium name sets and keeps the name', { options: { serverUrl: 'http://127.0.0.1:5999' } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    const info = await $.command.run(podium(''))
    expect(info.text).toContain('Podium fleet console: http://127.0.0.1:5999/#/')
    expect(info.text).toContain('Connection: online (3 live sessions)')
    expect(info.text).toContain('Reports sent: 1, failed: 0')
    expect(info.text).toContain('Last error: none')
    const named = await $.command.run(podium('name invoice work'))
    expect(named.text).toContain('"invoice work"')
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.name).toBe('invoice work')
    // the name is kept in $.store: a reload (session.start again) still has it
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.name).toBe('invoice work')
  })

  test('reports whether any client is attached, from the roster', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.attached).toBe(true)
    w.surfaces.value = []
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.attached).toBe(false)
    w.surfaces.value = ['terminal']
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.attached).toBe(true)
  })

  test('session.detach and session.attach pass through and the next report follows the roster', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    w.surfaces.value = []
    expect(await $.session.detach({ surface: 'terminal', clientId: 'terminal:default', reason: 'detach' })).toEqual({ clientId: 'terminal:default' })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.attached).toBe(false)
    w.surfaces.value = ['terminal']
    expect(await $.session.attach({ surface: 'terminal', clientId: 'terminal:default' })).toEqual({ clientId: 'terminal:default' })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.attached).toBe(true)
  })

  test('a failing roster read leaves the flag unknown rather than detached', async ($, on) => {
    const w = world(on)
    w.surfaces.fail = true
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.attached).toBeNull()
  })

  test('a /clear: the old id gets a final done report and reporting continues under the new id', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } })
    expect(w.posts.at(-1)!.session).toMatchObject({ id: SID, status: 'done', endReason: 'clear' })
    w.sessionId.value = 'sess-after-clear'
    await w.clock.advance(1000)
    const next = w.posts.at(-1)!
    expect(next.session.id).toBe('sess-after-clear')
    expect(next.session.status).not.toBe('done')
    expect(next.events.map((e) => e.kind)).toContain('start')
    expect(next.events.every((e) => e.id.startsWith('sess-after-clear:'))).toBe(true)
  })

  test('a session id change without session.end still closes the old id', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    w.sessionId.value = 'sess-resumed'
    await w.clock.advance(1000)
    const ids = w.posts.map((p) => [p.session.id, p.session.status])
    expect(ids).toContainEqual([SID, 'done'])
    expect(w.posts.at(-1)!.session.id).toBe('sess-resumed')
  })

  test('the userName option is sent with every report, and is left out when empty', { options: { userName: 'Dana' } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect(w.posts[0]!.userName).toBe('Dana')
  })

  test('no userName is sent when the option is empty', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect('userName' in w.posts[0]!).toBe(false)
  })

  test('with a userName the report names the machine: its short host name and a random id that stays', { options: { userName: 'Dana' } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    const m = w.posts[0]!.machine!
    expect(m.name).toBe('Devs-MBP')
    expect(m.id).toMatch(/^[0-9a-f]{12}$/)
    await w.clock.advance(5000)
    expect(w.posts.at(-1)!.machine).toEqual(m)
  })

  test('a machine id already kept in the store is reused', { options: { userName: 'Dana' } }, async ($, on) => {
    const w = world(on, { machineId: 'abcdef012345' })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect(w.posts[0]!.machine).toEqual({ name: 'Devs-MBP', id: 'abcdef012345' })
  })

  test('a kept id that is not one the mod made is replaced', { options: { userName: 'Dana' } }, async ($, on) => {
    const w = world(on, { machineId: '<b>not-mine</b>' })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect(w.posts[0]!.machine!.id).toMatch(/^[0-9a-f]{12}$/)
  })

  test('without a userName nothing about the machine is read or sent', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect('machine' in w.posts[0]!).toBe(false)
    expect(w.ran.some((argv) => argv[0] === 'hostname')).toBe(false)
  })

  test('the sessionName option names the session', { options: { sessionName: 'from-option' } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    await w.clock.advance(1000)
    expect(w.posts[0]!.session.name).toBe('from-option')
  })
})

describe('podium-reporter prompt cache', () => {
  test('reports when the last main-loop request started and the cache lifetime', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache).toMatchObject({ lastRequestAt: null, ttlMs: 300_000 })
    const t0 = w.clock.now()
    await mainTurn($)
    await w.clock.advance(1000)
    const c = w.posts.at(-1)!.session.cache!
    expect(c).toMatchObject({ ttlMs: 300_000, tokens: 120_000 })
    // on the engine's clock (Date.now() here is months away from the kit's), timed without a host call per request:
    // Date.now() plus the offset the last flush read, so within the real milliseconds the test took since then
    expect(c.lastRequestAt! - t0).toBeGreaterThanOrEqual(0)
    expect(c.lastRequestAt! - t0).toBeLessThan(1000)
    // a cold start writes the 120k tokens at $5 instead of reading them at $0.20 per million (Opus)
    expect(Math.abs(c.coldCostUsd! - (120_000 * (5 - 0.2) / 1e6))).toBeLessThan(1e-6)
    expect(c.warming).toMatchObject({ on: false, state: 'off', pings: 0 })
    // an agent's requests use its own cache, not the main thread's
    await w.clock.advance(5000)
    await $.agent.spawn(spawnInput({ tool_use_id: 'c1' }))
    await stepOnce($, { turnId: 'ta', index: 0, model: 'claude-sonnet-5-5', messageCount: 2, agentId: 'a-sub' })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.lastRequestAt).toBe(c.lastRequestAt)
    // the session says it uses the 1-hour lifetime
    await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-opus-5-5', requested_model: 'opus', source: 'command', context_tokens: 120_000, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 0.9, pricing: 'catalog' } as never)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.ttlMs).toBe(3_600_000)
  })

  test('warming off (the default): nothing is sent however long the session idles', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(12 * MIN)
    expect(w.fork.prompts).toHaveLength(0)
    expect(w.posts.at(-1)!.session.cache!.warming.state).toBe('off')
  })

  test('warming on: one ping a minute before each expiry, each counted and in the activity', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    const rows = mock.session(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    const t0 = w.clock.now()
    await mainTurn($)
    await w.clock.advance(4 * MIN - 1000)
    expect(w.fork.prompts).toHaveLength(0)
    await w.clock.advance(2000)
    expect(w.fork.prompts).toEqual(['Reply with OK.'])
    await w.clock.advance(1000)
    // the first flush at or after 4 minutes from the request's start (which is within a second of t0)
    const firstPing = w.posts.at(-1)!.session.cache!.warming.lastPingAt!
    expect(firstPing - (t0 + 4 * MIN)).toBeGreaterThanOrEqual(0)
    expect(firstPing - (t0 + 4 * MIN)).toBeLessThanOrEqual(1000)
    // the next ping is measured from the start of this one
    await w.clock.set(firstPing + 4 * MIN - 1000)
    expect(w.fork.prompts).toHaveLength(1)
    await w.clock.set(firstPing + 4 * MIN)
    expect(w.fork.prompts).toHaveLength(2)
    await w.clock.advance(1000)
    const c = w.posts.at(-1)!.session.cache!
    expect(c.warming).toMatchObject({ on: true, state: 'warming', pings: 2, lastPingAt: firstPing + 4 * MIN })
    // the idle period starts when the reporter next looks (each second) after the turn ends; it lasts 30 minutes
    expect(c.warming.untilAt! - (t0 + 30 * MIN)).toBeGreaterThanOrEqual(0)
    expect(c.warming.untilAt! - (t0 + 30 * MIN)).toBeLessThanOrEqual(1000)
    expect(c.lastRequestAt).toBe(firstPing + 4 * MIN)
    expect(Math.abs(c.warming.costUsdEst - (2 * (5 * 4 + 2 * 20 + 120_000 * 0.2) / 1e6))).toBeLessThan(1e-8)
    const pings = w.posts.flatMap((p) => p.events).filter((e) => e.data?.kind === 'cache-ping')
    expect(pings).toHaveLength(2)
    expect(pings[0]!.text).toContain('120k tokens read from the cache')
    // nothing was added to the conversation
    expect(rows.appended()).toHaveLength(0)
  })

  test('warming stops at the maximum duration of an idle period', { options: { cacheWarming: true, cacheWarmingMinutes: 10 } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(15 * MIN)
    expect(w.fork.prompts).toHaveLength(2) // at 4 and 8 minutes
    const r = w.posts.at(-1)!
    expect(r.session.cache!.warming).toMatchObject({ state: 'stopped', stopReason: 'max-duration', pings: 2 })
    expect(w.posts.flatMap((p) => p.events).some((e) => e.data?.kind === 'cache-stop' && e.text.includes('10-minute limit'))).toBe(true)
  })

  test('an API error stops warming, and it is not retried', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    w.fork.reply = 'api-error'
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(12 * MIN)
    expect(w.fork.prompts).toHaveLength(1)
    expect(w.posts.at(-1)!.session.cache!.warming).toMatchObject({ state: 'stopped', stopReason: 'api-error', pings: 0 })
  })

  test('nothing to fork stops warming', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    w.fork.reply = 'nothing'
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(10 * MIN)
    expect(w.fork.prompts).toHaveLength(1)
    expect(w.posts.at(-1)!.session.cache!.warming.stopReason).toBe('nothing-to-fork')
  })

  test('after /clear there is nothing to keep warm', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(MIN)
    await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } })
    w.sessionId.value = 'sess-after-clear'
    await w.clock.advance(10 * MIN)
    expect(w.fork.prompts).toHaveLength(0)
    expect(w.posts.at(-1)!.session.cache).toMatchObject({ lastRequestAt: null })
  })

  test('no ping while the session runs: its own requests keep the cache warm', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(2 * MIN)
    await $.turn.start({ text: 'again', turnId: 't2' })
    await w.clock.advance(10 * MIN)
    expect(w.fork.prompts).toHaveLength(0)
    expect(w.posts.at(-1)!.session.cache!.warming.state).toBe('ready')
  })

  test('the session ending stops warming', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(MIN)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: SID, resume: { id: SID } })
    await w.clock.advance(10 * MIN)
    expect(w.fork.prompts).toHaveLength(0)
  })

  test('/podium warm on and off change it for this session only', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    const onText = (await $.command.run(podium('warm on'))).text ?? ''
    expect(onText).toContain('Cache warming is on for this session')
    await w.clock.advance(4 * MIN + 1000)
    expect(w.fork.prompts).toHaveLength(1)
    expect((await $.command.run(podium(''))).text).toContain('Cache warming: on')
    const offText = (await $.command.run(podium('warm off'))).text ?? ''
    expect(offText).toContain('Cache warming is off for this session')
    await w.clock.advance(10 * MIN)
    expect(w.fork.prompts).toHaveLength(1)
    expect(w.posts.at(-1)!.session.cache!.warming).toMatchObject({ on: false, state: 'off', pings: 1 })
  })

  test('a resumed session tells the 1-hour lifetime by its gap, before or after the reporter starts', async ($, on) => {
    const w = world(on)
    // Claude Code may raise SessionStart before the mod's session.start has run
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 900, prompt_cache_likely_expired: false, context_tokens: 120_000 } as never)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.ttlMs).toBe(3_600_000)
    // and after it: 10 minutes away and the cache expired means 5 minutes
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600, prompt_cache_likely_expired: true } as never)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.ttlMs).toBe(300_000)
    // /podium says whether the lifetime is known or assumed
    expect((await $.command.run(podium(''))).text).toContain('Prompt cache lifetime: 5 minutes')
  })

  test('/podium says when the 5-minute lifetime is only assumed', async ($, on) => {
    world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    expect((await $.command.run(podium(''))).text).toContain('Prompt cache lifetime: 5 minutes, assumed')
  })

  test('a model switch makes the cache cold until the next request; the same model still warm keeps it', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    const t0 = w.clock.now()
    await mainTurn($)
    const sw = (to: string, warm: boolean) =>
      $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: to, requested_model: null, source: 'command', context_tokens: 120_000, prompt_cache_warm: warm, cache_ttl: '5m', estimated_cache_write_usd: 0.6, pricing: 'catalog' } as never)
    await sw('claude-opus-5-5', true)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.lastRequestAt! - t0).toBeLessThan(1000)
    await sw('claude-sonnet-5-5', true)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.lastRequestAt).toBeNull()
    // nothing to keep warm: no ping however long it waits
    await w.clock.advance(6 * MIN)
    expect(w.fork.prompts).toHaveLength(0)
    // the next request warms the new model's cache
    await mainTurn($, 't2')
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.lastRequestAt).not.toBeNull()
  })

  test('a ping that never answers stops warming after its timeout; a late answer is ignored; the next idle period pings again', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    w.fork.reply = 'hang'
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(4 * MIN + 2000)
    expect(w.fork.prompts).toHaveLength(1)
    await w.clock.advance(2 * MIN + 1000)
    const c = w.posts.at(-1)!.session.cache!
    expect(c.warming).toMatchObject({ state: 'stopped', stopReason: 'timeout', pings: 0 })
    expect(w.posts.flatMap((p) => p.events).some((e) => e.data?.kind === 'cache-stop' && e.data?.reason === 'timeout')).toBe(true)
    // the answer arrives after all: given up on, so it is not counted
    w.fork.release()
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache!.warming).toMatchObject({ state: 'stopped', pings: 0 })
    expect(w.posts.flatMap((p) => p.events).some((e) => e.data?.kind === 'cache-ping')).toBe(false)
    // warming is not dead: the next idle period pings again
    w.fork.reply = 'ok'
    await mainTurn($, 't2')
    await w.clock.advance(4 * MIN + 2000)
    expect(w.fork.prompts).toHaveLength(2)
    expect(w.posts.at(-1)!.session.cache!.warming).toMatchObject({ state: 'warming', pings: 1 })
  })

  test('a main-loop turn.step raised while a ping is in flight is the ping, not a request of the session', { options: { cacheWarming: true } }, async ($, on) => {
    const w = world(on)
    w.fork.reply = 'hang'
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await w.clock.advance(1000)
    await mainTurn($)
    await w.clock.advance(4 * MIN + 2000)
    expect(w.fork.prompts).toHaveLength(1)
    const before = w.posts.at(-1)!.session
    // the fork's own request, if the engine raises it (no agentId, the session waiting on the person)
    await stepOnce($, { turnId: 'fork', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
    await w.clock.advance(1000)
    const during = w.posts.at(-1)!.session
    expect(during.loop!.steps.done).toBe(before.loop!.steps.done)
    expect(during.tokens).toEqual(before.tokens)
    expect(during.costUsd).toBe(before.costUsd)
    expect(during.cache!.lastRequestAt).toBe(before.cache!.lastRequestAt)
    // the ping's own result is what counts
    const pingAt = w.posts.at(-1)!.session.cache!.warming.lastPingAt
    w.fork.release()
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.cache).toMatchObject({ lastRequestAt: pingAt, warming: { pings: 1 } })
    // a real prompt is counted as always
    await mainTurn($, 't2')
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.loop!.steps.done).toBe(before.loop!.steps.done + 1)
  })

  test('the PostModelSwitch hook passes the engine result through', async ($, on) => {
    world(on)
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    expect(await $.classic.PostModelSwitch({ from_model: 'a', to_model: 'b', requested_model: null, source: 'command', context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'default' } as never)).toEqual({})
  })
})
