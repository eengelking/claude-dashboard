import { describe, test, expect } from 'claude-code/testing'
import { agentReport, buildReport } from './report.ts'
import { scriptedReport, scriptedState, T0 } from './scripted.ts'
import { agentRequested, agentSpawned, blowout, compaction, markTextSent, newSession, reconcile, resetForNewId, sessionEnd, setAttached, setBackground, step, toolResult, turnComplete } from './state.ts'

// The key sets of docs/fixtures/report.sample.json, so a built Report has the shared fixture's shape.
const REPORT_KEYS = ['agents', 'events', 'reporter', 'sentAt', 'session', 'v']
const SESSION_KEYS = ['attached', 'blowouts', 'context', 'costUsd', 'cwd', 'effort', 'endReason', 'files', 'git', 'id', 'loop', 'model', 'name', 'plan', 'projectRoot', 'rateLimits', 'repoName', 'resumeId', 'startedAt', 'status', 'tokens', 'waitNote', 'waitReason']
const AGENT_KEYS = ['answerExcerpt', 'blowouts', 'context', 'costUsdEst', 'description', 'effort', 'effortSource', 'endedAt', 'failure', 'id', 'kind', 'lastTool', 'model', 'name', 'parentId', 'promptExcerpt', 'skills', 'startedAt', 'status', 'steps', 'tokens', 'toolCalls', 'toolCounts', 'type']
const FAILURE_KEYS = ['at', 'call', 'class', 'evidence', 'exitCode', 'explanation', 'outputTail', 'retriedAs', 'tool']
const STEP_KEYS = ['activeText', 'id', 'ownerAgentId', 'ownerLabel', 'state', 'text']
const keys = (o: object) => Object.keys(o).sort()

describe('scripted session -> Report', () => {
  const r = scriptedReport()

  test('has the shared fixture shape, with nothing omitted', () => {
    expect(keys(r)).toEqual(REPORT_KEYS)
    expect(keys(r.session)).toEqual(SESSION_KEYS)
    for (const a of r.agents) expect(keys(a)).toEqual(AGENT_KEYS)
    expect(keys(r.agents.find((a) => a.failure)!.failure!)).toEqual(FAILURE_KEYS)
    for (const st of r.session.plan!.steps) expect(keys(st)).toEqual(STEP_KEYS)
    expect(r.v).toBe(1)
    expect(r.reporter.name).toBe('podium-reporter')
  })

  test('session figures', () => {
    // the fork still runs, so the session is running although the main loop is idle
    expect(r.session).toMatchObject({ id: 'sess-1', name: 'x', status: 'running', waitReason: null, model: 'claude-opus-5-5', effort: 'high', costUsd: 3.21, blowouts: 2, repoName: 'acme/app' })
    expect(r.session.context).toEqual({ tokens: 100_000, window: 1_000_000, percent: 10 })
    expect(r.session.tokens).toEqual({ input: 1000, output: 100, cacheRead: 50_000, cacheWrite: 0 })
    expect(r.session.rateLimits).toEqual([{ kind: 'five_hour', percentUsed: 12.5, resetsAt: null }])
  })

  test('the main loop block carries its own steps, tools and skills, not the agents', () => {
    expect(r.session.loop).toEqual({
      skills: ['code-review'],
      lastTool: 'TaskUpdate',
      toolCalls: 3,
      toolCounts: { TaskCreate: 2, TaskUpdate: 1 },
      steps: { done: 1, total: null },
    })
  })

  test('plan with title, states and owners', () => {
    const p = r.session.plan!
    expect(p.title).toBe('Migrate')
    expect(p.steps.map((s) => [s.id, s.state])).toEqual([['1', 'active'], ['2', 'pending']])
    expect(p.steps[0]!.ownerAgentId).toBe('a1')
    expect(p.steps[0]!.ownerLabel).toBe('Explore · Haiku medium')
    expect(p.steps[1]!.ownerAgentId).toBe('a2')
  })

  test('agents: effort requested, then observed wins; a fork inherits', () => {
    const [a1, a2, a3] = ['a1', 'a2', 'a3'].map((id) => r.agents.find((a) => a.id === id)!)
    expect(a1).toMatchObject({ kind: 'subagent', type: 'Explore', status: 'done', effort: 'medium', effortSource: 'observed', model: 'claude-haiku-5-5', skills: ['repo-map'], answerExcerpt: 'Found 42 call sites.' })
    expect(a1!.promptExcerpt).toBe('Find every call site. token=[redacted]')
    expect(a2).toMatchObject({ kind: 'fork', type: 'fork', status: 'running', effort: 'high', effortSource: 'inherited', model: 'claude-opus-5-5' })
    expect(a3).toMatchObject({ status: 'failed', effortSource: 'unknown', blowouts: 1 })
  })

  test('failure record', () => {
    const f = r.agents.find((a) => a.id === 'a3')!.failure!
    // its last model stop was window-exceeded, which 6.4 ranks above a tool error
    expect(f).toMatchObject({ class: 'Context window exhausted', tool: 'Bash', call: 'npm run backfill', exitCode: 1, outputTail: ['Exit code 1', 'Error: ECONNREFUSED'], retriedAs: null, explanation: null })
    expect(f.evidence.some((l) => l.startsWith('exceeded the context window 1 time'))).toBe(true)
    expect(f.evidence).toContain('same call failed 2 times: npm run backfill')
  })

  test('events: start-less script still logs spawn, skill, done, fail, blow, compact, plan', () => {
    const kinds = new Set(r.events.map((e) => e.kind))
    for (const k of ['spawn', 'skill', 'done', 'fail', 'blow', 'compact', 'plan']) expect(kinds.has(k as never)).toBe(true)
    const blows = r.events.filter((e) => e.kind === 'blow')
    expect(blows).toHaveLength(3)
    expect(blows[0]!.data).toMatchObject({ kind: 'window-exceeded' })
    expect(blows.every((e) => e.id.startsWith('sess-1:'))).toBe(true)
    expect(new Set(r.events.map((e) => e.id)).size).toBe(r.events.length)
  })
})

