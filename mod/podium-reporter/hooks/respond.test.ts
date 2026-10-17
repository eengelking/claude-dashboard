import { describe, test, expect, mock, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Ask, Delivery, Report } from './protocol.ts'
import { answersMap, planApproval, respondInfo, respondLevel, toolDecision, toolDenied, toolInput, planRejection, cut, terminalAnswers } from './respond.ts'

// Responding to a waiting session from Podium (#206, SPEC 5.3). The world beneath the plugin is a fake Podium server
// and a terminal whose dialogs the test answers by hand.

const SID = 'sess-respond-1'
const CWD = '/Users/dev/app'
const NOW = 1_800_000_000_000
const ON = { respond: 'everything', activityFeed: true }

interface Call {
  method: string
  path: string
  body: unknown
}

interface World {
  calls: Call[]
  posts: Report[]
  logs: string[]
  submitted: string[]
  commands: string[]
  clock: ReturnType<typeof mock.clock>
  server: { respond: boolean; deliveries: Delivery[] }
  /** Answers every held request now waiting, and the next one if none is. */
  deliver: (d: Delivery) => void
  /** How many answer requests the fake server is holding open now. */
  holding: () => number
  /** The server drops its asks (the Admin turned responding off): every held request, and each later one, is a 410. */
  dropAsks: () => void
  /** The terminal's dialog for the next AskUserQuestion or ExitPlanMode call: resolve it to answer there. */
  dialog: { resolve: ((r: unknown) => void) | null }
  /** What a tool's own call resolves to once it runs (or is refused). */
  toolRun: { resolve: ((r: unknown) => void) | null }
  sessionId: { value: string }
  /** Runs as the terminal's dialog opens, inside the call, the way Claude Code fires its PermissionRequest then. */
  onDialog: { run: (() => void) | null }
  checkDecision: { value: 'allow' | 'ask' | 'deny' }
  /** What the fake server answers to a delivery's result (#329); 200 unless a test changes it. */
  resultStatus: { value: number }
}

function world(on: On): World {
  const calls: Call[] = []
  const posts: Report[] = []
  const logs: string[] = []
  const submitted: string[] = []
  const commands: string[] = []
  const server = { respond: true, deliveries: [] as Delivery[] }
  const holds: ((d: Delivery | null) => void)[] = []
  let waiting: Delivery | null = null
  let dropped = false
  const dialog: World['dialog'] = { resolve: null }
  const toolRun: World['toolRun'] = { resolve: null }
  const sessionId = { value: SID }
  const checkDecision: World['checkDecision'] = { value: 'ask' }
  const onDialog: World['onDialog'] = { run: null }
  const resultStatus: World['resultStatus'] = { value: 200 }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, {})
  const ok = (body: unknown, status = 200) => ({ value: { status, ok: status < 300, headers: {}, text: body === undefined ? '' : JSON.stringify(body) } })
  on('session.id', () => ({ value: sessionId.value }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: CWD }))
  on('session.repo', () => ({ value: null }))
  on('session.version', () => ({ value: { version: '2.1.301' } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 1000, window: 1_000_000, percent: 0.1 }, rateLimits: [], cost: { usd: 0.1 } } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'podium' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__podium-reporter__plan' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    if (e.to !== 'debug') logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', (_$, e) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    calls.push({ method, path: url.pathname + url.search, body })
    if (url.pathname === '/api/fleet/report') {
      posts.push(body as Report)
      const deliveries = server.deliveries.splice(0)
      return ok({ ok: true, ackedEvents: (body as Report).events.length, liveSessions: 1, watch: [], respond: server.respond, deliveries })
    }
    if (method === 'GET' && url.pathname.endsWith('/answer')) {
      const gone = () => ok({ ok: false, error: 'closed', outcome: 'ended' }, 410)
      if (dropped) return gone()
      if (waiting) {
        const d = waiting
        waiting = null
        return ok({ delivery: d })
      }
      return new Promise((resolve) => holds.push((d) => resolve(d ? ok({ delivery: d }) : gone())))
    }
    if (url.pathname.includes('/deliveries/') && resultStatus.value !== 200) return ok({ ok: false, error: 'unknown delivery' }, resultStatus.value)
    return ok({ ok: true })
  })
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('command.run', (_$, e) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('tool.check', () => ({ decision: checkDecision.value }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') {
      onDialog.run?.()
      return new Promise((resolve) => (dialog.resolve = resolve as (r: unknown) => void))
    }
    if (e.tool === 'Bash') return new Promise((resolve) => (toolRun.resolve = resolve as (r: unknown) => void))
    return { result: { ok: true }, text: 'ok' }
  })
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  return {
    calls,
    posts,
    logs,
    submitted,
    commands,
    clock,
    server,
    dialog,
    toolRun,
    sessionId,
    checkDecision,
    onDialog,
    resultStatus,
    deliver: (d) => {
      const all = holds.splice(0)
      if (!all.length) waiting = d
      for (const h of all) h(d)
    },
    holding: () => holds.length,
    dropAsks: () => {
      dropped = true
      for (const h of holds.splice(0)) h(null)
    },
  }
}

