import { describe, test, expect } from 'claude-code/testing'
import { activityCall, activityText, candidateFrom, classify, evidence, excerpt, LIMITS, parseExitCode, redact, summarizeCall, tailLines, type ClassifyInput, type FailureCandidate } from './failures.ts'

const NOW = 1_000_000
const cand = (over: Partial<FailureCandidate> = {}): FailureCandidate => ({ at: NOW - 1000, tool: 'Bash', call: 'npm test', exitCode: 1, outputTail: ['FAIL'], denied: false, denyText: null, ...over })

describe('classify', () => {
  const cases: [string, Partial<ClassifyInput>, string | null][] = [
    ['answer is not a failure', { reason: 'answer', candidate: cand() }, null],
    ['a denied call', { reason: 'error', candidate: cand({ denied: true, denyText: 'no' }) }, 'Blocked by permission'],
    ['a denied call wins over aborted', { reason: 'aborted', candidate: cand({ denied: true }) }, 'Blocked by permission'],
    ['API error without a candidate', { reason: 'error' }, 'Model API error'],
    ['error with a tool candidate', { reason: 'error', candidate: cand() }, 'Tool error'],
    ['error with a stale candidate', { reason: 'error', candidate: cand({ at: NOW - 61_000 }) }, 'Model API error'],
    ['refusal', { reason: 'refusal' }, 'Refusal'],
    ['refusal with a candidate', { reason: 'refusal', candidate: cand() }, 'Refusal'],
    ['window exceeded stop', { reason: 'error', stopReason: 'model_context_window_exceeded', candidate: cand() }, 'Context window exhausted'],
    // the engine's `error` reason includes the context limit: a window-exceeded stop explains it
    ['error after a window-exceeded stop, no candidate', { reason: 'error', stopReason: 'model_context_window_exceeded' }, 'Context window exhausted'],
    ['refusal after three blowouts', { reason: 'refusal', blowouts: 3 }, 'Refusal'],
    ['three blowouts', { reason: 'error', blowouts: 3, candidate: cand() }, 'Context window exhausted'],
    ['two blowouts is not exhausted', { reason: 'error', blowouts: 2, candidate: cand() }, 'Tool error'],
    ['aborted', { reason: 'aborted' }, 'Aborted'],
    ['aborted after three blowouts', { reason: 'aborted', blowouts: 3 }, 'Context window exhausted'],
  ]
  for (const [name, over, want] of cases) {
    test(name, () => {
      expect(classify({ reason: 'error', candidate: null, stopReason: null, blowouts: 0, now: NOW, ...over } as ClassifyInput)).toBe(want)
    })
  }
})

