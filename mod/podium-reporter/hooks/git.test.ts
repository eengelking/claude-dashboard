import { describe, test, expect } from 'claude-code/testing'
import { EMPTY_TREE, MAX_FILES, parseNameStatus, parseNumstat, parseStatus, readChanges, readGit, resolvePath, type Runner } from './git.ts'

function runner(map: Record<string, { exitCode?: number; stdout?: string }>): Runner {
  return async (argv) => {
    const r = map[argv.slice(1).join(' ')]
    return { exitCode: r?.exitCode ?? (r ? 0 : 128), stdout: r?.stdout ?? '' }
  }
}

const base = {
  'rev-parse --abbrev-ref HEAD': { stdout: 'feat/x\n' },
  'rev-parse --git-dir': { stdout: '.git\n' },
  'rev-parse --git-common-dir': { stdout: '.git\n' },
  'rev-parse --show-toplevel': { stdout: '/repo\n' },
  'status --porcelain=v1 -b': { stdout: '## feat/x...origin/feat/x [ahead 3, behind 1]\n' },
}

describe('git', () => {
  test('normal branch with ahead and behind, clean', async () => {
    expect(await readGit(runner(base), '/repo')).toEqual({ branch: 'feat/x', detached: false, isWorktree: false, worktreePath: null, ahead: 3, behind: 1, dirty: 0 })
  })

  test('detached head reports the short sha', async () => {
    const g = await readGit(runner({ ...base, 'rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' }, 'rev-parse --short HEAD': { stdout: '1a2b3c4\n' }, 'status --porcelain=v1 -b': { stdout: '## HEAD (no branch)\n' } }), '/repo')
    expect(g).toMatchObject({ branch: '1a2b3c4', detached: true, ahead: 0, behind: 0 })
  })

  test('a worktree: git-dir and common-dir differ', async () => {
    const g = await readGit(
      runner({
        ...base,
        'rev-parse --git-dir': { stdout: '/repo/.git/worktrees/feat-x\n' },
        'rev-parse --git-common-dir': { stdout: '/repo/.git\n' },
        'rev-parse --show-toplevel': { stdout: '/repo/.claude/worktrees/feat-x\n' },
      }),
      '/repo/.claude/worktrees/feat-x',
    )
    expect(g).toMatchObject({ isWorktree: true, worktreePath: '/repo/.claude/worktrees/feat-x' })
  })

  test('relative git dirs resolve against the working directory', async () => {
    const g = await readGit(runner({ ...base, 'rev-parse --git-dir': { stdout: '.git\n' }, 'rev-parse --git-common-dir': { stdout: '/repo/.git\n' } }), '/repo')
    expect(g!.isWorktree).toBe(false)
    expect(resolvePath('/a/b', '../c/./d')).toBe('/a/c/d')
  })

  test('not a repository (non-zero exit) gives null', async () => {
    expect(await readGit(runner({ 'rev-parse --abbrev-ref HEAD': { exitCode: 128, stdout: '' } }), '/tmp')).toBeNull()
  })

  test('dirty counts modified, untracked and renamed lines', () => {
    expect(parseStatus('## main...origin/main\n M src/a.ts\n?? new.txt\nR  old.ts -> new.ts\nA  added.ts\n')).toEqual({ ahead: 0, behind: 0, dirty: 4 })
    expect(parseStatus('## main\n')).toEqual({ ahead: 0, behind: 0, dirty: 0 })
    expect(parseStatus('## main...origin/main [behind 7]\n')).toEqual({ ahead: 0, behind: 7, dirty: 0 })
  })
})

const Z = '\0'
const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const top = {
  'rev-parse --show-toplevel': { stdout: '/repo\n' },
  '-C /repo rev-parse HEAD': { stdout: HEAD + '\n' },
  [`-C /repo merge-base --is-ancestor ${BASE} HEAD`]: { exitCode: 0 },
  [`-C /repo diff --name-status -z -M ${BASE}`]: { stdout: `M${Z}src/a.ts${Z}A${Z}src/new.ts${Z}D${Z}old.md${Z}R100${Z}x/was.ts${Z}x/now.ts${Z}` },
  [`-C /repo diff --numstat -z -M ${BASE}`]: { stdout: `12\t3\tsrc/a.ts${Z}40\t0\tsrc/new.ts${Z}0\t9\told.md${Z}2\t1\t${Z}x/was.ts${Z}x/now.ts${Z}` },
  '-C /repo ls-files -z --others --exclude-standard --full-name': { stdout: `notes.txt${Z}logo.png${Z}` },
  '-C /repo diff --no-index --numstat -z -- /dev/null notes.txt': { exitCode: 1, stdout: `7\t0\t${Z}/dev/null${Z}notes.txt${Z}` },
  '-C /repo diff --no-index --numstat -z -- /dev/null logo.png': { exitCode: 1, stdout: `-\t-\t${Z}/dev/null${Z}logo.png${Z}` },
}