/** Lets the hooks' chains run to their next wait. */
async function settle(w: World, rounds = 30) {
  for (let i = 0; i < rounds; i++) await w.clock.advance(0)
}

/** A call the test leaves open on purpose. Once the test's engine is gone its dialog rejects, with nobody awaiting it. */
function leaveOpen(call: Promise<unknown>): void {
  call.catch(() => undefined)
}

async function started($: Engine, w: World) {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await w.clock.advance(1000) // the first report, whose reply says the server takes answers
}

const QUESTIONS = [
  { question: 'How many rows per page?', header: 'Page size', multiSelect: false, options: [{ label: '25/50/100', description: 'Choices' }, { label: 'Fixed 50', description: 'No choice' }] },
  { question: 'What should Back restore?', header: 'Back state', multiSelect: true, options: [{ label: 'The page', description: '' }, { label: 'The rows', description: '' }, { label: 'The scroll', description: '' }] },
]

const by = (kind: Delivery['kind'], askId: string | null, over: Partial<Delivery> = {}): Delivery => ({ id: `dlv_${kind}_${askId ?? 'msg'}`, askId, by: 'Ed', at: NOW, kind, ...over })

const results = (w: World) => w.calls.filter((c) => c.path.includes('/deliveries/')).map((c) => [c.path.split('/deliveries/')[1]!.split('/')[0], (c.body as { result: string }).result])
const closes = (w: World) => w.calls.filter((c) => c.path.endsWith('/close')).map((c) => c.body as { outcome: string; answer?: string; planApproved?: boolean })
const puts = (w: World) => w.calls.filter((c) => c.method === 'PUT').map((c) => c.body as Ask)

