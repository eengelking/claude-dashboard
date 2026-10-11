import { describe, test, expect } from 'claude-code/testing'
import { parseStatus, readGit, resolvePath, type Runner } from './git.ts'

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
