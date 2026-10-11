import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openDb, FleetDb } from './db.js';
import { DEFAULT_CONFIG, Fleet } from './fleet.js';
import { createFleetRouter } from './routes.js';

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
    expect(v).toMatchObject({ reporter: 'hooks', name: 'billing-service', project: '~/billing-service', status: 'waiting', model: 'claude-sonnet-5-5', effort: 'high', costUsd: null, plan: null });
    expect(v.context).toEqual({ tokens: null, window: null, percent: null });
    await send(P.prompt);
    expect(fleet.view('hk-1')!.status).toBe('running');
    await send(P.subStart);
    await send(P.tool);
    v = fleet.view('hk-1')!;
    expect(v.agents).toHaveLength(1);
    expect(v.agents[0]).toMatchObject({ id: 'ag-1', type: 'Explore', status: 'running', effort: 'low', lastTool: 'Grep', toolCalls: 1 });
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
});