describe('respond: the pure parts', () => {
  test('reads the option, and works out what the session takes', async () => {
    expect(respondLevel('questions-and-plans')).toBe('questions-and-plans')
    expect(respondLevel('all')).toBe('off')
    expect(respondInfo('everything', true, true, null)).toEqual({ level: 'everything', accepts: ['question', 'message', 'plan-approve', 'plan-feedback', 'permission', 'command'], limits: [] })
    expect(respondInfo('everything', true, true, false)).toEqual({ level: 'everything', accepts: ['question', 'message', 'plan-feedback', 'command'], limits: ['no-permission-hooks'] })
    expect(respondInfo('questions', true, false, null)).toEqual({ level: 'questions', accepts: [], limits: ['not-interactive'] })
    expect(respondInfo('everything', false, true, null).accepts).toEqual([])
  })

  test('a plan approval carries the event’s tool_input unchanged as updatedInput, and setMode for the session', async () => {
    // Regression guard (#206): without updatedInput, equal to tool_input, Claude Code ignores the approval.
    const input = { plan: '# Plan\n\n1. Do it', planFilePath: '/Users/dev/.claude/plans/x.md' }
    const a = planApproval(input, 'acceptEdits')
    expect(a).toEqual({ decision: { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } })
    expect(a.decision.updatedInput).toBe(input)
  })

  test('a tool decision is allow or deny, never a rule change', async () => {
    expect(toolDecision(by('allow-once', 't'))).toEqual({ decision: { behavior: 'allow' } })
    expect(toolDecision(by('deny', 't', { text: 'Not yet.' }))).toEqual({ decision: { behavior: 'deny', message: 'Not yet.' } })
    expect(toolDecision(by('deny', 't'))).toEqual({ decision: { behavior: 'deny', message: 'Denied from Podium.' } })
    expect(JSON.stringify(toolDecision(by('allow-once', 't')))).not.toContain('updatedPermissions')
  })

  test('turns answers by position back into Claude Code’s map, by the questions as asked', async () => {
    expect(answersMap(QUESTIONS, [{ options: [1] }, { options: [0, 2] }])).toEqual({ 'How many rows per page?': 'Fixed 50', 'What should Back restore?': 'The page, The scroll' })
    expect(answersMap(QUESTIONS, [{ text: '50, and remember it' }, null])).toEqual({ 'How many rows per page?': '50, and remember it' })
  })

  test('tells a terminal plan feedback from Esc, and a denial from a tool that ran and failed', async () => {
    expect(planRejection("The user doesn't want to proceed with this tool use. ... To tell you how to proceed, the user said:\nMake it one step.")).toBe('feedback')
    expect(planRejection("The user doesn't want to proceed with this tool use. ... STOP what you are doing and wait for the user to tell you how to proceed.")).toBe('closed')
    expect(toolDenied({ isError: true, result: "The user doesn't want to proceed with this tool use.", text: "The user doesn't want to proceed with this tool use." })).toBe(true)
    expect(toolDenied({ deny: 'no' })).toBe(true)
    expect(toolDenied({ isError: true, text: 'Exit code 1' })).toBe(false)
    expect(toolDenied({ result: { stdout: 'ok' } })).toBe(false)
  })

  test('redacts and cuts what an ask carries, and marks a tool input that was cut', async () => {
    expect(toolInput({ command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"' }).input.command).toContain('[redacted]')
    expect(cut('y'.repeat(50), 10)).toBe(`${'y'.repeat(10)}\n\n[cut off at 10 characters]`)
  })

  test('a question answered in the terminal reads without Claude Code’s "(Recommended)" mark, as the mockup shows it', async () => {
    const res = { result: { answers: { 'Page size?': '25/50/100, default 50 (Recommended)', 'Back?': 'The page number (Recommended), The scroll' } } }
    expect(terminalAnswers(res)).toBe('25/50/100, default 50; The page number, The scroll')
  })

  test('a tool input is cut only past 20,000 characters, and then only its longest text, with the rest kept', async () => {
    // Up to the SPEC's 20,000 (6.2) nothing is cut, so Allow once stays possible.
    const mid = toolInput({ command: 'x'.repeat(5000), description: 'Write the file' })
    expect(mid.cut).toBe(false)
    expect(mid.input.command).toBe('x'.repeat(5000))
    // Past it, the longest text is cut with its marker so the whole input fits; other fields stay.
    const long = toolInput({ command: 'x'.repeat(25_000), description: 'Write the file' })
    expect(long.cut).toBe(true)
    expect(long.input.description).toBe('Write the file')
    expect(String(long.input.command)).toMatch(/^x+ \[cut off at [\d,]+ characters\]$/)
    expect(JSON.stringify(long.input).length).toBeLessThanOrEqual(20_000)
  })
})

describe('respond: off', () => {
  test('off by default: a question passes through, nothing is announced, and the report says the option is off', async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never)
    await settle(w)
    w.dialog.resolve!({ result: { questions: QUESTIONS, answers: { 'How many rows per page?': 'Fixed 50' } } })
    await call
    expect(puts(w)).toEqual([])
    // Present with level off, so Podium shows "Turned off" rather than "Reporter can't answer" (SPEC 6.2: absent only
    // from a reporter older than 0.14.0).
    expect(w.posts.at(-1)!.session.respond).toEqual({ level: 'off', accepts: [], limits: [] })
    expect(w.posts.at(-1)!.session.asks).toBeUndefined()
  })

  test('with the server not taking answers, nothing is announced', { options: ON }, async ($, on) => {
    const w = world(on)
    w.server.respond = false
    await started($, w)
    expect(w.posts.at(-1)!.session.respond).toMatchObject({ level: 'everything' })
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never)
    await settle(w)
    w.dialog.resolve!({ result: { questions: QUESTIONS, answers: {} } })
    await call
    expect(puts(w)).toEqual([])
  })
})