describe('redaction and limits', () => {
  test('redacts every listed secret shape', () => {
    const s = [
      'key sk-ant-api03-ABCDEFGHIJ_klmnop',
      'gh ghp_abcdefghijklmnopqrstuvwxyz123456',
      'aws AKIAABCDEFGHIJKLMNOP',
      'auth Bearer abcdefghijklmnopqrstuvwxyz.123',
      'password=hunter2 token=abc123 secret=s3 apikey=k1 api_key=k2',
      '"api_key": "zzz"',
    ].join('\n')
    const r = redact(s)
    for (const leak of ['sk-ant-api03', 'ghp_abc', 'AKIAABCD', 'abcdefghijklmnopqrstuvwxyz.123', 'hunter2', 'abc123', 's3 ', 'k1', 'k2', 'zzz']) {
      expect(r.includes(leak)).toBe(false)
    }
    expect(r).toContain('password=[redacted]')
    expect(r).toContain('auth [redacted]')
    expect(redact('plain text stays')).toBe('plain text stays')
  })

  test('excerpts collapse whitespace and keep 400 characters', () => {
    expect(excerpt('  a\n\n b\t c  ')).toBe('a b c')
    expect(excerpt('x'.repeat(1000))).toHaveLength(LIMITS.excerpt)
    expect(excerpt(null)).toBe('')
  })

  test('output tails keep the last 12 lines of at most 240 characters, redacted', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i} ${'y'.repeat(300)}`).join('\n') + '\ntoken=SECRET\n\n'
    const t = tailLines(text)
    expect(t).toHaveLength(12)
    expect(t[11]).toBe('token=[redacted]')
    expect(t.every((l) => l.length <= 240)).toBe(true)
  })

  test('call summaries: Bash command, file tools with their path, others with the first argument', () => {
    expect(summarizeCall('Bash', { command: 'npm   test' })).toBe('npm test')
    expect(summarizeCall('Edit', { file_path: '/a/b.ts', old_string: 'x' })).toBe('Edit /a/b.ts')
    expect(summarizeCall('Grep', { pattern: 'TODO', path: '.' })).toBe('Grep TODO')
    expect(summarizeCall('Bash', { command: 'x'.repeat(500) })).toHaveLength(300)
  })

  test('exit codes are parsed best effort', () => {
    expect(parseExitCode('Exit code 2\nboom')).toBe(2)
    expect(parseExitCode('process exited with code 127')).toBe(127)
    expect(parseExitCode('no code here')).toBeNull()
  })

  test('candidates come from errors and denials only', () => {
    expect(candidateFrom('Bash', { command: 'ls' }, { text: 'ok' }, NOW)).toBeNull()
    const err = candidateFrom('Bash', { command: 'npm test' }, { isError: true, text: 'Exit code 1\nFAIL x' }, NOW)!
    expect(err).toMatchObject({ tool: 'Bash', call: 'npm test', exitCode: 1, outputTail: ['Exit code 1', 'FAIL x'], denied: false })
    const deny = candidateFrom('Bash', { command: 'rm -rf /' }, { deny: 'blocked by policy' }, NOW)!
    expect(deny).toMatchObject({ denied: true, denyText: 'blocked by policy' })
  })

  test('evidence is factual and at most five lines', () => {
    const ev = evidence({ blowoutTimes: [NOW, NOW + 1000], failedCalls: { 'npm test': 3, ls: 1, a: 2, b: 2, c: 2, d: 2 }, reads: { 'src/x.ts': 4, 'y.ts': 1 }, denyText: 'no' })
    expect(ev.length).toBe(5)
    expect(ev[0]).toContain('exceeded the context window 2 times')
    expect(ev[1]).toBe('same call failed 3 times: npm test')
    expect(ev.some((l) => l.includes(' ls'))).toBe(false)
  })
})

describe('activity entries (#118)', () => {
  test('a tool call is its name and a short summary of its arguments', () => {
    expect(activityCall('Bash', { command: 'npm   test\n-- people' })).toBe('Bash npm test -- people')
    expect(activityCall('Read', { file_path: 'docs/SPEC.md', offset: 560 })).toBe('Read docs/SPEC.md')
    expect(activityCall('Grep', { pattern: 'promptExcerpt', path: 'server/src/fleet' })).toBe('Grep "promptExcerpt" in server/src/fleet')
    expect(activityCall('Agent', { description: 'Map call sites', prompt: 'long prompt' })).toBe('Agent Map call sites')
    expect(activityCall('TaskList', { tool: 'TaskList', tool_use_id: 'x', agentId: 'a' })).toBe('TaskList')
  })

  test('a secret in a tool argument is redacted', () => {
    const e = activityCall('Bash', { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123" -d password=hunter2 http://x' })
    expect(e).not.toContain('abcdefghijklmnopqrstuvwxyz123')
    expect(e).not.toContain('hunter2')
    expect(e).toContain('[redacted]')
  })

  test('a secret in the text is redacted, and the text is cut to 300 characters', () => {
    const t = activityText(`Using sk-ant-api03-abcdefghijklmnop to call it.\n\n${'word '.repeat(200)}`)
    expect(t).not.toContain('sk-ant-api03')
    expect(t.startsWith('Using [redacted] to call it. word')).toBe(true)
    expect(t).toHaveLength(LIMITS.activity)
    expect(activityCall('Bash', { command: 'x'.repeat(1000) })).toHaveLength(LIMITS.activity)
  })

  test('a secret cut in half by the limit is still redacted, never left as a stub', () => {
    const t = activityText(`${'a'.repeat(290)} ghp_${'Z'.repeat(30)}`)
    expect(t).not.toContain('ghp_')
  })

  test('text that is only whitespace is no entry', () => {
    expect(activityText('  \n\t ')).toBe('')
  })
})

describe('activity entries, long input', () => {
  test('a secret after a long run of whitespace is still whole when it is redacted', () => {
    expect(activityText(`${' '.repeat(5000)}ghp_${'Z'.repeat(30)} done`)).toBe('[redacted] done')
    expect(activityCall('Bash', { command: `${'\n'.repeat(5000)}echo ghp_${'Z'.repeat(30)}` })).toBe('Bash echo [redacted]')
  })
})
