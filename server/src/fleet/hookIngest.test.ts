import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { createFleetRouter } from './routes.js';
import { fixtureReport } from './testing.js';

// Payloads as Claude Code's settings hooks receive them on stdin (BaseHookInput + the event's fields,
// from the engine's ClassicHookInputs declarations).
const base = { session_id: 'hk-1', transcript_path: '/Users/dev/.claude/projects/x/hk-1.jsonl', cwd: '/Users/dev/billing-service', permission_mode: 'default' };
const P = {
  start: { ...base, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-sonnet-5-5', effort: { level: 'high' } },
  prompt: { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'do it' },
  subStart: { ...base, hook_event_name: 'SubagentStart', agent_id: 'ag-1', agent_type: 'Explore', effort: { level: 'low' } },
  tool: { ...base, hook_event_name: 'PostToolUse', agent_id: 'ag-1', agent_type: 'Explore', tool_name: 'Grep', tool_input: {}, tool_response: {}, tool_use_id: 'tu' },
  subStop: { ...base, hook_event_name: 'SubagentStop', agent_id: 'ag-1', agent_type: 'Explore', stop_hook_active: false, agent_transcript_path: '/x', last_assistant_message: 'secret answer text' },
  notify: { ...base, hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' },
  stop: { ...base, hook_event_name: 'Stop', stop_hook_active: false },
  end: { ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' },
};

function setup(token: string | null = null) {
  let now = 1_800_000_000_000;
  const fleet = new Fleet(new FleetDb(openDb(':memory:')), { ...DEFAULT_CONFIG, home: '/Users/dev', dbPath: ':memory:' }, () => now);
  const app = express();
  app.use('/api/fleet', createFleetRouter(fleet, { token, log: () => {} }));
  return { app, fleet, tick: (ms: number) => (now += ms) };
}

describe('POST /api/fleet/hook', () => {
  it('builds a reduced session from SessionStart, SubagentStart/Stop, Notification and SessionEnd', async () => {
    const { app, fleet, tick } = setup();
    const send = async (p: object) => {
      tick(1000);
      const res = await request(app).post('/api/fleet/hook').send(p);
      expect(res.status).toBe(200);
    };
    await send(P.start);
    let v = fleet.view('hk-1')!;
    expect(v).toMatchObject({ reporter: 'hooks', name: 'billing-service', project: '~/billing-service', status: 'waiting', model: 'claude-sonnet-5-5', effort: 'high', costUsd: null, plan: null, reporterVersion: null, compat: 'unknown' });
    expect(v.context).toEqual({ tokens: null, window: null, percent: null });
    await send(P.prompt);
    expect(fleet.view('hk-1')!.status).toBe('running');
    await send(P.subStart);
    await send(P.tool);
    v = fleet.view('hk-1')!;
    expect(v.agents).toHaveLength(1);
    expect(v.agents[0]).toMatchObject({ id: 'ag-1', type: 'Explore', status: 'running', effort: 'low', lastTool: 'Grep', toolCalls: 1, toolCounts: { Grep: 1 } });
    await send(P.subStop);
    v = fleet.view('hk-1')!;
    expect(v.agents[0]!.status).toBe('done');
    // the last message is not taken: hooks send no excerpts
    expect(JSON.stringify(v)).not.toContain('secret answer text');
    await send(P.notify);
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'permission', waitNote: 'Claude needs your permission to use Bash' });
    await send(P.prompt);
    await send(P.stop);
    expect(fleet.view('hk-1')!.status).toBe('waiting');
    await send(P.end);
    expect(fleet.view('hk-1')).toMatchObject({ status: 'done', endReason: 'prompt_input_exit' });
    const kinds = fleet.events({ sessionId: 'hk-1', limit: 50 }).map((e) => e.kind).reverse();
    expect(kinds).toEqual(['start', 'spawn', 'done', 'wait', 'end']);
    fleet.close();
  });

  it('a repeated payload does not duplicate events; junk gets a 400; the token is required when set', async () => {
    const { app, fleet } = setup('tok');
    expect((await request(app).post('/api/fleet/hook').send(P.start)).status).toBe(401);
    const ok = await request(app).post('/api/fleet/hook').set('X-Podium-Token', 'tok').send(P.start);
    expect(ok.body).toEqual({ ok: true, sessionId: 'hk-1' });
    await request(app).post('/api/fleet/hook').set('X-Podium-Token', 'tok').send(P.start);
    expect(fleet.events({ sessionId: 'hk-1', limit: 10 })).toHaveLength(1);
    for (const bad of [{}, { hook_event_name: 'Stop' }, { session_id: 'x' }, { ...P.subStart, agent_id: undefined }]) {
      const res = await request(app).post('/api/fleet/hook').set('X-Podium-Token', 'tok').send(bad);
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    }
    expect((await request(app).post('/api/fleet/hook').set('X-Podium-Token', 'tok').set('Content-Type', 'application/json').send('{oops')).status).toBe(400);
    fleet.close();
  });

  it('an unknown hook event is a heartbeat that keeps the session live', async () => {
    const { app, fleet, tick } = setup();
    await request(app).post('/api/fleet/hook').send(P.start);
    tick(14_000);
    await request(app).post('/api/fleet/hook').send({ ...base, hook_event_name: 'CwdChanged' });
    tick(14_000);
    expect(fleet.view('hk-1')!.status).toBe('waiting');
    fleet.close();
  });

  // ---- code-review fixes ----------------------------------------------------------------------

  it('SubagentStop while the main loop is still working does not flip the session to waiting', async () => {
    const { app, fleet, tick } = setup();
    const send = async (p: object) => {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    };
    await send(P.start);
    await send(P.prompt);
    await send(P.subStart);
    await send(P.subStop);
    expect(fleet.view('hk-1')).toMatchObject({ status: 'running', waitReason: null });
    // only the Stop hook means the main loop is idle
    await send(P.stop);
    expect(fleet.view('hk-1')!.status).toBe('waiting');
    fleet.close();
  });

  it('a hook for a session the mod reports leaves the mod\'s cost, plan, tokens and reporter alone', async () => {
    const { app, fleet, tick } = setup();
    const r = fixtureReport();
    fleet.ingest({ ...r, sentAt: fleet.now() });
    const before = fleet.view(r.session.id)!;
    expect(before.reporter).toBe('mod');
    expect(before.costUsd).not.toBeNull();
    expect(before.plan).not.toBeNull();
    tick(1000);
    const res = await request(app).post('/api/fleet/hook').send({ ...base, session_id: r.session.id, hook_event_name: 'SubagentStop', agent_id: 'zz', agent_type: 'Explore' });
    expect(res.status).toBe(200);
    const after = fleet.view(r.session.id)!;
    expect(after.reporter).toBe('mod');
    expect(after.costUsd).toBe(before.costUsd);
    expect(after.plan).toEqual(before.plan);
    expect(after.tokensTotal).toBe(before.tokensTotal);
    expect(after.blowouts.total).toBe(before.blowouts.total);
    expect(after.agents.map((a) => a.id)).toEqual(before.agents.map((a) => a.id));
    fleet.close();
  });

  it('a hook-only session has no heartbeat: it stays live through a long silent turn, then goes stale and is dropped on the hook windows', async () => {
    const { app, fleet, tick } = setup();
    await request(app).post('/api/fleet/hook').send(P.start);
    await request(app).post('/api/fleet/hook').send(P.prompt);
    // 5 minutes with no hook firing (a long model turn): still shown as running, not stale, not dropped
    for (let i = 0; i < 300; i++) {
      tick(1000);
      fleet.sweep();
    }
    expect(fleet.isLive('hk-1')).toBe(true);
    expect(fleet.view('hk-1')!.status).toBe('running');
    // past the hook window (default 10 minutes) it goes stale, and is dropped a drop-window later
    for (let i = 0; i < 301; i++) {
      tick(1000);
      fleet.sweep();
    }
    expect(fleet.view('hk-1')!.status).toBe('stale');
    expect(fleet.isLive('hk-1')).toBe(true);
    for (let i = 0; i < 61; i++) {
      tick(1000);
      fleet.sweep();
    }
    expect(fleet.isLive('hk-1')).toBe(false);
    fleet.close();
  });

  it('only notifications that block on the person put the session in waiting', async () => {
    const { app, fleet, tick } = setup();
    const send = async (p: object) => {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    };
    await send(P.start);
    await send(P.prompt);
    await send({ ...base, hook_event_name: 'Notification', message: 'Signed in', notification_type: 'auth_success' });
    expect(fleet.view('hk-1')).toMatchObject({ status: 'running', waitNote: null });
    await send({ ...base, hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' });
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'input' });
    await send(P.prompt);
    await send({ ...base, hook_event_name: 'Notification', message: 'Pick one', notification_type: 'elicitation_dialog' });
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'input' });
    await send(P.prompt);
    await send(P.notify);
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'permission' });
    fleet.close();
  });

  it('two different hooks in the same millisecond both keep their activity event', async () => {
    const { app, fleet } = setup();
    await request(app).post('/api/fleet/hook').send(P.start);
    await request(app).post('/api/fleet/hook').send({ ...P.notify, message: 'first ask' });
    await request(app).post('/api/fleet/hook').send({ ...P.notify, message: 'second ask' });
    await request(app).post('/api/fleet/hook').send({ ...P.subStart, agent_id: 'ag-a' });
    await request(app).post('/api/fleet/hook').send({ ...P.subStart, agent_id: 'ag-b' });
    const texts = fleet.events({ sessionId: 'hk-1', limit: 20 }).map((e) => e.text);
    expect(texts.filter((t) => t.includes('first ask'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('second ask'))).toHaveLength(1);
    expect(texts.filter((t) => t.startsWith('spawned'))).toHaveLength(2);
    // the very same payload retried in the same instant is still one event
    await request(app).post('/api/fleet/hook').send({ ...P.notify, message: 'first ask' });
    expect(fleet.events({ sessionId: 'hk-1', limit: 20 }).filter((e) => e.text.includes('first ask'))).toHaveLength(1);
    fleet.close();
  });

  // A turn that ends with a background shell running is not waiting on the person (#119).
  it('a Stop with a background shell in flight is a background wait, not "input"', async () => {
    const { app, fleet, tick } = setup();
    const send = async (p: object) => {
      tick(1000);
      expect((await request(app).post('/api/fleet/hook').send(p)).status).toBe(200);
    };
    await send(P.start);
    await send(P.prompt);
    await send({ ...P.stop, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'nightly build', command: 'curl -H "Authorization: Bearer sk-live-123" https://x' }], session_crons: [] });
    const v = fleet.view('hk-1')!;
    expect(v.status).toBe('waiting');
    expect(v.waitReason).toBeNull();
    expect(v.background).toEqual({ tasks: [{ type: 'shell', description: 'nightly build', status: 'running' }], wakeAt: null });
    expect(JSON.stringify(v)).not.toContain('sk-live-123');
    // the next prompt starts a turn, and the work is no longer what it waits on
    await send(P.prompt);
    expect(fleet.view('hk-1')!.background ?? null).toBeNull();
    // a Stop with nothing in flight is a wait on the person again
    await send(P.stop);
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'input' });
    expect(fleet.view('hk-1')!.background ?? null).toBeNull();
  });

  it('a Stop that lists only a finished task is still a wait on the person', async () => {
    const { app, fleet, tick } = setup();
    for (const p of [P.start, P.prompt, { ...P.stop, background_tasks: [{ id: 'b1', type: 'shell', status: 'completed', description: 'done' }] }]) {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    }
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'input' });
  });

  it('a Stop that lists only artifact live-update watchers is still a wait on the person (#128)', async () => {
    const { app, fleet, tick } = setup();
    const watchers = Array.from({ length: 10 }, (_, n) => ({ id: `w${n}`, type: 'monitor', status: 'running', description: `live updates for artifact https://claude.ai/artifact/abc${n} (re-armed on session resume)` }));
    for (const p of [P.start, P.prompt, { ...P.stop, background_tasks: watchers }]) {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    }
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: 'input' });
    expect(fleet.view('hk-1')!.background ?? null).toBeNull();
  });

  it('a Stop with only a scheduled wake-up is a background wait', async () => {
    const { app, fleet, tick } = setup();
    for (const p of [P.start, P.prompt, { ...P.stop, background_tasks: [], session_crons: [{ id: 'c1', schedule: '30 14 * * *', recurring: false, prompt: 'check the deploy' }] }]) {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    }
    const v = fleet.view('hk-1')!;
    expect(v.waitReason).toBeNull();
    expect(v.background!.tasks).toMatchObject([{ type: 'wakeup', description: 'check the deploy' }]);
  });

  it('never names a background task by an inline NAME=value secret, and does not repeat a feed row for an unchanged Stop', async () => {
    const { app, fleet, tick } = setup();
    const stop = { ...P.stop, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: '', command: 'API_KEY=sk-live-123 /usr/bin/node build.js' }] };
    for (const p of [P.start, P.prompt, stop, stop]) {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    }
    const v = fleet.view('hk-1')!;
    expect(v.background!.tasks[0]!.description).toBe('node');
    expect(JSON.stringify(v)).not.toContain('sk-live-123');
    expect(fleet.events({ sessionId: 'hk-1', limit: 50 }).filter((e) => e.text.startsWith('waiting on background')).length).toBe(1);
  });

  it('an idle-prompt Notification while background work is in flight is not a wait on the person', async () => {
    const { app, fleet, tick } = setup();
    const stop = { ...P.stop, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'nightly build' }] };
    for (const p of [P.start, P.prompt, stop, { ...base, hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }]) {
      tick(1000);
      await request(app).post('/api/fleet/hook').send(p);
    }
    expect(fleet.view('hk-1')).toMatchObject({ status: 'waiting', waitReason: null });
    expect(fleet.view('hk-1')!.background).not.toBeNull();
  });
});