describe('respond: a question', () => {
  test('Podium first: the answer closes the dialog, names who answered, and counts once taken', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never)
    await settle(w)
    const ask = puts(w)[0]!
    expect(ask).toMatchObject({ kind: 'question', questions: [{ question: 'How many rows per page?', header: 'Page size', multiSelect: false }, { multiSelect: true }] })
    expect(w.logs).toContain('also open in Podium. Answer here or there.')
    w.deliver(by('question', ask.id, { answers: [{ options: [0] }, { options: [1, 2] }] }))
    const res = (await call) as { result: { answers: Record<string, string> } }
    expect(res.result.answers).toEqual({ 'How many rows per page?': '25/50/100', 'What should Back restore?': 'The rows, The scroll' })
    expect(w.logs.some((l) => /^Answered from Podium by Ed at \d\d:\d\d$/.test(l))).toBe(true)
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_question_${ask.id}`, 'took']])
  })

  test('a message in place of an answer goes as the response, with no answers', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never)
    await settle(w)
    w.deliver(by('reply', puts(w)[0]!.id, { text: 'How busy is a busy day?' }))
    expect(await call).toEqual({ result: { questions: QUESTIONS, answers: {}, response: 'How busy is a busy day?' } })
    expect(w.logs.some((l) => l.startsWith('Replied from Podium by Ed at '))).toBe(true)
  })

  test('terminal first: its answer stands, Podium hears what it was, and a later answer is not used', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never)
    await settle(w)
    const terminal = { result: { questions: QUESTIONS, answers: { 'How many rows per page?': 'Fixed 50', 'What should Back restore?': 'The page' } }, text: 'answered' }
    w.dialog.resolve!(terminal)
    expect(await call).toEqual(terminal)
    w.deliver(by('question', puts(w)[0]!.id, { answers: [{ options: [0] }, null] }))
    await settle(w)
    await w.clock.advance(1000)
    expect(closes(w)).toEqual([expect.objectContaining({ outcome: 'terminal', answer: 'Fixed 50; The page' })])
    expect(results(w)).toEqual([[`dlv_question_${puts(w)[0]!.id}`, 'closed']])
  })

  test('Esc closes it without an answer, reported from the timer', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never)
    await settle(w)
    w.dialog.resolve!({ isError: true, result: "The user doesn't want to proceed with this tool use.", text: "The user doesn't want to proceed with this tool use." })
    await call
    expect(closes(w)).toEqual([])
    await w.clock.advance(1000)
    expect(closes(w)).toEqual([expect.objectContaining({ outcome: 'closed' })])
  })

  test('the open ask rides in every report while the server takes answers', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    leaveOpen($.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never))
    await settle(w)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.asks).toEqual([expect.objectContaining({ kind: 'question' })])
  })

  test('an ask the server stopped waiting on leaves the reports, so the server never takes an answer nobody collects', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    leaveOpen($.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS } as never))
    await settle(w)
    w.dropAsks()
    await settle(w)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.asks).toEqual([])
  })
})

describe('respond: a plan', () => {
  const PLAN_INPUT = { plan: '# Plan\n\n1. Page it', planFilePath: '/Users/dev/.claude/plans/wise.md' }

  test('an approval goes to the PermissionRequest hook with updatedInput and the mode, and counts once the call resolves approved', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    const ask = puts(w)[0]!
    expect(ask).toMatchObject({ kind: 'plan', plan: { text: '# Plan\n\n1. Page it', filePath: '/Users/dev/.claude/plans/wise.md' } })
    const pr = $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: PLAN_INPUT } as never)
    await settle(w)
    w.deliver(by('plan-approve', ask.id, { mode: 'default' }))
    const decision = await pr
    // The regression guard, end to end: the decision carries the event's own input back.
    expect(decision).toEqual({ decision: { behavior: 'allow', updatedInput: PLAN_INPUT, updatedPermissions: [{ type: 'setMode', mode: 'default', destination: 'session' }] } })
    // The terminal hears of the approval only once Claude Code took it, never before.
    expect(w.logs.some((l) => l.startsWith('Approved from Podium by Ed at '))).toBe(false)
    w.dialog.resolve!({ result: { plan: PLAN_INPUT.plan, isAgent: false } })
    await call
    expect(w.logs.some((l) => l.startsWith('Approved from Podium by Ed at '))).toBe(true)
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_plan-approve_${ask.id}`, 'took']])
  })

  test('the PermissionRequest hook waits for a plan approval with a held request of its own, so its 10-second budget stands still', { options: ON }, async ($, on) => {
    // Seen live on 2.1.301: approved 12 s after the plan dialog opened, the hook had been let go and Claude Code never
    // got the approval. A hook's clock stops only while a next(e) or $ call of its own is in flight (HookBudget), so
    // waiting on a promise alone ran it out. The kit lets any mock wait past 10 s go too, so this checks the held
    // request itself rather than waiting out the budget.
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    const ask = puts(w)[0]!
    const before = w.holding() // the tool.call hook's own wait, for "No, keep planning"
    const pr = $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: PLAN_INPUT } as never)
    await settle(w)
    expect(w.holding()).toBe(before + 1)
    w.deliver(by('plan-approve', ask.id, { mode: 'auto' }))
    expect(await pr).toEqual({ decision: { behavior: 'allow', updatedInput: PLAN_INPUT, updatedPermissions: [{ type: 'setMode', mode: 'auto', destination: 'session' }] } })
    w.dialog.resolve!({ result: { plan: PLAN_INPUT.plan, isAgent: false } })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_plan-approve_${ask.id}`, 'took']])
  })

  test('an approval reaches the PermissionRequest that fires as the plan dialog opens, inside the call', { options: ON }, async ($, on) => {
    // Claude Code fires ExitPlanMode's PermissionRequest while the call is under way: the hook must still find the plan
    // ask, or it passes the dialog through and an approval from Podium has nobody to answer it (seen live on 2.1.301).
    const w = world(on)
    await started($, w)
    let pr: Promise<unknown> | null = null
    w.onDialog.run = () => {
      pr = $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: PLAN_INPUT } as never)
    }
    const call = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    const ask = puts(w)[0]!
    w.deliver(by('plan-approve', ask.id, { mode: 'acceptEdits' }))
    expect(await pr).toEqual({ decision: { behavior: 'allow', updatedInput: PLAN_INPUT, updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } })
    w.dialog.resolve!({ result: { plan: PLAN_INPUT.plan, isAgent: false } })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_plan-approve_${ask.id}`, 'took']])
  })

  test('an approval the call does not take within 5 seconds is reported not taken, and the terminal can still approve', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    const ask = puts(w)[0]!
    leaveOpen($.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: PLAN_INPUT } as never))
    await settle(w)
    w.deliver(by('plan-approve', ask.id, { mode: 'auto' }))
    await settle(w)
    await w.clock.advance(6000)
    expect(results(w)).toContainEqual([`dlv_plan-approve_${ask.id}`, 'not-taken'])
    // The approval didn't take, so the terminal never says it was approved from Podium.
    expect(w.logs.some((l) => l.startsWith('Approved from Podium'))).toBe(false)
    w.dialog.resolve!({ result: { plan: PLAN_INPUT.plan } })
    await call
    await w.clock.advance(1000)
    expect(results(w).filter(([, r]) => r === 'took')).toEqual([])
  })

  test('"No, keep planning" goes back as a deny with the feedback', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const call = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    w.deliver(by('plan-feedback', puts(w)[0]!.id, { text: 'Also cover search.' }))
    // Framed as the terminal frames "Tell Claude what to change", naming Podium: the bare text alone read to Claude as
    // an injected instruction, and it put the same plan up again (seen live on 2.1.301, 2026-10-15).
    expect(await call).toEqual({ deny: "The user doesn't want to proceed with this plan yet. They sent this from Podium: Also cover search." })
    expect(w.logs.some((l) => l.startsWith('Sent back from Podium by Ed at '))).toBe(true)
  })

  test('approved in the terminal: Podium hears it was approved, with no mode; feedback there reads No, keep planning', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const first = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    w.dialog.resolve!({ isError: true, result: 'rejected', text: "The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\nOne step." })
    await first
    const second = $.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never)
    await settle(w)
    w.dialog.resolve!({ result: { plan: PLAN_INPUT.plan } })
    await second
    await w.clock.advance(1000)
    expect(closes(w)).toEqual([expect.objectContaining({ outcome: 'terminal', answer: 'No, keep planning' }), expect.objectContaining({ outcome: 'terminal', planApproved: true })])
  })

  test('at the questions level an approval is refused and the PermissionRequest passes through', { options: { respond: 'questions', activityFeed: true } }, async ($, on) => {
    const w = world(on)
    await started($, w)
    leaveOpen($.tool.call({ tool: 'ExitPlanMode', ...PLAN_INPUT } as never))
    await settle(w)
    expect(puts(w)).toEqual([])
    expect(await $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: PLAN_INPUT } as never)).toEqual({})
  })
})