describe('blowout counting', () => {
  const base = () => newSession({ id: 's', cwd: '/x', startedAt: T0, model: 'opus' })
  test('auto compaction counts, manual does not', () => {
    let s = compaction(base(), { trigger: 'auto', tokensBefore: 1, tokensAfter: 0 }, T0)
    s = compaction(s, { trigger: 'manual' }, T0 + 10_000)
    s = compaction(s, { trigger: 'plugin' }, T0 + 20_000)
    expect(s.main.blowouts).toBe(1)
    expect(s.events.filter((e) => e.kind === 'compact')).toHaveLength(2)
  })
  test('model_context_window_exceeded counts', () => {
    const s = step(base(), { usage: null, stopReason: 'model_context_window_exceeded' }, T0)
    expect(s.main.blowouts).toBe(1)
  })
  test('duplicate signals within 2 s for one loop count once; another loop counts on its own', () => {
    let s = agentSpawned(base(), { toolUseId: 't', agentId: 'a', model: 'haiku', subagentType: 'x', description: 'd', prompt: 'p', fork: false }, T0)
    s = step(s, { agentId: 'a', usage: null, stopReason: 'model_context_window_exceeded' }, T0 + 1000)
    s = compaction(s, { agentId: 'a', trigger: 'auto' }, T0 + 2500)
    s = blowout(s, null, 'auto-compact', T0 + 2600, null, null)
    expect(s.agents.a!.blowouts).toBe(1)
    expect(s.main.blowouts).toBe(1)
    s = compaction(s, { agentId: 'a', trigger: 'auto' }, T0 + 3100)
    expect(s.agents.a!.blowouts).toBe(2)
  })
})

