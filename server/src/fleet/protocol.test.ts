import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateReport, LIMITS } from './protocol.js';
import { loadFixture, REPO_ROOT as repo } from './testing.js';

const here = path.join(repo, 'server', 'src', 'fleet');

function protocolBlock(file: string): string {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('// <protocol:begin>');
  const end = text.indexOf('// <protocol:end>');
  if (start < 0 || end < 0) throw new Error(`protocol markers missing in ${file}`);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

describe('protocol', () => {
  it('server and mod declare identical Report types', () => {
    const server = protocolBlock(path.join(here, 'protocol.ts'));
    const mod = protocolBlock(path.join(repo, 'mod', 'podium-reporter', 'hooks', 'protocol.ts'));
    expect(mod).toBe(server);
  });

  it('accepts the shared fixture', () => {
    const r = validateReport(loadFixture());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.agents).toHaveLength(4);
    expect(r.report.events).toHaveLength(3);
    expect(r.report.session.plan?.steps.map((s) => s.state).sort()).toEqual(['active', 'blocked', 'done', 'pending']);
  });

  it('fixture covers the required cases', () => {
    const f = loadFixture() as { session: { status: string }; agents: { kind: string; status: string; failure: unknown; blowouts: number }[] };
    expect(f.session.status).toBe('running');
    expect(f.agents.some((a) => a.kind === 'subagent' && a.status === 'done')).toBe(true);
    expect(f.agents.some((a) => a.kind === 'fork' && a.status === 'running')).toBe(true);
    expect(f.agents.some((a) => a.status === 'failed' && a.failure)).toBe(true);
    expect(f.agents.some((a) => a.blowouts === 2)).toBe(true);
  });

  it('rejects a missing v', () => {
    const f = loadFixture();
    delete f.v;
    expect(validateReport(f)).toMatchObject({ ok: false, path: '$.v' });
  });

  it('rejects v: 2', () => {
    expect(validateReport({ ...loadFixture(), v: 2 })).toMatchObject({ ok: false, path: '$.v' });
  });

  it('rejects a non-array agents', () => {
    expect(validateReport({ ...loadFixture(), agents: {} })).toMatchObject({ ok: false, path: '$.agents' });
  });

  it('rejects an agent with an unknown status', () => {
    const f = loadFixture() as { agents: Record<string, unknown>[] };
    f.agents[1]!.status = 'sleeping';
    expect(validateReport(f)).toMatchObject({ ok: false, path: '$.agents[1].status' });
  });

  it('clamps a 600-char event text instead of rejecting it', () => {
    const f = loadFixture() as { events: Record<string, unknown>[] };
    f.events[0]!.text = 'x'.repeat(600);
    const r = validateReport(f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.events[0]!.text).toHaveLength(LIMITS.text);
  });

  it('rejects 201 agents', () => {
    const f = loadFixture() as { agents: Record<string, unknown>[] };
    const a = f.agents[0]!;
    f.agents = Array.from({ length: 201 }, (_, i) => ({ ...a, id: `x${i}` }));
    expect(validateReport(f)).toMatchObject({ ok: false, path: '$.agents' });
  });

  it('accepts exactly 200 agents', () => {
    const f = loadFixture() as { agents: Record<string, unknown>[] };
    const a = f.agents[0]!;
    f.agents = Array.from({ length: 200 }, (_, i) => ({ ...a, id: `x${i}` }));
    expect(validateReport(f).ok).toBe(true);
  });

  it('rejects a non-object body', () => {
    for (const body of [null, 'report', 42, [], undefined]) {
      expect(validateReport(body)).toMatchObject({ ok: false, path: '$' });
    }
  });

  it('rejects more than 100 events and 100 plan steps', () => {
    const f = loadFixture() as { events: Record<string, unknown>[]; session: { plan: { steps: Record<string, unknown>[] } } };
    const e = f.events[0]!;
    expect(validateReport({ ...f, events: Array.from({ length: 101 }, (_, i) => ({ ...e, id: `e${i}` })) })).toMatchObject({ ok: false, path: '$.events' });
    const g = loadFixture() as typeof f;
    const s = g.session.plan.steps[0]!;
    g.session.plan.steps = Array.from({ length: 101 }, (_, i) => ({ ...s, id: `s${i}` }));
    expect(validateReport(g)).toMatchObject({ ok: false, path: '$.session.plan.steps' });
  });

  it('keeps line breaks in the full prompt and answer, strips other control characters, and clamps them', () => {
    const f = loadFixture() as { agents: Record<string, unknown>[] };
    f.agents[0]!.promptText = '# Task\n\n- one\u0000\n- two';
    f.agents[0]!.answerText = 'y'.repeat(30_000);
    const r = validateReport(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.agents[0]!.promptText).toBe('# Task\n\n- one \n- two');
    expect(r.report.agents[0]!.answerText).toHaveLength(LIMITS.fullText);
    expect('promptText' in r.report.agents[1]!).toBe(false);
  });

  it('rejects a full text that is not a string', () => {
    const f = loadFixture() as { agents: Record<string, unknown>[] };
    f.agents[0]!.promptText = 42;
    expect(validateReport(f).ok).toBe(false);
  });

  it('clamps names, excerpts and output lines and strips control characters', () => {
    const f = loadFixture() as { session: Record<string, unknown>; agents: Record<string, unknown>[] };
    f.session.name = 'n'.repeat(200);
    f.agents[0]!.promptExcerpt = 'p'.repeat(900);
    f.agents[0]!.description = 'evil\u0000\u001b[31mred\nline';
    const failure = f.agents[2]!.failure as Record<string, unknown>;
    failure.outputTail = Array.from({ length: 30 }, (_, i) => `line ${i} ` + 'y'.repeat(400));
    failure.evidence = ['1', '2', '3', '4', '5', '6', '7'];
    const r = validateReport(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.session.name).toHaveLength(LIMITS.name);
    expect(r.report.agents[0]!.promptExcerpt).toHaveLength(LIMITS.excerpt);
    expect(r.report.agents[0]!.description).toBe('evil  [31mred line');
    const tail = r.report.agents[2]!.failure!.outputTail;
    expect(tail).toHaveLength(12);
    expect(tail[11]!.startsWith('line 29')).toBe(true);
    expect(tail.every((l) => l.length <= LIMITS.line)).toBe(true);
    expect(r.report.agents[2]!.failure!.evidence).toHaveLength(5);
  });

  it('treats a missing optional field as null and drops unknown fields', () => {
    const f = loadFixture() as { session: Record<string, unknown> } & Record<string, unknown>;
    delete f.session.waitNote;
    f.extra = { anything: true };
    const r = validateReport(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.session.waitNote).toBeNull();
    expect('extra' in r.report).toBe(false);
  });

  it('rejects wrong types with a path', () => {
    const f = loadFixture() as { session: Record<string, unknown> };
    f.session.startedAt = 'yesterday';
    expect(validateReport(f)).toMatchObject({ ok: false, path: '$.session.startedAt' });
  });

  describe('usageByModel (issue #117)', () => {
    const row = { model: 'claude-sonnet-5-5', tier: 'std', tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 20, cacheWrite1h: 0 } };
    const withUsage = (v: unknown, where: 'session' | 'agent' = 'session') => {
      const f = loadFixture() as { session: Record<string, unknown>; agents: Record<string, unknown>[] };
      (where === 'session' ? f.session : f.agents[0]!).usageByModel = v;
      return f;
    };

    it('is absent when an older reporter does not send it', () => {
      const f = loadFixture() as { session: Record<string, unknown>; agents: Record<string, unknown>[] };
      delete f.session.usageByModel;
      for (const a of f.agents) delete a.usageByModel;
      const r = validateReport(f);
      expect(r.ok && 'usageByModel' in r.report.session).toBe(false);
      expect(r.ok && 'usageByModel' in r.report.agents[0]!).toBe(false);
    });

    it('keeps a valid list on the session and on an agent', () => {
      const s = validateReport(withUsage([row]));
      expect(s.ok && s.report.session.usageByModel).toEqual([row]);
      const a = validateReport(withUsage([{ ...row, tier: 'long' }], 'agent'));
      expect(a.ok && a.report.agents[0]!.usageByModel).toEqual([{ ...row, tier: 'long' }]);
    });

    it('treats a missing cacheWrite1h as 0 (a reporter that cannot split cache writes)', () => {
      const { cacheWrite1h: _drop, ...tokens } = row.tokens;
      const r = validateReport(withUsage([{ ...row, tokens }]));
      expect(r.ok && r.report.session.usageByModel![0]!.tokens.cacheWrite1h).toBe(0);
    });

    it.each([
      ['not an array', 'x', '$.session.usageByModel'],
      ['a bad tier', [{ ...row, tier: 'huge' }], '$.session.usageByModel[0].tier'],
      ['a negative count', [{ ...row, tokens: { ...row.tokens, input: -1 } }], '$.session.usageByModel[0].tokens.input'],
      ['no model', [{ ...row, model: undefined }], '$.session.usageByModel[0].model'],
    ])('rejects %s with a path', (_n, bad, path) => {
      expect(validateReport(withUsage(bad))).toMatchObject({ ok: false, path });
    });

    it('rejects more rows than the limit', () => {
      expect(validateReport(withUsage(Array.from({ length: LIMITS.usageModels + 1 }, () => row)))).toMatchObject({ ok: false });
    });
  });

  describe('toolCounts', () => {
    const first = (f: unknown) => (f as { agents: Record<string, unknown>[] }).agents[0]!;
    const counts = (r: ReturnType<typeof validateReport>) => (r.ok ? r.report.agents[0]!.toolCounts : 'rejected');

    it('keeps the counts the fixture carries', () => {
      expect(counts(validateReport(loadFixture()))).toEqual({ Grep: 14, Read: 11, Glob: 6 });
    });

    it('treats a missing field, from an older reporter, as null', () => {
      const f = loadFixture();
      delete first(f).toolCounts;
      expect(counts(validateReport(f))).toBeNull();
    });

    it('rejects a non-object and a negative or non-numeric count, with a path', () => {
      for (const bad of ['Bash', [1], { Bash: -1 }, { Bash: 'many' }]) {
        const f = loadFixture();
        first(f).toolCounts = bad;
        expect(validateReport(f)).toMatchObject({ ok: false });
      }
      const f = loadFixture();
      first(f).toolCounts = { Bash: -1 };
      expect(validateReport(f)).toMatchObject({ path: '$.agents[0].toolCounts.Bash' });
    });

    it('clips long names, strips control characters and rounds counts', () => {
      const f = loadFixture();
      first(f).toolCounts = { ['x'.repeat(300)]: 2, 'a\u0001b': 3.4 };
      expect(counts(validateReport(f))).toEqual({ ['x'.repeat(LIMITS.short)]: 2, 'a b': 3 });
    });

    it('keeps the most used names when there are more than the cap, ties by name', () => {
      const f = loadFixture();
      const many: Record<string, number> = {};
      for (let i = 0; i < LIMITS.toolNames + 5; i++) many[`t${String(i).padStart(3, '0')}`] = 1;
      many.big = 50;
      first(f).toolCounts = many;
      const out = counts(validateReport(f)) as Record<string, number>;
      expect(Object.keys(out)).toHaveLength(LIMITS.toolNames);
      expect(out.big).toBe(50);
      expect(out.t000).toBe(1);
      expect(out[`t${String(LIMITS.toolNames + 4).padStart(3, '0')}`]).toBeUndefined();
    });
  });

  describe('session.loop', () => {
    const sess = (f: unknown) => (f as { session: Record<string, unknown> }).session;
    const loopOf = (r: ReturnType<typeof validateReport>) =>
      r.ok ? (r.report.session as unknown as { loop: unknown }).loop : 'rejected';
    const sample = () => ({
      skills: ['frontend-design'],
      lastTool: 'Edit',
      toolCalls: 5,
      toolCounts: { Edit: 3, Read: 2 },
      steps: { done: 7, total: null },
    });

    it('keeps the main loop block the fixture carries', () => {
      expect(loopOf(validateReport(loadFixture()))).toMatchObject({ toolCounts: expect.any(Object), steps: { total: null } });
    });

    it('treats a missing block, from an older reporter, as null', () => {
      const f = loadFixture();
      delete sess(f).loop;
      expect(loopOf(validateReport(f))).toBeNull();
    });

    it('accepts the same field shapes an agent entry uses', () => {
      const f = loadFixture();
      sess(f).loop = sample();
      expect(loopOf(validateReport(f))).toEqual(sample());
    });

    it('clips and caps names, skills and counts like an agent entry', () => {
      const f = loadFixture();
      sess(f).loop = { ...sample(), toolCounts: { ['x'.repeat(300)]: 2 }, skills: ['s'.repeat(300)] };
      const out = loopOf(validateReport(f)) as { toolCounts: Record<string, number>; skills: string[] };
      expect(out.toolCounts).toEqual({ ['x'.repeat(LIMITS.short)]: 2 });
      expect(out.skills).toEqual(['s'.repeat(LIMITS.short)]);
    });

    it('rejects a block with no steps rather than reading it as zero', () => {
      const f = loadFixture();
      sess(f).loop = { ...sample(), steps: undefined };
      expect(validateReport(f)).toMatchObject({ ok: false, path: '$.session.loop.steps' });
    });

    it('rejects a malformed block with a path', () => {
      const f = loadFixture();
      sess(f).loop = { ...sample(), toolCounts: { Bash: -1 } };
      expect(validateReport(f)).toMatchObject({ ok: false, path: '$.session.loop.toolCounts.Bash' });
    });
  });
  describe('session.files', () => {
    const sess = (f: unknown) => (f as { session: Record<string, unknown> }).session;
    const filesOf = (r: ReturnType<typeof validateReport>) =>
      r.ok ? (r.report.session as unknown as { files: { files: { path: string }[]; total: number; added: number; removed: number; since: string } | null }).files : 'rejected';
    const entry = (over: Record<string, unknown> = {}) => ({ path: 'src/a.ts', status: 'modified', added: 3, removed: 1, from: null, ...over });
    const block = (over: Record<string, unknown> = {}) => ({ files: [entry()], total: 1, added: 3, removed: 1, since: 'start', ...over });

    it('keeps the files block the fixture carries', () => {
      expect(filesOf(validateReport(loadFixture()))).toMatchObject({ total: 4, added: 85, removed: 119, since: 'start' });
    });

    it('treats a missing block, from an older reporter, as null', () => {
      const f = loadFixture();
      delete sess(f).files;
      expect(filesOf(validateReport(f))).toBeNull();
    });

    it('accepts binary files with null counts, and a rename with its old path', () => {
      const f = loadFixture();
      sess(f).files = block({ files: [entry({ path: 'a.png', added: null, removed: null }), entry({ path: 'b.ts', status: 'renamed', from: 'a.ts' })], total: 2 });
      expect(filesOf(validateReport(f))).toMatchObject({ files: [{ path: 'a.png', added: null }, { path: 'b.ts', from: 'a.ts' }] });
    });

    it('clips paths and strips control characters', () => {
      const f = loadFixture();
      sess(f).files = block({ files: [entry({ path: 'x/' + 'y'.repeat(2000) }), entry({ path: 'a\u0007b\nc' })] });
      const out = filesOf(validateReport(f)) as { files: { path: string }[] };
      expect(out.files[0]!.path.length).toBe(LIMITS.filePath);
      expect(out.files[1]!.path).toBe('a b c');
    });

    it('rounds a fractional count like every other count', () => {
      const f = loadFixture();
      sess(f).files = block({ files: [entry({ removed: 1.4 })] });
      expect(filesOf(validateReport(f))).toMatchObject({ files: [{ removed: 1 }] });
    });

    it('keeps the first 200 files and never lets total fall below what is listed', () => {
      const f = loadFixture();
      const many = Array.from({ length: LIMITS.files + 40 }, (_, i) => entry({ path: `f${i}.ts` }));
      sess(f).files = block({ files: many, total: 3 });
      const out = filesOf(validateReport(f)) as { files: unknown[]; total: number };
      expect(out.files).toHaveLength(LIMITS.files);
      expect(out.total).toBe(LIMITS.files);
    });

    it.each([
      ['a negative count', { files: [entry({ added: -1 })] }, '$.session.files.files[0].added'],
      ['an unknown status', { files: [entry({ status: 'moved' })] }, '$.session.files.files[0].status'],
      ['a missing path', { files: [entry({ path: undefined })] }, '$.session.files.files[0].path'],
      ['a negative total', { total: -2 }, '$.session.files.total'],
      ['an unknown since', { since: 'yesterday' }, '$.session.files.since'],
      ['files that are not an array', { files: 'a.ts' }, '$.session.files.files'],
    ])('rejects %s with a path', (_n, over, at) => {
      const f = loadFixture();
      sess(f).files = block(over as Record<string, unknown>);
      expect(validateReport(f)).toMatchObject({ ok: false, path: at });
    });
  });
  describe('session.attached', () => {
    const sess = (f: unknown) => (f as { session: Record<string, unknown> }).session;
    const attachedOf = (r: ReturnType<typeof validateReport>) => (r.ok ? (r.report.session as unknown as { attached: boolean | null }).attached : 'rejected');

    it('keeps true and false as sent', () => {
      const f = loadFixture();
      sess(f).attached = false;
      expect(attachedOf(validateReport(f))).toBe(false);
      sess(f).attached = true;
      expect(attachedOf(validateReport(f))).toBe(true);
    });

    it('treats a missing field, from an older reporter, as null', () => {
      const f = loadFixture();
      delete sess(f).attached;
      expect(attachedOf(validateReport(f))).toBeNull();
    });

    it('rejects a value that is not a boolean, with a path', () => {
      const f = loadFixture();
      sess(f).attached = 'yes';
      expect(validateReport(f)).toMatchObject({ ok: false, path: '$.session.attached' });
    });
  });
  describe('owner and machine', () => {
    const top = (f: unknown) => f as Record<string, unknown>;
    const ok = (r: ReturnType<typeof validateReport>) => {
      if (!r.ok) throw new Error(`rejected at ${r.path}: ${r.error}`);
      return r.report;
    };

    it('leaves both out for an older or unnamed reporter', () => {
      const r = ok(validateReport(loadFixture()));
      expect(r.userName).toBeUndefined();
      expect(r.machine).toBeUndefined();
    });

    it('keeps a name and a machine, clamped and stripped of control characters', () => {
      const f = top(loadFixture());
      f.userName = `Ed\u0007 E.${'x'.repeat(200)}`;
      f.machine = { name: `  eds-mbp\n${'y'.repeat(100)}`, id: 'a1b2c3d4' };
      const r = ok(validateReport(f));
      expect(r.userName).toHaveLength(LIMITS.name);
      expect(r.userName?.startsWith('Ed  E.')).toBe(true);
      expect(r.machine?.name).toHaveLength(LIMITS.machineName - 2);
      expect(r.machine?.name.startsWith('eds-mbp ')).toBe(true);
      expect(r.machine?.id).toBe('a1b2c3d4');
    });

    it('treats a null machine as none', () => {
      const f = top(loadFixture());
      f.machine = null;
      expect(ok(validateReport(f)).machine).toBeUndefined();
    });

    it.each([
      ['a string', 'eds-mbp', '$.machine'],
      ['a missing name', { id: 'abcd' }, '$.machine.name'],
      ['a blank name', { name: '   ', id: 'abcd' }, '$.machine.name'],
      ['a missing id', { name: 'eds-mbp' }, '$.machine.id'],
      ['an id with markup', { name: 'eds-mbp', id: '<b>x</b>' }, '$.machine.id'],
      ['an id over 32 characters', { name: 'eds-mbp', id: 'a'.repeat(33) }, '$.machine.id'],
      ['a non-string name', { name: 7, id: 'abcd' }, '$.machine.name'],
    ])('rejects %s, with a path', (_label, machine, at) => {
      const f = top(loadFixture());
      f.machine = machine;
      expect(validateReport(f)).toMatchObject({ ok: false, path: at });
    });

    it('rejects a userName that is not a string', () => {
      const f = top(loadFixture());
      f.userName = 42;
      expect(validateReport(f)).toMatchObject({ ok: false, path: '$.userName' });
    });
  });

  describe('background wait (#119)', () => {
    const bg = { tasks: [{ type: 'shell', description: 'nightly build', status: 'running' }], wakeAt: null };
    const withBg = (background: unknown) => {
      const f = loadFixture();
      return { ...(f as object), session: { ...(f as { session: object }).session, background } };
    };
    it('accepts a report that says what the session waits on', () => {
      const r = validateReport(withBg(bg));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.report.session.background).toEqual(bg);
    });
    it('treats a report without the field, or with null, as no background work', () => {
      expect(validateReport(loadFixture()).ok).toBe(true);
      const r = validateReport(withBg(null));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.report.session.background ?? null).toBeNull();
    });
    it('rejects an unknown task type', () => {
      expect(validateReport(withBg({ ...bg, tasks: [{ ...bg.tasks[0], type: 'cron' }] }))).toMatchObject({ ok: false, path: '$.session.background.tasks[0].type' });
    });
    it('rejects more tasks than the limit', () => {
      const tasks = Array.from({ length: LIMITS.backgroundTasks + 1 }, () => bg.tasks[0]);
      expect(validateReport(withBg({ ...bg, tasks }))).toMatchObject({ ok: false, path: '$.session.background.tasks' });
    });
    it('clamps a long description instead of rejecting it', () => {
      const r = validateReport(withBg({ ...bg, tasks: [{ ...bg.tasks[0], description: 'x'.repeat(500) }] }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.report.session.background!.tasks[0]!.description.length).toBeLessThanOrEqual(LIMITS.backgroundDescription);
    });
    it('rejects a wake-up time that is not a number', () => {
      expect(validateReport(withBg({ ...bg, wakeAt: 'soon' }))).toMatchObject({ ok: false, path: '$.session.background.wakeAt' });
    });
  });

  describe('activity feed (#118)', () => {
    const entry = { at: 1_800_000_000_000, kind: 'tool', text: 'Read docs/SPEC.md' };
    const withActivity = (session: Record<string, unknown>, agent: Record<string, unknown> = {}) => {
      const f = loadFixture() as { session: Record<string, unknown>; agents: Record<string, unknown>[] };
      Object.assign(f.session, session);
      Object.assign(f.agents[0]!, agent);
      return f;
    };
    it('accepts the option flag and entries on the session and on an agent', () => {
      const r = validateReport(withActivity({ activityFeed: true, activity: [entry] }, { activity: [{ ...entry, kind: 'text', text: 'Next, the tests.' }] }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.report.session.activityFeed).toBe(true);
      expect(r.report.session.activity).toEqual([entry]);
      expect(r.report.agents[0]!.activity).toEqual([{ ...entry, kind: 'text', text: 'Next, the tests.' }]);
    });
    it('leaves both out for a reporter that sends neither', () => {
      const r = validateReport(loadFixture());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect('activityFeed' in r.report.session).toBe(false);
      expect('activity' in r.report.session).toBe(false);
      expect('activity' in r.report.agents[0]!).toBe(false);
    });
    it('accepts the reserved reasoning kind and rejects an unknown one', () => {
      expect(validateReport(withActivity({ activity: [{ ...entry, kind: 'reasoning' }] })).ok).toBe(true);
      expect(validateReport(withActivity({ activity: [{ ...entry, kind: 'thinking' }] }))).toMatchObject({ ok: false, path: '$.session.activity[0].kind' });
    });
    it('rejects more entries than a loop keeps', () => {
      const many = Array.from({ length: LIMITS.activityEntries + 1 }, () => entry);
      expect(validateReport(withActivity({}, { activity: many }))).toMatchObject({ ok: false, path: '$.agents[0].activity' });
    });
    it('cuts a long entry and strips control characters instead of rejecting it', () => {
      const r = validateReport(withActivity({ activity: [{ ...entry, text: `a\u0007b${'x'.repeat(900)}` }] }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const t = r.report.session.activity![0]!.text;
      expect(t).toHaveLength(LIMITS.activityText);
      expect(t.startsWith('a b')).toBe(true);
    });
    it('rejects a flag that is not a boolean', () => {
      expect(validateReport(withActivity({ activityFeed: 'yes' }))).toMatchObject({ ok: false, path: '$.session.activityFeed' });
    });
    it('drops the entries past the per-report budget rather than the report', () => {
      const full = Array.from({ length: LIMITS.activityEntries }, (_, i) => ({ ...entry, at: entry.at + i, text: 'y'.repeat(LIMITS.activityText) }));
      const f = loadFixture() as { session: Record<string, unknown>; agents: Record<string, unknown>[] };
      f.session.activity = full;
      const base = f.agents[0]!;
      f.agents = Array.from({ length: 20 }, (_, i) => ({ ...base, id: `x${i}`, activity: full }));
      const r = validateReport(f);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const chars = [r.report.session.activity ?? [], ...r.report.agents.map((a) => a.activity ?? [])].flat().reduce((n, e) => n + e.text.length, 0);
      expect(chars).toBeLessThanOrEqual(LIMITS.activityChars);
      expect(r.report.session.activity).toHaveLength(LIMITS.activityEntries);
      expect(r.report.agents.at(-1)!.activity).toBeUndefined();
    });
  });
});