describe('respond: a tool permission', () => {
  const CMD = { command: 'git push -u origin main', description: 'Push the branch' }

  async function prompt($: Engine, w: World) {
    const call = $.tool.call({ tool: 'Bash', ...CMD } as never)
    await settle(w)
    const pr = $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: CMD } as never)
    await settle(w)
    return { call, pr, ask: puts(w)[0]! }
  }

  test('Allow once from Podium: allowed, nothing else; the call runs and the answer took', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const { call, pr, ask } = await prompt($, w)
    expect(ask).toMatchObject({ kind: 'permission', tool: { name: 'Bash', input: CMD, cut: false } })
    w.deliver(by('allow-once', ask.id))
    expect(await pr).toEqual({ decision: { behavior: 'allow' } })
    expect(w.logs.some((l) => l.startsWith('Allowed once from Podium by Ed at '))).toBe(true)
    w.toolRun.resolve!({ result: { stdout: 'ok' }, text: 'ok' })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_allow-once_${ask.id}`, 'took']])
    expect(closes(w)).toEqual([])
  })

  test('Deny from Podium with a reason: the call is refused with it, and the answer took', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const { call, pr, ask } = await prompt($, w)
    w.deliver(by('deny', ask.id, { text: 'Run the build first.' }))
    expect(await pr).toEqual({ decision: { behavior: 'deny', message: 'Run the build first.' } })
    expect(w.logs.some((l) => l.startsWith('Denied from Podium by Ed at '))).toBe(true)
    // What Claude Code resolves the call to after a PermissionRequest deny, as seen live on 2.1.301: an error whose text
    // is the deny's own message ("Error: Run the build first." in the transcript), no stock wording.
    w.toolRun.resolve!({ isError: true, text: 'Run the build first.', result: 'Run the build first.' })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_deny_${ask.id}`, 'took']])
    expect(closes(w)).toEqual([])
  })

  test('a Deny from Podium with no reason is recognized too, by the message it sent', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const { call, pr, ask } = await prompt($, w)
    w.deliver(by('deny', ask.id, {}))
    expect(await pr).toEqual({ decision: { behavior: 'deny', message: 'Denied from Podium.' } })
    w.toolRun.resolve!({ isError: true, text: 'Denied from Podium.', result: 'Denied from Podium.' })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_deny_${ask.id}`, 'took']])
  })

  test('a Podium Deny, but the command ran: the terminal allowed it first, and the Deny is never shown as taken', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const { call, pr, ask } = await prompt($, w)
    w.deliver(by('deny', ask.id))
    await pr
    w.toolRun.resolve!({ result: { stdout: 'pushed' }, text: 'pushed' })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_deny_${ask.id}`, 'closed']])
    expect(closes(w)).toEqual([expect.objectContaining({ outcome: 'terminal', answer: 'allowed' })])
  })

  test('a Podium Allow, but the call was refused: the terminal denied it first', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const { call, pr, ask } = await prompt($, w)
    w.deliver(by('allow-once', ask.id))
    await pr
    w.toolRun.resolve!({ isError: true, result: "The user doesn't want to proceed with this tool use.", text: "The user doesn't want to proceed with this tool use." })
    await call
    await w.clock.advance(1000)
    expect(results(w)).toEqual([[`dlv_allow-once_${ask.id}`, 'closed']])
    expect(closes(w)).toEqual([expect.objectContaining({ outcome: 'terminal', answer: 'denied' })])
  })

  test('answered in the terminal with nothing from Podium: allowed or denied, from how the call ended', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    const a = await prompt($, w)
    w.toolRun.resolve!({ result: { stdout: 'ok' }, text: 'ok' })
    await a.call
    const b = await prompt($, w)
    w.toolRun.resolve!({ isError: true, result: "The user doesn't want to proceed with this tool use.", text: "The user doesn't want to proceed with this tool use." })
    await b.call
    await w.clock.advance(1000)
    expect(closes(w).map((c) => c.answer)).toEqual(['allowed', 'denied'])
  })
})

