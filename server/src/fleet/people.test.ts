import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from './db.js';
import { PeopleStore, PeopleError } from './people.js';
import { tokenMatches } from './tokens.js';

let store: PeopleStore;
beforeEach(() => {
  store = new PeopleStore(openDb(':memory:'));
});

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof PeopleError ? e.code : 'other';
  }
}

describe('people', () => {
  it('creates a person, returns the token once and keeps only its hash', () => {
    const { person, token } = store.createPerson('Dana');
    expect(person.name).toBe('Dana');
    expect(token).toMatch(/^pdm_/);
    const raw = JSON.stringify(store.db.prepare('SELECT * FROM people').all());
    expect(raw).not.toContain(token);
    // Not even its tail: only the hash is stored (#277).
    expect(raw).not.toContain(token.slice(-8));
    expect(Object.keys(store.db.prepare('SELECT * FROM people').get() as object)).not.toContain('token_last4');
    const found = store.findByKeyId(person.keyId)!;
    expect(tokenMatches(token, found.tokenHash)).toBe(true);
  });

  it('keeps names unique ignoring case, and rejects empty, long or control-character names', () => {
    store.createPerson('Dana');
    expect(code(() => store.createPerson('dana'))).toBe('duplicate');
    expect(code(() => store.createPerson('  '))).toBe('invalid');
    expect(code(() => store.createPerson('x'.repeat(49)))).toBe('invalid');
    expect(code(() => store.createPerson('bad\nname'))).toBe('invalid');
  });

  it('reserves the name Admin, which is the owner of reports made with the admin secret', () => {
    expect(code(() => store.createPerson('Admin'))).toBe('invalid');
    expect(code(() => store.createPerson(' aDMIN '))).toBe('invalid');
  });

  it('rotating replaces the token and the old one stops matching', () => {
    const a = store.createPerson('Dana');
    const r = store.rotate(a.person.id)!;
    expect(r.token).not.toBe(a.token);
    const found = store.findByKeyId(r.person.keyId)!;
    expect(tokenMatches(r.token, found.tokenHash)).toBe(true);
    expect(tokenMatches(a.token, found.tokenHash)).toBe(false);
    expect(store.findByKeyId(a.person.keyId)).toBeUndefined();
  });

  it('revoking marks the person revoked and a rotation brings them back', () => {
    const a = store.createPerson('Dana');
    store.revoke(a.person.id);
    expect(store.findByKeyId(a.person.keyId)!.revokedAt).not.toBeNull();
    const r = store.rotate(a.person.id)!;
    expect(store.findByKeyId(r.person.keyId)!.revokedAt).toBeNull();
  });

  it('pages on the server, searches by name, group and machine, and reports the total', () => {
    const g = store.createGroup('Backend');
    for (let i = 0; i < 125; i++) store.createPerson(`person-${String(i).padStart(3, '0')}`);
    const p = store.findByName('person-007')!;
    store.setGroup(p.id, g.id);
    store.touch(store.findByName('person-042')!.id, 'laptop-x', 1000);
    const first = store.list({ page: 1, pageSize: 50, q: '' });
    expect(first.total).toBe(125);
    expect(first.rows).toHaveLength(50);
    expect(store.list({ page: 3, pageSize: 50, q: '' }).rows).toHaveLength(25);
    expect(store.list({ page: 1, pageSize: 500, q: '' }).rows).toHaveLength(100);
    expect(store.list({ page: 1, pageSize: 50, q: 'person-042' }).total).toBe(1);
    expect(store.list({ page: 1, pageSize: 50, q: 'backend' }).rows.map((r) => r.name)).toEqual(['person-007']);
    expect(store.list({ page: 1, pageSize: 50, q: 'laptop-x' }).rows.map((r) => r.name)).toEqual(['person-042']);
    expect(store.list({ page: 1, pageSize: 50, q: '%' }).total).toBe(0);
  });

  it('records the last report and the machines it came from', () => {
    const a = store.createPerson('Dana');
    store.touch(a.person.id, 'm1', 100);
    store.touch(a.person.id, 'm2', 200);
    store.touch(a.person.id, 'm1', 300);
    const row = store.list({ page: 1, pageSize: 50, q: '' }).rows[0]!;
    expect(row.lastReportAt).toBe(300);
    expect(row.machines.sort()).toEqual(['m1', 'm2']);
  });
});

describe('groups', () => {
  it('creates unique groups of 1 to 24 characters and assigns one per person', () => {
    const g = store.createGroup('Frontend');
    expect(code(() => store.createGroup('frontend'))).toBe('duplicate');
    expect(code(() => store.createGroup(''))).toBe('invalid');
    expect(code(() => store.createGroup('x'.repeat(25)))).toBe('invalid');
    const a = store.createPerson('Dana');
    expect(store.setGroup(a.person.id, g.id)).toBe(true);
    expect(store.setGroup(a.person.id, 999)).toBe(false);
    expect(store.listGroups({ page: 1, pageSize: 50 }).rows.find((r) => r.name === 'Frontend')).toMatchObject({ members: ['Dana'], builtIn: false });
  });

  it('deleting a group returns its people to no group and keeps them', () => {
    const g = store.createGroup('Ops');
    const a = store.createPerson('Dana', g.id);
    expect(store.deleteGroup(g.id)).toBe(true);
    expect(store.list({ page: 1, pageSize: 50, q: '' }).rows[0]).toMatchObject({ name: 'Dana', groupId: null });
    expect(a.person.name).toBe('Dana');
  });
});

describe('settings and the admin log', () => {
  it('defaults admin-secret reporting to on and remembers the switch', () => {
    expect(store.adminReportingAllowed()).toBe(true);
    store.setAdminReporting(false);
    expect(store.adminReportingAllowed()).toBe(false);
  });

  it('logs entries newest first, paged, and keeps the source address', () => {
    for (let i = 0; i < 60; i++) store.log('unlock', `n${i}`, '10.0.0.1', i);
    const p1 = store.listLog({ page: 1, pageSize: 50 });
    expect(p1.total).toBe(60);
    expect(p1.rows).toHaveLength(50);
    expect(p1.rows[0]).toMatchObject({ detail: 'n59', source: '10.0.0.1' });
  });
});
