import { describe, test, expect } from 'claude-code/testing'
import { assignOwners, emptyPlan, normalize, setTitle, taskCreate, taskUpdate, todoWrite, toPlan } from './plan.ts'

const create = (p = emptyPlan, id: string, subject: string, extra: Record<string, unknown> = {}) =>
  taskCreate(p, { subject, description: subject, ...extra }, { result: { task: { id, subject } } })

describe('plan', () => {
  test('TaskCreate adds steps with the id from the result and the active form', () => {
    let p = create(emptyPlan, '1', 'Map call sites', { activeForm: 'Mapping call sites', metadata: { planTitle: 'Migrate invoices' } })
    p = create(p, '2', 'Port endpoints')
    const plan = toPlan(p)!
    expect(plan.title).toBe('Migrate invoices')
    expect(plan.source).toBe('TaskCreate')
    expect(plan.steps.map((s) => [s.id, s.text, s.state, s.activeText])).toEqual([
      ['1', 'Map call sites', 'pending', 'Mapping call sites'],
      ['2', 'Port endpoints', 'pending', null],
    ])
  })

  test('the title comes from metadata.title too, and only from the first TaskCreate', () => {
    let p = create(emptyPlan, '1', 'a', { metadata: { title: 'First title' } })
    p = create(p, '2', 'b', { metadata: { title: 'Later title' } })
    expect(toPlan(p)!.title).toBe('First title')
    expect(toPlan(create(emptyPlan, '1', 'a'))!.title).toBeNull()
  })

  test('TaskUpdate maps every status, and deleted removes the step', () => {
    let p = create(create(create(emptyPlan, '1', 'a'), '2', 'b'), '3', 'c')
    p = taskUpdate(p, { taskId: '1', status: 'in_progress' })
    p = taskUpdate(p, { taskId: '2', status: 'completed' })
    p = taskUpdate(p, { taskId: '3', status: 'pending' })
    expect(toPlan(p)!.steps.map((s) => s.state)).toEqual(['active', 'done', 'pending'])
    p = taskUpdate(p, { taskId: '2', status: 'deleted' })
    expect(toPlan(p)!.steps.map((s) => s.id)).toEqual(['1', '3'])
  })

  test('TaskUpdate applies subject, activeForm, owner; a failed update changes nothing', () => {
    let p = create(emptyPlan, '1', 'a')
    p = taskUpdate(p, { taskId: '1', subject: 'renamed', activeForm: 'renaming', owner: 'scout' })
    expect(p.tasks[0]).toMatchObject({ text: 'renamed', activeText: 'renaming', owner: 'scout' })
    const same = taskUpdate(p, { taskId: '1', subject: 'nope' }, { result: { success: false, taskId: '1', updatedFields: [] } })
    expect(same.tasks[0]!.text).toBe('renamed')
  })

  test('addBlockedBy and addBlocks make unfinished blockers block a pending step', () => {
    let p = create(create(create(emptyPlan, '1', 'a'), '2', 'b'), '3', 'c')
    p = taskUpdate(p, { taskId: '2', addBlockedBy: ['1'] })
    p = taskUpdate(p, { taskId: '1', addBlocks: ['3'] })
    expect(toPlan(p)!.steps.map((s) => s.state)).toEqual(['pending', 'blocked', 'blocked'])
    p = taskUpdate(p, { taskId: '3', status: 'in_progress' })
    expect(toPlan(p)!.steps[2]!.state).toBe('active')
    p = taskUpdate(p, { taskId: '1', status: 'completed' })
    expect(toPlan(p)!.steps.map((s) => s.state)).toEqual(['done', 'pending', 'active'])
  })

  test('TodoWrite replaces the list with todo-<index> ids and wins as source', () => {
    let p = create(emptyPlan, '1', 'a', { metadata: { title: 'T' } })
    p = todoWrite(p, { todos: [{ content: 'one', status: 'completed', activeForm: 'Doing one' }, { content: 'two', status: 'in_progress', activeForm: 'Doing two' }, { content: 'three', status: 'pending', activeForm: '' }] })
    const plan = toPlan(p)!
    expect(plan.source).toBe('TodoWrite')
    expect(plan.title).toBeNull()
    expect(plan.steps.map((s) => [s.id, s.text, s.state])).toEqual([['todo-0', 'one', 'done'], ['todo-1', 'two', 'active'], ['todo-2', 'three', 'pending']])
    // a later TaskCreate wins again
    expect(toPlan(create(p, '9', 'z'))!.source).toBe('TaskCreate')
  })

  test('the plan tool sets the title, with the phase', () => {
    const p = setTitle(create(emptyPlan, '1', 'a', { metadata: { title: 'meta' } }), { title: 'Cut latency', phase: 'phase 2' })
    expect(toPlan(p)!.title).toBe('Cut latency · phase 2')
  })

  test('owner: TaskUpdate.owner matching a name, else a running agent by normalized description, sticky', () => {
    let p = create(create(emptyPlan, '1', 'Port invoice endpoints'), '2', 'Write rollout notes')
    p = taskUpdate(p, { taskId: '2', owner: 'writer' })
    const agents = [
      { id: 'a1', name: null, description: 'port INVOICE endpoints!', running: true, label: 'fork · Opus xhigh' },
      { id: 'a2', name: 'writer', description: 'docs', running: false, label: 'general-purpose · Haiku low' },
    ]
    p = assignOwners(p, agents)
    expect(toPlan(p)!.steps.map((s) => [s.ownerAgentId, s.ownerLabel])).toEqual([['a1', 'fork · Opus xhigh'], ['a2', 'general-purpose · Haiku low']])
    const later = assignOwners(p, [{ ...agents[0]!, running: false }, agents[1]!])
    expect(later.tasks[0]!.ownerAgentId).toBe('a1')
    expect(toPlan(assignOwners(create(emptyPlan, '1', 'Unrelated step'), agents))!.steps[0]!.ownerAgentId).toBeNull()
    expect(normalize('A-b c!')).toBe('abc')
  })

  test('no tasks means no plan', () => {
    expect(toPlan(emptyPlan)).toBeNull()
  })

  test('malformed input is ignored and never throws', () => {
    const p = create(emptyPlan, '1', 'a')
    for (const bad of [null, 42, 'x', [], { taskId: 7 }, { subject: 5 }, { todos: 'no' }, { todos: [null, { content: 3 }] }]) {
      expect(taskCreate(p, bad, null)).toBe(p)
      expect(taskUpdate(p, bad)).toBe(p)
      expect(() => todoWrite(p, bad)).not.toThrow()
      expect(setTitle(p, bad)).toBe(p)
    }
    expect(taskCreate(p, { subject: 'b' }, { result: {} })).toBe(p)
    expect(taskUpdate(p, { taskId: 'missing', status: 'completed' })).toBe(p)
  })
})
