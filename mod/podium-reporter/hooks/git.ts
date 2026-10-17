// Git state of the session's working directory (SPEC 5.7). Parsing is pure; `readGit` runs the
// queries through an injected runner (the mod passes `$.process.run`).
import type { ChangedFile, FileStatus, FilesReport, GitInfo } from './protocol.ts';

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

/** The empty tree: the base for a repository with no commits yet. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** The most files listed in a report; the totals still cover every file. */
export const MAX_FILES = 200;
/** Untracked files are line-counted by one `git grep` per chunk of this many paths. */
const GREP_CHUNK = 100;
/** Empty and binary untracked files `git grep` leaves out get their own `git diff --no-index`, this many per read; the rest stay uncounted. */
const NUMSTAT_LIMIT = 20;

export interface NameStatus {
  status: FileStatus;
  path: string;
  from: string | null;
}

/** `git diff --name-status -z -M`: `M\0path\0`, and `R100\0old\0new\0` for a rename. */
export function parseNameStatus(stdout: string): NameStatus[] {
  const t = stdout.split('\0');
  const out: NameStatus[] = [];
  for (let i = 0; i < t.length; i++) {
    const code = t[i];
    if (!code) continue;
    const c = code[0];
    if (c === 'R' || c === 'C') {
      const from = t[i + 1];
      const path = t[i + 2];
      i += 2;
      if (path) out.push({ status: c === 'R' ? 'renamed' : 'added', path, from: c === 'R' ? (from ?? null) : null });
    } else {
      const path = t[++i];
      if (path) out.push({ status: c === 'A' ? 'added' : c === 'D' ? 'deleted' : 'modified', path, from: null });
    }
  }
  return out;
}

export interface LineCount {
  added: number | null;
  removed: number | null;
}

const count = (v: string): number | null => (v === '-' ? null : Number(v));

/** `git diff --numstat -z -M`, keyed by the (new) path. Binary files have `-` counts; a rename has an empty path and the two names follow. */
export function parseNumstat(stdout: string): Map<string, LineCount> {
  const t = stdout.split('\0');
  const out = new Map<string, LineCount>();
  for (let i = 0; i < t.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(t[i] ?? '');
    if (!m) continue;
    let path = m[3] ?? '';
    if (path === '') {
      path = t[i + 2] ?? '';
      i += 2;
    }
    if (path) out.set(path, { added: count(m[1]!), removed: count(m[2]!) });
  }
  return out;
}

export interface Changes {
  /** The starting commit, to hand back on the next read. */
  base: string;
  files: FilesReport;
}

/**
 * The files changed since the session started (SPEC 5.7). `base` is the commit HEAD was at when the
 * session began, or null on the first read, which takes HEAD (or the empty tree before the first
 * commit). Returns null when a query fails, so the caller keeps what it had.
 */
export async function readChanges(run: Runner, cwd: string, base: string | null): Promise<Changes | null> {
  try {
    const top = (await run(['git', 'rev-parse', '--show-toplevel'])).stdout.trim() || cwd;
    const git = (...args: string[]) => ['git', '-C', top, ...args];
    const out = async (argv: string[], okCodes: number[] = [0]) => {
      const r = await run(argv);
      if (!okCodes.includes(r.exitCode)) throw new Error(`${argv.join(' ')} exited ${r.exitCode}`);
      return r.stdout;
    };
    const headRes = await run(git('rev-parse', 'HEAD'));
    const head = headRes.exitCode === 0 ? headRes.stdout.trim() : null;
    const start = base ?? head ?? EMPTY_TREE;
    let ref: string;
    let since: FilesReport['since'] = 'start';
    if (start === EMPTY_TREE) ref = EMPTY_TREE;
    else if ((await run(git('merge-base', '--is-ancestor', start, 'HEAD'))).exitCode === 0) ref = start;
    else {
      // A rebase, an amend or a branch switch dropped the starting commit.
      const up = await run(git('merge-base', 'HEAD', '@{upstream}'));
      const mb = up.exitCode === 0 ? up.stdout.trim() : '';
      since = mb ? 'upstream' : 'worktree';
      ref = mb || head || EMPTY_TREE;
    }
    const [names, nums, others] = await Promise.all([
      out(git('diff', '--name-status', '-z', '-M', ref)),
      out(git('diff', '--numstat', '-z', '-M', ref)),
      out(git('ls-files', '-z', '--others', '--exclude-standard', '--full-name')),
    ]);
    const lines = parseNumstat(nums);
    const all: ChangedFile[] = parseNameStatus(names).map((n) => ({ path: n.path, status: n.status, from: n.from, added: lines.get(n.path)?.added ?? null, removed: lines.get(n.path)?.removed ?? null }));
    for (const p of others.split('\0').filter(Boolean)) all.push({ path: p, status: 'added', from: null, added: null, removed: null });
    all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    // Only the files that will be listed need counts, so pick them after sorting; the rest still count toward the total.
    const tracked = new Set(parseNameStatus(names).map((n) => n.path));
    const pending = all.slice(0, MAX_FILES).filter((f) => !tracked.has(f.path));
    // One `git grep -c` per chunk counts the lines of every text file in it. It leaves out empty and binary
    // files, which keep the per-file numstat result below, for the first few only.
    const grepable = pending.filter((f) => !f.path.includes('\n'));
    const counted = new Set<string>();
    for (let i = 0; i < grepable.length; i += GREP_CHUNK) {
      const chunk = new Map(grepable.slice(i, i + GREP_CHUNK).map((f) => [f.path, f]));
      const lines = await out(['git', '-C', top, '--literal-pathspecs', 'grep', '--no-index', '-I', '-c', '-z', '', '--', ...chunk.keys()], [0, 1]);
      for (const line of lines.split('\n')) {
        const cut = line.lastIndexOf('\0');
        const f = cut > 0 ? chunk.get(line.slice(0, cut)) : undefined;
        if (!f) continue;
        f.added = Number(line.slice(cut + 1));
        f.removed = 0;
        counted.add(f.path);
      }
    }
    const rest = pending.filter((f) => !counted.has(f.path)).slice(0, NUMSTAT_LIMIT);
    const got = await Promise.all(
      rest.map(async (f) => parseNumstat(await out(git('diff', '--no-index', '--numstat', '-z', '--', '/dev/null', f.path), [0, 1])).get(f.path) ?? { added: null, removed: null }),
    );
    rest.forEach((f, j) => {
      f.added = got[j]!.added;
      f.removed = got[j]!.removed;
    });
    const sum = (k: 'added' | 'removed') => all.reduce((n, f) => n + (f[k] ?? 0), 0);
    return { base: start, files: { files: all.slice(0, MAX_FILES), total: all.length, added: sum('added'), removed: sum('removed'), since } };
  } catch {
    return null;
  }
}