describe('reducers', () => {
  const base = () => newSession({ id: 's', cwd: '/x', startedAt: T0, model: 'claude-opus-5-5' })

  test('spawn before the Agent tool call still gets the requested effort', () => {
    let s = agentSpawned(base(), { toolUseId: 't9', agentId: 'z', model: 'claude-sonnet-5-5', subagentType: 'general-purpose', description: 'd', prompt: 'p', fork: false }, T0)
    expect(s.agents.z!.effortSource).toBe('unknown')
    s = agentRequested(s, 't9', { description: 'd', prompt: 'p', effort: 'xhigh' }, T0 + 1)
    expect(s.agents.z).toMatchObject({ effort: 'xhigh', effortSource: 'requested' })
  })

  test('an agent nested under another keeps its parent', () => {
    let s = agentSpawned(base(), { toolUseId: 't1', agentId: 'p', model: 'opus', subagentType: 'x', description: 'parent', prompt: 'p', fork: false }, T0)
    s = agentSpawned(s, { toolUseId: 't2', agentId: 'c', model: 'opus', subagentType: 'x', description: 'child', prompt: 'p', fork: true, parentAgentId: 'p' }, T0)
    expect(s.agents.c!.parentId).toBe('p')
  })

  // The order and fields a real run on Claude Code 2.1.296 produced (#101, docs/GOTCHAS.md): agent.spawn
  // carries the launching loop's id as parentAgentId at every depth, and $.agent.list() marks a parent
  // that waits on its child "waiting", then drops finished nested agents once their parent is done.
  test('a real nested run: subagent under subagent, fork under subagent, subagent under fork (#101)', () => {
    const spawn = (id: string, parentAgentId: string | undefined, fork: boolean, model: string) =>
      ({ toolUseId: `t-${id}`, agentId: id, model, subagentType: fork ? 'fork' : 'general-purpose', description: id, prompt: 'p', fork, parentAgentId })
    let s = step(base(), { model: 'claude-opus-5-5', effort: 'high', usage: null, stopReason: null }, T0)
    s = agentRequested(s, 't-p', { description: 'p', prompt: 'p', subagent_type: 'general-purpose', model: 'haiku', effort: 'low' }, T0)
    s = agentSpawned(s, spawn('p', undefined, false, 'claude-haiku-4-5'), T0)
    s = agentSpawned(s, spawn('f', undefined, true, 'claude-opus-5-5'), T0)
    s = step(s, { agentId: 'p', model: 'claude-haiku-4-5', effort: 'low', usage: null, stopReason: null }, T0 + 1)
    s = agentSpawned(s, spawn('c', 'p', false, 'claude-sonnet-5-5'), T0 + 2)
    s = agentSpawned(s, spawn('pf', 'p', true, 'claude-haiku-4-5'), T0 + 2)
    s = agentSpawned(s, spawn('g', 'c', false, 'claude-sonnet-5-5'), T0 + 3)
    s = agentSpawned(s, spawn('fc', 'f', false, 'claude-sonnet-5-5'), T0 + 3)
    expect(Object.fromEntries(s.order.map((id) => [id, s.agents[id]!.parentId]))).toEqual({ p: null, f: null, c: 'p', pf: 'p', g: 'c', fc: 'f' })
    // A fork inherits from the loop that launched it: the subagent's model and effort, not the orchestrator's.
    expect(s.agents.pf).toMatchObject({ kind: 'fork', model: 'claude-haiku-4-5', effort: 'low', effortSource: 'inherited' })
    expect(s.agents.f).toMatchObject({ kind: 'fork', model: 'claude-opus-5-5', effort: 'high', effortSource: 'inherited' })
    expect(s.events.filter((e) => e.kind === 'spawn').map((e) => e.agentId)).toEqual(['p', 'f', 'c', 'pf', 'g', 'fc'])

    // The list says "waiting" for a parent that waits on its child: it is still running here.
    const listed = (id: string, status: string, parentId?: string) => ({ id, description: id, type: 'general-purpose', status, parentId })
    s = reconcile(s, [listed('p', 'waiting'), listed('f', 'waiting'), listed('c', 'waiting', 'p'), listed('pf', 'running', 'p'), listed('g', 'running', 'c'), listed('fc', 'running', 'f')], T0 + 4)
    expect(s.agents.p!.status).toBe('running')
    expect(s.agents.c!.status).toBe('running')

    for (const id of ['g', 'pf', 'c', 'fc', 'p', 'f']) s = turnComplete(s, { agentId: id, reason: 'answer', answer: 'done' }, T0 + 5)
    // Finished nested agents are gone from the list; the report keeps them, under their parents.
    s = reconcile(s, [listed('p', 'completed'), listed('f', 'completed')], T0 + 6)
    const report = s.order.map((id) => agentReport(s.agents[id]!))
    expect(report.map((a) => [a.id, a.parentId, a.status])).toEqual([
      ['p', null, 'done'], ['f', null, 'done'], ['c', 'p', 'done'], ['pf', 'p', 'done'], ['g', 'c', 'done'], ['fc', 'f', 'done'],
    ])
  })

  test('a plan step can be owned by a nested agent, the same as by a top-level one', () => {
    let s = toolResult(base(), { tool: 'TaskCreate', input: { subject: 'Read the Stripe adapter', description: 'd' }, result: { result: { task: { id: '1', subject: 'Read the Stripe adapter' } } } }, T0)
    s = agentSpawned(s, { toolUseId: 't1', agentId: 'p', model: 'claude-sonnet-5-5', subagentType: 'general-purpose', description: 'Plan the rewrite', prompt: 'p', fork: false }, T0)
    s = agentSpawned(s, { toolUseId: 't2', agentId: 'g', model: 'claude-haiku-4-5', subagentType: 'Explore', description: 'Read the Stripe adapter', prompt: 'p', fork: false, parentAgentId: 'p' }, T0 + 1)
    expect(s.plan.tasks[0]).toMatchObject({ ownerAgentId: 'g', ownerLabel: 'Explore · Haiku' })
  })

  test('an agent the engine lists before its spawn hook keeps the parent the list gives', () => {
    const s = reconcile(base(), [{ id: 'g', description: 'grandchild', type: 'general-purpose', status: 'running', parentId: 'c' }], T0)
    expect(s.agents.g!.parentId).toBe('c')
  })

  test('a candidate is discarded when the loop answers', () => {
    let s = agentSpawned(base(), { toolUseId: 't', agentId: 'a', model: 'opus', subagentType: 'x', description: 'd', prompt: 'p', fork: false }, T0)
    s = toolResult(s, { agentId: 'a', tool: 'Bash', input: { command: 'false' }, result: { isError: true, text: 'Exit code 1' } }, T0 + 1)
    s = turnComplete(s, { agentId: 'a', reason: 'answer', answer: 'fine' }, T0 + 2)
    expect(s.agents.a).toMatchObject({ status: 'done', failure: null, candidate: null })
  })

  test('aborted and refused agents', () => {
    let s = agentSpawned(base(), { toolUseId: 't', agentId: 'a', model: 'opus', subagentType: 'x', description: 'd', prompt: 'p', fork: false }, T0)
    s = agentSpawned(s, { toolUseId: 'u', agentId: 'b', model: 'opus', subagentType: 'x', description: 'e', prompt: 'p', fork: false }, T0)
    s = turnComplete(s, { agentId: 'a', reason: 'aborted' }, T0 + 1)
    s = turnComplete(s, { agentId: 'b', reason: 'refusal' }, T0 + 1)
    expect(s.agents.a).toMatchObject({ status: 'aborted' })
    expect(s.agents.a!.failure!.class).toBe('Aborted')
    expect(s.agents.b!.failure!.class).toBe('Refusal')
  })

  test('agent.list reconciles: unknown agents appear, finished ones never run again', () => {
    let s = reconcile(base(), [{ id: 'x', description: 'from list', type: 'Explore', status: 'running' }, { id: 'y', description: 'done one', type: 'fork', status: 'completed' }], T0)
    expect(s.agents.x).toMatchObject({ description: 'from list', type: 'Explore', status: 'running' })
    expect(s.agents.y).toMatchObject({ kind: 'fork', status: 'done' })
    s = reconcile(s, [{ id: 'y', description: 'done one', type: 'fork', status: 'running' }, { id: 'x', description: 'from list', type: 'Explore', status: 'killed' }], T0 + 1)
    expect(s.agents.y!.status).toBe('done')
    expect(s.agents.x!.status).toBe('aborted')
  })

  test('session end aborts open agents; a new id starts clean but keeps where it runs', () => {
    let s = agentSpawned(base(), { toolUseId: 't', agentId: 'a', model: 'opus', subagentType: 'x', description: 'd', prompt: 'p', fork: false }, T0)
    s = { ...s, git: { branch: 'main', detached: false, isWorktree: false, worktreePath: null, ahead: 0, behind: 0, dirty: 0 } }
    s = sessionEnd(s, 'clear', 's', T0 + 1)
    expect(s).toMatchObject({ status: 'done', endReason: 'clear', resumeId: 's' })
    expect(s.agents.a!.status).toBe('aborted')
    const n = resetForNewId(s, 's2', T0 + 2)
    expect(n).toMatchObject({ id: 's2', ended: false, agents: {}, evSeq: 0 })
    expect(n.git?.branch).toBe('main')
    expect(n.plan.tasks).toEqual([])
  })

  test('the reducers never mutate their input', () => {
    const s = scriptedState()
    const frozen = JSON.stringify(s)
    step(s, { usage: null, stopReason: 'model_context_window_exceeded' }, T0 + 99_000)
    toolResult(s, { tool: 'TaskUpdate', input: { taskId: '2', status: 'completed' }, result: {} }, T0)
    sessionEnd(s, 'other', null, T0)
    expect(JSON.stringify(s)).toBe(frozen)
  })
})

