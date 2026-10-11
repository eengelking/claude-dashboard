// Task tools and TodoWrite -> plan steps (SPEC 6.3). Pure: every function returns a new PlanState
// and never throws on malformed input (it is ignored).
import type { Plan, PlanStep } from './protocol.ts';

export interface TaskState {
  id: string;
  text: string;
  activeText: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string | null;
  blockedBy: string[];
  /** Agent matched as owner; sticky once matched. */
  ownerAgentId: string | null;
  ownerLabel: string | null;
}

export interface PlanState {
  tasks: TaskState[];
  source: Plan['source'] | null;
  /** From the podium plan tool; wins over metadata. */
  toolTitle: string | null;
  metaTitle: string | null;
}

export const emptyPlan: PlanState = { tasks: [], source: null, toolTitle: null, metaTitle: null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function cut(s: string, n = 240): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** TaskCreate: the step id comes from the result (`{ task: { id } }`). */
export function taskCreate(p: PlanState, input: unknown, result: unknown): PlanState {
  try {
    if (!isObj(input)) return p;
    const r = isObj(result) && isObj(result.result) ? result.result : result;
    const task = isObj(r) && isObj(r.task) ? r.task : null;
    const id = task ? str(task.id) : null;
    const subject = str(input.subject) ?? (task ? str(task.subject) : null);
    if (!id || !subject) return p;
    const meta = isObj(input.metadata) ? input.metadata : null;
    const metaTitle = p.tasks.length === 0 && !p.metaTitle && meta ? str(meta.planTitle) ?? str(meta.title) : p.metaTitle;
    const t: TaskState = {
      id,
      text: cut(subject),
      activeText: str(input.activeForm) ? cut(String(input.activeForm)) : null,
      status: 'pending',
      owner: null,
      blockedBy: [],
      ownerAgentId: null,
      ownerLabel: null,
    };
    const tasks = p.source === 'TodoWrite' ? [] : p.tasks.filter((x) => x.id !== id);
    return { ...p, tasks: [...tasks, t], source: 'TaskCreate', metaTitle: p.source === 'TodoWrite' ? null : metaTitle };
  } catch {
    return p;
  }
}

/** TaskUpdate: status (incl. deleted), subject, activeForm, owner, addBlockedBy, addBlocks. */
export function taskUpdate(p: PlanState, input: unknown, result?: unknown): PlanState {
  try {
    if (!isObj(input)) return p;
    const r = isObj(result) && isObj(result.result) ? result.result : result;
    if (isObj(r) && r.success === false) return p;
    const id = str(input.taskId);
    if (!id || !p.tasks.some((t) => t.id === id)) return p;
    if (input.status === 'deleted') {
      return {
        ...p,
        tasks: p.tasks.filter((t) => t.id !== id).map((t) => ({ ...t, blockedBy: t.blockedBy.filter((b) => b !== id) })),
      };
    }
    const addBlocks = Array.isArray(input.addBlocks) ? input.addBlocks.filter((x): x is string => typeof x === 'string') : [];
    const addBlockedBy = Array.isArray(input.addBlockedBy) ? input.addBlockedBy.filter((x): x is string => typeof x === 'string') : [];
    const tasks = p.tasks.map((t) => {
      if (t.id === id) {
        const status = input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed' ? input.status : t.status;
        return {
          ...t,
          status,
          text: str(input.subject) ? cut(String(input.subject)) : t.text,
          activeText: str(input.activeForm) ? cut(String(input.activeForm)) : t.activeText,
          owner: str(input.owner) ? cut(String(input.owner), 80) : t.owner,
          blockedBy: [...new Set([...t.blockedBy, ...addBlockedBy.filter((b) => b !== id)])],
        };
      }
      if (addBlocks.includes(t.id) && !t.blockedBy.includes(id)) return { ...t, blockedBy: [...t.blockedBy, id] };
      return t;
    });
    return { ...p, tasks, source: p.source ?? 'TaskCreate' };
  } catch {
    return p;
  }
}

/** TodoWrite replaces the whole list; ids are `todo-<index>`. */
export function todoWrite(p: PlanState, input: unknown): PlanState {
  try {
    if (!isObj(input) || !Array.isArray(input.todos)) return p;
    const tasks: TaskState[] = [];
    input.todos.forEach((todo, i) => {
      if (!isObj(todo)) return;
      const content = str(todo.content);
      if (!content) return;
      const status = todo.status === 'in_progress' || todo.status === 'completed' ? todo.status : 'pending';
      const prev = p.source === 'TodoWrite' ? p.tasks.find((t) => t.id === `todo-${i}`) : undefined;
      tasks.push({
        id: `todo-${i}`,
        text: cut(content),
        activeText: str(todo.activeForm) ? cut(String(todo.activeForm)) : null,
        status,
        owner: null,
        blockedBy: [],
        ownerAgentId: prev && prev.text === cut(content) ? prev.ownerAgentId : null,
        ownerLabel: prev && prev.text === cut(content) ? prev.ownerLabel : null,
      });
    });
    return { ...p, tasks, source: 'TodoWrite', metaTitle: null };
  } catch {
    return p;
  }
}

/** The podium plan tool names the plan. */
export function setTitle(p: PlanState, input: unknown): PlanState {
  if (!isObj(input)) return p;
  const title = str(input.title);
  const phase = str(input.phase);
  if (!title) return p;
  return { ...p, toolTitle: cut(phase ? `${title} · ${phase}` : title) };
}

export interface OwnerCandidate {
  id: string;
  name: string | null;
  description: string;
  running: boolean;
  label: string;
}

/** Lowercase, letters and digits only. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Matches each step to the agent that owns it: TaskUpdate.owner equal to an agent name, else a running
 * agent whose normalized description equals or contains the step text (or the other way round).
 * A match sticks once made, so a step keeps its owner after the agent finishes.
 */
export function assignOwners(p: PlanState, agents: readonly OwnerCandidate[]): PlanState {
  let changed = false;
  const tasks = p.tasks.map((t) => {
    let match: OwnerCandidate | undefined;
    if (t.owner) match = agents.find((a) => a.name && a.name === t.owner);
    if (!match && !t.ownerAgentId) {
      const st = normalize(t.text);
      if (st) {
        match = agents.find((a) => {
          if (!a.running) return false;
          const d = normalize(a.description);
          return !!d && (d === st || d.includes(st) || st.includes(d));
        });
      }
    }
    if (match && (match.id !== t.ownerAgentId || match.label !== t.ownerLabel)) {
      changed = true;
      return { ...t, ownerAgentId: match.id, ownerLabel: match.label };
    }
    if (t.ownerAgentId) {
      const still = agents.find((a) => a.id === t.ownerAgentId);
      if (still && still.label !== t.ownerLabel) {
        changed = true;
        return { ...t, ownerLabel: still.label };
      }
    }
    return t;
  });
  return changed ? { ...p, tasks } : p;
}

/** The plan as the Report carries it; null when there are no tasks. */
export function toPlan(p: PlanState): Plan | null {
  if (!p.tasks.length) return null;
  const done = new Set(p.tasks.filter((t) => t.status === 'completed').map((t) => t.id));
  const known = new Set(p.tasks.map((t) => t.id));
  const steps: PlanStep[] = p.tasks.slice(0, 100).map((t) => {
    let state: PlanStep['state'] = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : 'pending';
    if (state === 'pending' && t.blockedBy.some((b) => known.has(b) && !done.has(b))) state = 'blocked';
    return { id: t.id, text: t.text, state, activeText: t.activeText, ownerAgentId: t.ownerAgentId, ownerLabel: t.ownerLabel };
  });
  // `source` names where the steps came from; the plan tool only names the plan, so it never changes it.
  return { title: p.toolTitle ?? p.metaTitle ?? null, source: p.source ?? 'TaskCreate', steps };
}
