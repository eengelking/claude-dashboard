import { describe, test, expect, mock, type Engine } from 'claude-code/testing'
import type { AgentSpawnInput, CommandRunInput, On, TurnStepChunk } from 'claude-code'
import { MAIN_LOOP, type Report } from './protocol.ts'

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
  /** The loops the server's reply says someone is watching (#118). */
  watch: { value: string[] }
  /** What each model request streams before it ends. */
  chunks: { value: TurnStepChunk[] }
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
  const watch: World['watch'] = { value: [] }
  const chunks: World['chunks'] = { value: [] }
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
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, ackedEvents: body.events.length, liveSessions: 3, watch: watch.value }) } }
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
    for (const c of chunks.value) yield c
    return {
      turnId: e.turnId,
      index: e.index,
      answer: chunks.value.map((c) => (c.kind === 'text' ? c.text : '')).join(''),
      toolUses: [],
      stopReason: big ? 'model_context_window_exceeded' : 'end_turn',
      usage: { input_tokens: big ? 990_000 : 2000, output_tokens: 300, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 1000, model: e.model },
    }
  })
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  return { posts, headers, clock, lastToolUseId: () => toolUseId, sessionId, fetchMode, surfaces, ran, watch, chunks }
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

  describe('activity feed (#118)', () => {
    /** Starts a session with one subagent (a-sub) and posts once, so the reply's watch list reaches the mod. */
    async function started($: Engine, on: On, watch: string[]) {
      const w = world(on)
      w.watch.value = watch
      await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
      await $.agent.spawn(spawnInput({ tool_use_id: 'f1' }))
      await w.clock.advance(1000)
      return w
    }
    /** A tool call made inside an agent's loop: the engine sets agentId, which the typed input does not list. */
    const inAgent = <const T extends object>(input: T, agentId = 'a-sub'): T => ({ ...input, agentId })
    const SECRET = 'sk-ant-api03-abcdefghijklmnop'
    const text = (t: string): TurnStepChunk => ({ kind: 'text', index: 0, text: t })
    /** Work in the subagent and in the orchestrator: a tool call each and a step that writes text. */
    async function work($: Engine, w: World) {
      await $.tool.call(inAgent({ tool: 'Bash', command: `curl -H "x-api-key: ${SECRET}" http://localhost` }))
      w.chunks.value = [text('Two failures. '), { kind: 'thinking', index: 1, text: 'private thoughts' }, text(`The key ${SECRET} works.`)]
      await stepOnce($, { turnId: 'ta', index: 0, model: 'claude-sonnet-5-5', messageCount: 2, agentId: 'a-sub' })
      w.chunks.value = []
      await $.tool.call({ tool: 'Read', file_path: 'docs/SPEC.md' })
      await w.clock.advance(1000)
    }
    const sent = (w: World) => JSON.stringify(w.posts)

    test('off (default): nothing is captured or sent, even for a loop the server says is watched', async ($, on) => {
      const w = await started($, on, ['a-sub', MAIN_LOOP])
      await work($, w)
      await w.clock.advance(5000)
      expect(w.posts.every((p) => p.session.activityFeed === false)).toBe(true)
      expect(w.posts.some((p) => 'activity' in p.session || p.agents.some((a) => 'activity' in a))).toBe(false)
      expect(sent(w)).not.toContain('Two failures')
    })

    test('on but nobody watching: nothing is sent', { options: { activityFeed: true } }, async ($, on) => {
      const w = await started($, on, [])
      await work($, w)
      expect(w.posts.at(-1)!.session.activityFeed).toBe(true)
      expect(w.posts.some((p) => 'activity' in p.session || p.agents.some((a) => 'activity' in a))).toBe(false)
      expect(sent(w)).not.toContain('Two failures')
    })

    test('on and watched: the tool calls and text are sent, redacted, and thinking is not', { options: { activityFeed: true } }, async ($, on) => {
      const w = await started($, on, ['a-sub', MAIN_LOOP])
      await work($, w)
      const r = w.posts.at(-1)!
      const sub = r.agents.find((a) => a.id === 'a-sub')!
      expect(sub.activity!.map((e) => e.kind)).toEqual(['tool', 'text'])
      expect(sub.activity![0]!.text).toMatch(/^Bash curl -H "x-api-key: \[redacted\]/)
      expect(sub.activity![1]!.text).toBe('Two failures. The key [redacted] works.')
      expect(r.session.activity!.map((e) => e.text)).toEqual(['Read docs/SPEC.md'])
      expect(sent(w)).not.toContain(SECRET)
      expect(sent(w)).not.toContain('private thoughts')
    })

    test('only the watched loop is sent, and a loop that stops being watched is dropped', { options: { activityFeed: true } }, async ($, on) => {
      const w = await started($, on, ['a-sub'])
      await work($, w)
      expect('activity' in w.posts.at(-1)!.session).toBe(false)
      expect(w.posts.at(-1)!.agents[0]!.activity).toHaveLength(2)
      w.watch.value = []
      await w.clock.advance(5000) // the heartbeat's reply takes it off the list
      await $.tool.call(inAgent({ tool: 'Read', file_path: '/x' }))
      await w.clock.advance(1000)
      expect('activity' in w.posts.at(-1)!.agents[0]!).toBe(false)
    })

    test('a loop keeps only its last 20 entries', { options: { activityFeed: true } }, async ($, on) => {
      const w = await started($, on, ['a-sub'])
      for (let i = 0; i < 25; i++) await $.tool.call(inAgent({ tool: 'Read', file_path: `/f${i}` }))
      await w.clock.advance(1000)
      const got = w.posts.at(-1)!.agents[0]!.activity!
      expect(got).toHaveLength(20)
      expect(got[0]!.text).toBe('Read /f5')
    })

    test('a watched step passes every chunk on unchanged, in order, and its result', { options: { activityFeed: true } }, async ($, on) => {
      const w = await started($, on, ['a-sub'])
      const chunks: TurnStepChunk[] = [text('a'), { kind: 'thinking', index: 1, text: 't' }, { kind: 'tool', index: 2, id: 'tu1', name: 'Read' }, { kind: 'input', index: 2, json: '{"file_path":"/x"}' }, text('b')]
      w.chunks.value = chunks
      const seen: TurnStepChunk[] = []
      const s = $.turn.step({ turnId: 'ta', index: 0, model: 'claude-sonnet-5-5', messageCount: 2, agentId: 'a-sub' })
      let r = await s.next()
      while (!r.done) {
        seen.push(r.value)
        r = await s.next()
      }
      expect(seen).toEqual(chunks)
      expect(r.value).toMatchObject({ answer: 'ab', stopReason: 'end_turn' })
    })
  })
})