describe('per-tool counts', () => {
  const base = () => newSession({ id: 's', cwd: '/x', startedAt: T0, model: 'claude-opus-5-5' })
  const spawn = () => agentSpawned(base(), { toolUseId: 't', agentId: 'a', model: 'opus', subagentType: 'x', description: 'd', prompt: 'p', fork: false }, T0)
  const call = (s: ReturnType<typeof base>, tool: string, agentId?: string) => toolResult(s, { agentId, tool, input: {}, result: {} }, T0 + 1)

  test('each finished call is counted under its tool, and the counts add up to the total', () => {
    let s = spawn()
    for (const t of ['Bash', 'Read', 'Bash', 'Grep', 'Bash']) s = call(s, t, 'a')
    expect(s.agents.a!.toolCounts).toEqual({ Bash: 3, Read: 1, Grep: 1 })
    expect(Object.values(s.agents.a!.toolCounts).reduce((n, c) => n + c, 0)).toBe(s.agents.a!.toolCalls)
  })

  test('the main loop is counted too, apart from the agents', () => {
    let s = spawn()
    s = call(s, 'Edit')
    s = call(s, 'Bash', 'a')
    expect(s.main.toolCounts).toEqual({ Edit: 1 })
    expect(s.agents.a!.toolCounts).toEqual({ Bash: 1 })
  })

  test('a long tool name is clipped to 120 characters', () => {
    const s = call(spawn(), 'm'.repeat(300), 'a')
    expect(Object.keys(s.agents.a!.toolCounts)).toEqual(['m'.repeat(120)])
  })

  test('past 100 distinct tools, new names are left out but known ones and the total still count', () => {
    let s = spawn()
    for (let i = 0; i < 100; i++) s = call(s, `tool-${i}`, 'a')
    s = call(s, 'one-too-many', 'a')
    s = call(s, 'tool-0', 'a')
    const counts = s.agents.a!.toolCounts
    expect(Object.keys(counts)).toHaveLength(100)
    expect(counts['one-too-many']).toBeUndefined()
    expect(counts['tool-0']).toBe(2)
    expect(s.agents.a!.toolCalls).toBe(102)
  })

  test('a tool named like an Object property is counted as its own name', () => {
    const s = call(call(spawn(), 'constructor', 'a'), 'constructor', 'a')
    expect(s.agents.a!.toolCounts).toEqual({ constructor: 2 })
  })

  test('the report carries the counts', () => {
    const s = call(call(spawn(), 'Bash', 'a'), 'Bash', 'a')
    expect(agentReport(s.agents.a!).toolCounts).toEqual({ Bash: 2 })
  })
})

