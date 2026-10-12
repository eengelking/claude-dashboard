// A scripted session for the state and report tests (and the server-side cross-check in
// scripts/mod-report.test.ts): every reducer, in the order a real session raises them.
import { buildReport } from './report.ts';
import type { Report } from './protocol.ts';
import {
  agentRequested,
  agentSpawned,
  compaction,
  drainEvents,
  measure,
  newSession,
  setFiles,
  setGit,
  setIdentity,
  skillLoaded,
  step,
  toolResult,
  turnComplete,
  turnStart,
  type SessionState,
} from './state.ts';

export const T0 = 1_800_000_000_000;

const usage = (input: number, cacheRead = 0, model?: string) => ({ input_tokens: input, output_tokens: 100, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, ...(model ? { model } : {}) });

export function scriptedState(): SessionState {
  let s = newSession({ id: 'sess-1', cwd: '/Users/dev/app/.claude/worktrees/feat-x', startedAt: T0, model: 'claude-opus-5-5' });
  s = setIdentity(s, { projectRoot: '/Users/dev/app', repoName: 'acme/app' });
  s = setGit(s, { branch: 'feat/x', detached: false, isWorktree: true, worktreePath: '/Users/dev/app/.claude/worktrees/feat-x', ahead: 2, behind: 0, dirty: 1 });
  s = setFiles(
    s,
    {
      files: [
        { path: 'src/invoice/export.ts', status: 'modified', added: 24, removed: 6, from: null },
        { path: 'src/invoice/export.test.ts', status: 'added', added: 58, removed: 0, from: null },
        { path: 'src/invoice/legacy.ts', status: 'deleted', added: 0, removed: 112, from: null },
        { path: 'src/invoice/totals.ts', status: 'renamed', added: 3, removed: 1, from: 'src/invoice/sum.ts' },
      ],
      total: 4,
      added: 85,
      removed: 119,
      since: 'start',
    },
    'a1b2c3d',
  );
  s = turnStart(s);
  s = step(s, { model: 'claude-opus-5-5', effort: 'high', usage: usage(1000, 50_000), stopReason: 'tool_use' }, T0 + 1000);
  // the plan
  s = toolResult(s, { tool: 'TaskCreate', input: { subject: 'Map call sites', description: 'd', metadata: { planTitle: 'Migrate' } }, result: { result: { task: { id: '1', subject: 'Map call sites' } } } }, T0 + 1100);
  s = toolResult(s, { tool: 'TaskCreate', input: { subject: 'Port endpoints', description: 'd' }, result: { result: { task: { id: '2', subject: 'Port endpoints' } } } }, T0 + 1200);
  s = toolResult(s, { tool: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' }, result: { result: { success: true, taskId: '1', updatedFields: ['status'] } } }, T0 + 1300);
  // a subagent: requested effort low, then observed medium wins
  s = agentRequested(s, 'tu-1', { description: 'Map call sites', prompt: 'p', subagent_type: 'Explore', model: 'haiku', effort: 'low' }, T0 + 1400);
  s = agentSpawned(s, { toolUseId: 'tu-1', agentId: 'a1', model: 'claude-haiku-5-5', subagentType: 'Explore', description: 'Map call sites', prompt: 'Find every call site. token=SECRET123', fork: false }, T0 + 1500);
  s = step(s, { agentId: 'a1', model: 'claude-haiku-5-5', effort: 'medium', usage: usage(2000, 10_000), stopReason: 'tool_use' }, T0 + 2000);
  s = toolResult(s, { agentId: 'a1', tool: 'Skill', input: { skill: 'repo-map' }, result: { text: 'ok' } }, T0 + 2100);
  s = turnComplete(s, { agentId: 'a1', reason: 'answer', answer: 'Found 42 call sites.' }, T0 + 3000);
  // a fork: inherits the orchestrator's model and effort, whatever the Agent call asked
  s = agentRequested(s, 'tu-2', { description: 'Port endpoints', prompt: 'p', subagent_type: 'fork', effort: 'max' }, T0 + 3100);
  s = agentSpawned(s, { toolUseId: 'tu-2', agentId: 'a2', model: 'claude-opus-5-5', subagentType: 'fork', description: 'Port endpoints', prompt: 'Port them.', fork: true }, T0 + 3200);
  // a subagent that fails on Bash, with a window-exceeded stop and an auto compaction 1 s later (one blowout)
  s = agentRequested(s, 'tu-3', { description: 'Backfill dry run', prompt: 'p', model: 'sonnet' }, T0 + 3300);
  s = agentSpawned(s, { toolUseId: 'tu-3', agentId: 'a3', model: 'claude-sonnet-5-5', subagentType: 'general-purpose', description: 'Backfill dry run', prompt: 'Run it.', fork: false }, T0 + 3400);
  s = toolResult(s, { agentId: 'a3', tool: 'Bash', input: { command: 'npm run backfill' }, result: { isError: true, text: 'Exit code 1\nError: ECONNREFUSED' } }, T0 + 3500);
  s = toolResult(s, { agentId: 'a3', tool: 'Bash', input: { command: 'npm run backfill' }, result: { isError: true, text: 'Exit code 1\nError: ECONNREFUSED' } }, T0 + 3600);
  s = step(s, { agentId: 'a3', model: 'claude-sonnet-5-5', usage: usage(990_000), stopReason: 'model_context_window_exceeded' }, T0 + 4000);
  s = compaction(s, { agentId: 'a3', trigger: 'auto', tokensBefore: 1_000_000, tokensAfter: 300_000 }, T0 + 5000);
  s = turnComplete(s, { agentId: 'a3', reason: 'error' }, T0 + 6000);
  // the orchestrator blows out twice (more than 2 s apart) and compacts once by hand (not a blowout)
  s = compaction(s, { trigger: 'auto', tokensBefore: 990_000, tokensAfter: 200_000 }, T0 + 7000);
  s = compaction(s, { trigger: 'auto', tokensBefore: 990_000, tokensAfter: 200_000 }, T0 + 12_000);
  s = compaction(s, { trigger: 'manual', tokensBefore: 500_000, tokensAfter: 100_000 }, T0 + 13_000);
  s = skillLoaded(s, undefined, 'code-review', T0 + 13_500);
  s = measure(s, { context: { tokens: 100_000, window: 1_000_000, percent: 10 }, cost: { usd: 3.21 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12.5 }] });
  s = turnComplete(s, { reason: 'answer', answer: 'ok' }, T0 + 14_000);
  return s;
}

export function scriptedReport(): Report {
  const [s, events] = drainEvents(scriptedState());
  return buildReport(s, events, { version: '0.1.0', engineVersion: '2.1.296', hostSurface: 'terminal', now: T0 + 15_000, storedName: null, optionName: null });
}
