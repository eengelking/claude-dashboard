import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, FleetDb, type SessionRow } from './db.js';

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1', name: 'demo', status: 'running', wait_reason: null, wait_note: null, end_reason: null, resume_id: null,
    started_at: 1000, last_seen_at: 2000, ended_at: null, dropped_at: null, cwd: '/tmp/demo', project_root: null,
    repo_name: null, git_json: null, model: 'opus', effort: 'high', context_tokens: null, context_window: null,
    context_percent: null, cost_usd: 1.5, tok_in: 0, tok_out: 0, tok_cr: 0, tok_cw: 0, rate_limits_json: null,
    blowouts: 0, plan_json: null, reporter_version: '0.1.0', engine_version: null, loop_json: null,
    ...over,
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('openDb', () => {
  it('creates the schema and records the migration', () => {
    const db = openDb(':memory:');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['agents', 'blowouts', 'events', 'samples', 'schema_migrations', 'sessions']));
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    db.close();
  });

  it('migrates a version 1 database forward and keeps its agent rows, with no tool counts', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'podium-db-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'podium.sqlite');
    const a = new FleetDb(openDb(file));
    a.upsertSession(session());
    a.close();
    const old = openDb(file);
    old.exec('INSERT INTO agents (session_id, id, kind, type, description, status, started_at, tool_calls) VALUES (\'s1\', \'a\', \'subagent\', \'x\', \'d\', \'done\', 1, 7)');
    old.exec('ALTER TABLE agents DROP COLUMN tool_counts_json');
    old.exec('ALTER TABLE sessions DROP COLUMN loop_json');
    old.exec('DELETE FROM schema_migrations WHERE version >= 2');
    old.close();
    const db = openDb(file);
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(db.prepare("SELECT tool_calls, tool_counts_json FROM agents WHERE id = 'a'").get()).toEqual({ tool_calls: 7, tool_counts_json: null });
    expect(db.prepare("SELECT name, loop_json FROM sessions WHERE id = 's1'").get()).toEqual({ name: 'demo', loop_json: null });
    db.close();
  });

  it('is idempotent on an existing file and turns WAL on', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'podium-db-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'nested', 'podium.sqlite');
    const a = new FleetDb(openDb(file));
    a.upsertSession(session());
    a.close();
    const db = openDb(file);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT name FROM sessions').all()).toEqual([{ name: 'demo' }]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it('stores hostile strings as data, never as SQL', () => {
    const f = new FleetDb(openDb(':memory:'));
    const evil = "'); DROP TABLE sessions;--";
    f.upsertSession(session({ name: evil, id: evil }));
    f.insertEvent({ id: evil, session_id: evil, agent_id: null, t: 1, kind: 'note', text: evil, data_json: null });
    expect(f.getSession(evil)?.name).toBe(evil);
    expect(f.listEvents({ sessionId: evil, limit: 10 })[0]?.text).toBe(evil);
    const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('sessions');
    f.close();
  });

  it('upserts sessions, ignores duplicate events and deletes a session with its rows', () => {
    const f = new FleetDb(openDb(':memory:'));
    f.upsertSession(session());
    f.upsertSession(session({ name: 'renamed' }));
    expect(f.getSession('s1')?.name).toBe('renamed');
    const ev = { id: 'e1', session_id: 's1', agent_id: null, t: 5, kind: 'note', text: 'x', data_json: null };
    expect(f.insertEvent(ev)).toBe(true);
    expect(f.insertEvent(ev)).toBe(false);
    f.insertBlowout({ session_id: 's1', agent_id: 'a', t: 5, kind: 'auto-compact', tokens_before: 1, tokens_after: 0 });
    f.insertBlowout({ session_id: 's1', agent_id: 'a', t: 5, kind: 'auto-compact', tokens_before: 1, tokens_after: 0 });
    expect(f.countBlowouts('s1')).toBe(1);
    expect(f.deleteSession('s1')).toBe(true);
    expect(f.getSession('s1')).toBeUndefined();
    expect(f.countEvents()).toBe(0);
    expect(f.deleteSession('s1')).toBe(false);
    f.close();
  });
});