describe('attached', () => {
  const base = () => newSession({ id: 's', cwd: '/x', startedAt: T0, model: 'claude-opus-5-5' })

  test('is unknown until the roster has been read', () => {
    expect(base().attached).toBeNull()
  })

  test('a change marks the session dirty; the same value does not', () => {
    const detached = setAttached({ ...base(), dirty: false }, false)
    expect(detached.attached).toBe(false)
    expect(detached.dirty).toBe(true)
    const again = setAttached({ ...detached, dirty: false }, false)
    expect(again.dirty).toBe(false)
    expect(setAttached({ ...again, dirty: false }, true).dirty).toBe(true)
  })

  test('does not mutate its input', () => {
    const s = base()
    const frozen = JSON.stringify(s)
    setAttached(s, false)
    expect(JSON.stringify(s)).toBe(frozen)
  })
})

describe('full prompt and answer text (opt-in)', () => {
  const spawned = (prompt: string) =>
    agentSpawned(newSession({ id: 's', cwd: '/w', startedAt: T0 }), { toolUseId: 't', agentId: 'a1', model: 'claude-haiku-5-5', subagentType: 'Explore', description: 'd', prompt, fork: false }, T0 + 1)

  test('kept redacted with its line breaks, apart from the 400-char excerpt', () => {
    const s = spawned('# Task\n\n- find calls\n- token=SECRET123')
    const a = s.agents.a1!
    expect(a.promptText).toBe('# Task\n\n- find calls\n- token=[redacted]')
    expect(a.promptExcerpt).toBe('# Task - find calls - token=[redacted]')
  })

  test('a text over the cap is cut with a visible marker', () => {
    const a = spawned('x'.repeat(25_000)).agents.a1!
    expect(a.promptText!.startsWith('x'.repeat(20_000))).toBe(true)
    expect(a.promptText!).toContain('cut off')
    expect(a.promptText!.length).toBeLessThan(20_100)
  })

  test('the report omits the text unless the option is on', () => {
    const a = spawned('Find calls.').agents.a1!
    expect('promptText' in agentReport(a)).toBe(false)
    expect(agentReport(a, true).promptText).toBe('Find calls.')
  })

  test('answer text arrives with the answer and goes out once', () => {
    let s = spawned('Find calls.')
    s = turnComplete(s, { agentId: 'a1', reason: 'answer', answer: '## Done\n\n42 sites' }, T0 + 5)
    expect(agentReport(s.agents.a1!, true)).toMatchObject({ promptText: 'Find calls.', answerText: '## Done\n\n42 sites' })
    s = markTextSent(s)
    const sent = agentReport(s.agents.a1!, true)
    expect('promptText' in sent).toBe(false)
    expect('answerText' in sent).toBe(false)
    expect(sent.promptExcerpt).toBe('Find calls.')
  })

  test('one report carries at most 120,000 characters of full text; the rest waits for the next', () => {
    let s = newSession({ id: 's', cwd: '/w', startedAt: T0 })
    for (let i = 0; i < 10; i++) s = agentSpawned(s, { toolUseId: `t${i}`, agentId: `a${i}`, model: 'claude-haiku-5-5', subagentType: 'Explore', description: 'd', prompt: 'x'.repeat(19_000), fork: false }, T0 + i)
    const carried = (st: typeof s) => Object.values(st.agents).map((a) => agentReport(a, true)).filter((r) => r.promptText)
    const meta = { version: '0.10.0', engineVersion: null, hostSurface: null, now: T0, storedName: null, optionName: null, fullText: true }
    const first = buildReport(s, [], meta).agents.filter((a) => a.promptText)
    expect(carried(s)).toHaveLength(10)
    expect(first.length).toBeLessThan(10)
    expect(first.reduce((n, a) => n + a.promptText!.length, 0)).toBeLessThanOrEqual(120_000)
    s = markTextSent(s, Object.fromEntries(first.map((a) => [a.id, { promptText: a.promptText }])))
    const second = buildReport(s, [], meta).agents.filter((a) => a.promptText)
    expect(first.length + second.length).toBe(10)
    expect(second.map((a) => a.id).some((id) => first.some((f) => f.id === id))).toBe(false)
  })

  test('a later answer for the same agent is sent again', () => {
    let s = spawned('p')
    s = turnComplete(s, { agentId: 'a1', reason: 'answer', answer: 'one' }, T0 + 5)
    s = markTextSent(s)
    s = turnComplete(s, { agentId: 'a1', reason: 'answer', answer: 'two' }, T0 + 6)
    expect(agentReport(s.agents.a1!, true).answerText).toBe('two')
  })
})

