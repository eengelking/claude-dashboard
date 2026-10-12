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
});