describe('respond: messages and commands', () => {
  test('a message starts a turn under the plugin’s name, and is named in the transcript', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    w.server.deliveries.push(by('message', null, { id: 'dlv_m1', text: 'Start on issue #205.' }))
    await w.clock.advance(5000)
    await settle(w)
    expect(w.submitted).toEqual(['Start on issue #205.'])
    expect(w.logs.some((l) => l.startsWith('Sent from Podium by Ed at '))).toBe(true)
    await w.clock.advance(1000)
    expect(results(w)).toEqual([['dlv_m1', 'took']])
  })

  test('a result the server answers 404 to is dropped, not sent again (#329)', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    w.resultStatus.value = 404
    w.server.deliveries.push(by('message', null, { id: 'dlv_m404', text: 'hello' }))
    await w.clock.advance(5000)
    await settle(w)
    await w.clock.advance(30_000)
    expect(results(w)).toEqual([['dlv_m404', 'took']])
  })

  test('/clear and /compact run as commands; anything else, or one handed over twice, does nothing', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    w.server.deliveries.push(by('command', null, { id: 'dlv_c1', command: 'clear' }), by('command', null, { id: 'dlv_c2', command: 'model' as never }), by('command', null, { id: 'dlv_c1', command: 'clear' }))
    await w.clock.advance(5000)
    await settle(w)
    expect(w.commands).toEqual(['clear'])
    await w.clock.advance(1000)
    expect(results(w)).toEqual(expect.arrayContaining([['dlv_c2', 'refused'], ['dlv_c1', 'took']]))
  })

  test('at the questions level a command is refused', { options: { respond: 'questions', activityFeed: true } }, async ($, on) => {
    const w = world(on)
    await started($, w)
    w.server.deliveries.push(by('command', null, { id: 'dlv_c3', command: 'compact' }))
    await w.clock.advance(5000)
    await settle(w)
    await w.clock.advance(1000)
    expect(w.commands).toEqual([])
    expect(results(w)).toEqual([['dlv_c3', 'refused']])
  })

  test('after a /clear, the new id’s reports name the session it continues', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } })
    w.sessionId.value = 'sess-after-clear'
    await w.clock.advance(1000)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session).toMatchObject({ id: 'sess-after-clear', clearedFrom: SID })
  })

  test('says once that messages from Podium are on, while the session is idle', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.advance(1000)
    await w.clock.advance(1000)
    expect(w.logs.filter((l) => l === 'messages from Podium are on.')).toHaveLength(1)
  })
})