// A session idle on a background process is not waiting on the person (#119). The Stop hook input lists the
// background tasks and scheduled wake-ups still in flight; the report says what the session waits on.
describe('background work (#119)', () => {
  const meta = { version: '0.0.0', engineVersion: null, hostSurface: null, now: T0 + 10, storedName: null, optionName: null }
  const idle = () => turnComplete(newSession({ id: 's', cwd: '/x', startedAt: T0, model: 'claude-opus-5-5' }), { reason: 'answer' }, T0 + 1)
  const shell = { id: 'b1', type: 'shell', status: 'running', description: 'nightly build', command: 'npm run build && curl -H "Authorization: Bearer sk-live-123" https://example.com/upload' }

  test('a turn that ends with a shell running does not say waiting for input', () => {
    expect(idle()).toMatchObject({ status: 'waiting', waitReason: 'input' })
    const s = setBackground(idle(), { tasks: [shell], crons: [] }, T0 + 2)
    expect(s.status).toBe('waiting')
    expect(s.waitReason).toBeNull()
    const r = buildReport(s, [], meta)
    expect(r.session.status).toBe('waiting')
    expect(r.session.waitReason).toBeNull()
    expect(r.session.background).toEqual({ tasks: [{ type: 'shell', description: 'nightly build', status: 'running' }], wakeAt: null })
  })

  test('a shell command is never sent whole', () => {
    const r = buildReport(setBackground(idle(), { tasks: [{ ...shell, description: '' }], crons: [] }, T0 + 2), [], meta)
    const text = JSON.stringify(r.session.background)
    expect(text).not.toContain('sk-live-123')
    expect(text).not.toContain('Authorization')
    // with no description, the task is named by its type only
    expect(r.session.background!.tasks[0]!.description.length).toBeLessThanOrEqual(120)
  })

  test('background agents, monitors and workflows are counted by their type', () => {
    const tasks = [shell, { id: 'b2', type: 'subagent', status: 'running', description: 'Survey adapters' }, { id: 'b3', type: 'monitor', status: 'running', description: 'tail the log' }, { id: 'b4', type: 'workflow', status: 'running', description: 'release' }]
    const r = buildReport(setBackground(idle(), { tasks, crons: [] }, T0 + 2), [], meta)
    expect(r.session.background!.tasks.map((t) => t.type)).toEqual(['shell', 'agent', 'monitor', 'workflow'])
  })

  test('a scheduled wake-up alone is a background wait that says when it wakes', () => {
    const s = setBackground(idle(), { tasks: [], crons: [{ id: 'c1', schedule: '30 14 * * *', recurring: false, prompt: 'check the deploy', nextAt: T0 + 3_600_000 }] }, T0 + 2)
    expect(s.waitReason).toBeNull()
    const r = buildReport(s, [], meta)
    expect(r.session.background).toMatchObject({ tasks: [{ type: 'wakeup', description: 'check the deploy' }], wakeAt: T0 + 3_600_000 })
  })

  test('when the work finishes the session goes back to waiting for input at once', () => {
    let s = setBackground(idle(), { tasks: [shell], crons: [] }, T0 + 2)
    s = setBackground(s, { tasks: [], crons: [] }, T0 + 3)
    expect(s).toMatchObject({ status: 'waiting', waitReason: 'input' })
    const r = buildReport(s, [], meta)
    expect(r.session.background).toBeUndefined()
    expect(keys(r.session)).toEqual(SESSION_KEYS)
  })

  test('a finished task in the list is not work in flight', () => {
    const s = setBackground(idle(), { tasks: [{ ...shell, status: 'completed' }], crons: [] }, T0 + 2)
    expect(s).toMatchObject({ status: 'waiting', waitReason: 'input' })
  })

  test('a permission wait stays a permission wait while a shell runs', () => {
    let s = setBackground(idle(), { tasks: [shell], crons: [] }, T0 + 2)
    s = { ...s, waitReason: 'permission' as const, waitNote: 'Bash(rm x)' }
    s = setBackground(s, { tasks: [shell], crons: [] }, T0 + 3)
    expect(s.waitReason).toBe('permission')
    expect(buildReport(s, [], meta).session.waitReason).toBe('permission')
  })
})