describe('changed files', () => {
  test('parses name-status and numstat, renames and binary files included', () => {
    expect(parseNameStatus(`M${Z}a.ts${Z}R090${Z}old.ts${Z}new.ts${Z}T${Z}t.ts${Z}`)).toEqual([
      { status: 'modified', path: 'a.ts', from: null },
      { status: 'renamed', path: 'new.ts', from: 'old.ts' },
      { status: 'modified', path: 't.ts', from: null },
    ])
    const n = parseNumstat(`1\t2\ta.ts${Z}-\t-\tb.png${Z}3\t0\t${Z}old.ts${Z}new.ts${Z}`)
    expect(n.get('a.ts')).toEqual({ added: 1, removed: 2 })
    expect(n.get('b.png')).toEqual({ added: null, removed: null })
    expect(n.get('new.ts')).toEqual({ added: 3, removed: 0 })
  })

  test('lists tracked and untracked files since the starting commit, with totals', async () => {
    const r = await readChanges(runner(top), '/repo', BASE)
    expect(r!.base).toBe(BASE)
    expect(r!.files.since).toBe('start')
    expect(r!.files.files.map((f) => [f.path, f.status, f.added, f.removed, f.from])).toEqual([
      ['logo.png', 'added', null, null, null],
      ['notes.txt', 'added', 7, 0, null],
      ['old.md', 'deleted', 0, 9, null],
      ['src/a.ts', 'modified', 12, 3, null],
      ['src/new.ts', 'added', 40, 0, null],
      ['x/now.ts', 'renamed', 2, 1, 'x/was.ts'],
    ])
    expect(r!.files).toMatchObject({ total: 6, added: 12 + 40 + 7 + 2, removed: 3 + 9 + 1 })
  })

  test('the first read takes HEAD as the starting commit', async () => {
    const m = { ...top }
    m[`-C /repo merge-base --is-ancestor ${HEAD} HEAD`] = { exitCode: 0 }
    m[`-C /repo diff --name-status -z -M ${HEAD}`] = { stdout: '' }
    m[`-C /repo diff --numstat -z -M ${HEAD}`] = { stdout: '' }
    m['-C /repo ls-files -z --others --exclude-standard --full-name'] = { stdout: '' }
    const r = await readChanges(runner(m), '/repo', null)
    expect(r).toMatchObject({ base: HEAD, files: { files: [], total: 0, added: 0, removed: 0, since: 'start' } })
  })

  test('a starting commit that is no longer an ancestor falls back to the upstream merge base', async () => {
    const MB = 'c'.repeat(40)
    const m = { ...top, [`-C /repo merge-base --is-ancestor ${BASE} HEAD`]: { exitCode: 1 }, '-C /repo merge-base HEAD @{upstream}': { stdout: MB + '\n' } }
    m[`-C /repo diff --name-status -z -M ${MB}`] = { stdout: `M${Z}only.ts${Z}` }
    m[`-C /repo diff --numstat -z -M ${MB}`] = { stdout: `1\t1\tonly.ts${Z}` }
    m['-C /repo ls-files -z --others --exclude-standard --full-name'] = { stdout: '' }
    const r = await readChanges(runner(m), '/repo', BASE)
    expect(r!.files.since).toBe('upstream')
    expect(r!.files.files.map((f) => f.path)).toEqual(['only.ts'])
  })

  test('with no upstream either, only the working tree against HEAD is shown', async () => {
    const m = { ...top, [`-C /repo merge-base --is-ancestor ${BASE} HEAD`]: { exitCode: 1 } }
    m[`-C /repo diff --name-status -z -M ${HEAD}`] = { stdout: `M${Z}w.ts${Z}` }
    m[`-C /repo diff --numstat -z -M ${HEAD}`] = { stdout: `2\t0\tw.ts${Z}` }
    m['-C /repo ls-files -z --others --exclude-standard --full-name'] = { stdout: '' }
    const r = await readChanges(runner(m), '/repo', BASE)
    expect(r!.files.since).toBe('worktree')
    expect(r!.files.total).toBe(1)
  })

  test('a repository with no commits diffs against the empty tree', async () => {
    const m: Record<string, { exitCode?: number; stdout?: string }> = {
      'rev-parse --show-toplevel': { stdout: '/repo\n' },
      '-C /repo rev-parse HEAD': { exitCode: 128 },
      [`-C /repo diff --name-status -z -M ${EMPTY_TREE}`]: { stdout: `A${Z}first.ts${Z}` },
      [`-C /repo diff --numstat -z -M ${EMPTY_TREE}`]: { stdout: `5\t0\tfirst.ts${Z}` },
      '-C /repo ls-files -z --others --exclude-standard --full-name': { stdout: '' },
    }
    const r = await readChanges(runner(m), '/repo', null)
    expect(r!.base).toBe(EMPTY_TREE)
    expect(r!.files.files.map((f) => f.path)).toEqual(['first.ts'])
    // the first commit is made later: the base stays the empty tree, so the file is still listed
    m['-C /repo rev-parse HEAD'] = { stdout: HEAD + '\n' }
    const again = await readChanges(runner(m), '/repo', EMPTY_TREE)
    expect(again!.files.since).toBe('start')
  })

  test('more files than the cap: the list is cut, the totals cover all of them', async () => {
    const names = Array.from({ length: MAX_FILES + 50 }, (_, i) => `f${String(i).padStart(4, '0')}.ts`)
    const m = {
      ...top,
      [`-C /repo diff --name-status -z -M ${BASE}`]: { stdout: names.map((n) => `M${Z}${n}${Z}`).join('') },
      [`-C /repo diff --numstat -z -M ${BASE}`]: { stdout: names.map((n) => `2\t1\t${n}${Z}`).join('') },
      '-C /repo ls-files -z --others --exclude-standard --full-name': { stdout: '' },
    }
    const r = await readChanges(runner(m), '/repo', BASE)
    expect(r!.files.files).toHaveLength(MAX_FILES)
    expect(r!.files).toMatchObject({ total: MAX_FILES + 50, added: (MAX_FILES + 50) * 2, removed: MAX_FILES + 50 })
  })

  test('outside a repository there is nothing to read', async () => {
    expect(await readChanges(runner({}), '/tmp', null)).toBeNull()
  })

  test('a failing diff gives null, so the caller keeps what it had', async () => {
    const m = { ...top, [`-C /repo diff --numstat -z -M ${BASE}`]: { exitCode: 128 } }
    expect(await readChanges(runner(m), '/repo', BASE)).toBeNull()
  })
})