describe('respond: where PermissionRequest hooks do not run', () => {
  test('a prompt with no PermissionRequest within 2 seconds drops plan approval and tool permissions, until one fires', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    await $.tool.check({ tool: 'Edit', input: { file_path: '/x' }, tool_use_id: 'toolu_check1' } as never)
    await w.clock.advance(2500)
    await w.clock.advance(5000)
    expect(w.posts.at(-1)!.session.respond).toEqual({ level: 'everything', accepts: ['question', 'message', 'plan-feedback', 'command'], limits: ['no-permission-hooks'] })
    // Any PermissionRequest shows they run after all (auto mode answers some prompts with no dialog).
    await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: { file_path: '/y' } } as never)
    await w.clock.advance(1000)
    expect(w.posts.at(-1)!.session.respond?.limits).toEqual([])
  })

  test('a PermissionRequest that follows the prompt in time keeps every kind', { options: ON }, async ($, on) => {
    const w = world(on)
    await started($, w)
    leaveOpen($.tool.call({ tool: 'Bash', command: 'git push', description: 'Push' } as never))
    await settle(w)
    await $.tool.check({ tool: 'Bash', input: { command: 'git push', description: 'Push' }, tool_use_id: 'toolu_check2' } as never)
    void $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push', description: 'Push' } } as never)
    await w.clock.advance(2500)
    await w.clock.advance(5000)
    expect(w.posts.at(-1)!.session.respond?.limits).toEqual([])
  })
})
