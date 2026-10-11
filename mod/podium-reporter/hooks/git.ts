// Git state of the session's working directory (SPEC 5.7). Parsing is pure; `readGit` runs the
// queries through an injected runner (the mod passes `$.process.run`).
import type { GitInfo } from './protocol.ts';

export interface RunResult {
  exitCode: number;
  stdout: string;
}
export type Runner = (argv: string[]) => Promise<RunResult>;

/** POSIX path resolution of `p` against `base` (no Node in the hooks sandbox). */
export function resolvePath(base: string, p: string): string {
  const parts = (p.startsWith('/') ? p : `${base}/${p}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export interface StatusLine {
  ahead: number;
  behind: number;
  dirty: number;
}

/** `git status --porcelain=v1 -b`: the `##` line gives ahead/behind; every other line is one changed path. */
export function parseStatus(stdout: string): StatusLine {
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  let ahead = 0;
  let behind = 0;
  const head = lines[0]?.startsWith('##') ? lines[0] : null;
  if (head) {
    const a = /ahead (\d+)/.exec(head);
    const b = /behind (\d+)/.exec(head);
    ahead = a ? Number(a[1]) : 0;
    behind = b ? Number(b[1]) : 0;
  }
  return { ahead, behind, dirty: lines.length - (head ? 1 : 0) };
}

export function lastSegment(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

/** Reads branch, worktree and status; null when `cwd` is not in a repository or a query fails. */
export async function readGit(run: Runner, cwd: string): Promise<GitInfo | null> {
  const ok = async (argv: string[]) => {
    const r = await run(argv);
    if (r.exitCode !== 0) throw new Error(`${argv.join(' ')} exited ${r.exitCode}`);
    return r.stdout.trim();
  };
  try {
    const [abbrev, gitDir, commonDir, top, status] = await Promise.all([
      ok(['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
      ok(['git', 'rev-parse', '--git-dir']),
      ok(['git', 'rev-parse', '--git-common-dir']),
      ok(['git', 'rev-parse', '--show-toplevel']),
      run(['git', 'status', '--porcelain=v1', '-b']),
    ]);
    const detached = abbrev === 'HEAD';
    const branch = detached ? await ok(['git', 'rev-parse', '--short', 'HEAD']).catch(() => null) : abbrev;
    const isWorktree = resolvePath(cwd, gitDir) !== resolvePath(cwd, commonDir);
    const st = status.exitCode === 0 ? parseStatus(status.stdout) : { ahead: 0, behind: 0, dirty: 0 };
    return { branch, detached, isWorktree, worktreePath: isWorktree ? top : null, ...st };
  } catch {
    return null;
  }
}
