import { describe, test, expect } from 'claude-code/testing'
import { scriptedReport, scriptedState, T0 } from './scripted.ts'
import { agentRequested, agentSpawned, blowout, compaction, newSession, reconcile, resetForNewId, sessionEnd, step, toolResult, turnComplete } from './state.ts'

// The key sets of docs/fixtures/report.sample.json, so a built Report has the shared fixture's shape.
const REPORT_KEYS = ['agents', 'events', 'reporter', 'sentAt', 'session', 'v']
const SESSION_KEYS = ['blowouts', 'context', 'costUsd', 'cwd', 'effort', 'endReason', 'git', 'id', 'model', 'name', 'plan', 'projectRoot', 'rateLimits', 'repoName', 'resumeId', 'startedAt', 'status', 'tokens', 'waitNote', 'waitReason']
const AGENT_KEYS = ['answerExcerpt', 'blowouts', 'context', 'costUsdEst', 'description', 'effort', 'effortSource', 'endedAt', 'failure', 'id', 'kind', 'lastTool', 'model', 'name', 'parentId', 'promptExcerpt', 'skills', 'startedAt', 'status', 'steps', 'tokens', 'toolCalls', 'type']
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
