// People, their tokens, groups, the admin log and server settings (issue #36). All statements are parameterized.
// A token is returned once, at creation or rotation, and never stored; see tokens.ts.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { newPersonToken } from './tokens.js';

export type PeopleErrorCode = 'duplicate' | 'invalid' | 'not_found';
export class PeopleError extends Error {
  constructor(readonly code: PeopleErrorCode, message: string) {
    super(message);
  }
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
/** The owner of a session reported with the admin secret. */
export const ADMIN_OWNER = 'Admin';
const NAME_MAX = 48;
const GROUP_MAX = 24;

export interface PersonRow {
  id: number;
  name: string;
  keyId: string;
  tokenHash: string;
  last4: string;
  groupId: number | null;
  createdAt: number;
  rotatedAt: number | null;
  revokedAt: number | null;
  lastReportAt: number | null;
}
export interface PersonListRow extends Omit<PersonRow, 'tokenHash' | 'keyId'> {
  groupName: string | null;
  machines: string[];
}
export interface GroupListRow {
  id: number;
  name: string;
  createdAt: number;
  members: string[];
}
export interface LogRow {
  id: number;
  t: number;
  kind: string;
  detail: string;
  source: string;
}
export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}
interface PageIn {
  page: number;
  pageSize: number;
}

/** Page and size clamped to what the Admin API allows. */
export function clampPage(p: Partial<PageIn>): PageIn {
  const size = Math.trunc(Number(p.pageSize));
  const page = Math.trunc(Number(p.page));
  return {
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 1_000_000) : 1,
    pageSize: Number.isFinite(size) && size >= 1 ? Math.min(size, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
  };
}

/** A name as it is compared: spaces collapsed, case ignored. */
export const nameKey = (raw: string): string => raw.trim().replace(/ +/g, ' ').toLowerCase();

/** A request's source address without the IPv4-mapped IPv6 prefix. */
export const sourceAddress = (ip: string | undefined): string => (ip ?? 'unknown').replace(/^::ffff:/, '');

function cleanName(raw: string, max: number, what: string): string {
  const name = raw.trim().replace(/ +/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (name.length < 1 || name.length > max || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new PeopleError('invalid', `${what} must be 1 to ${max} characters, with no control characters`);
  }
  return name;
}

/** Escapes LIKE wildcards so a search for `%` finds a literal percent sign and not everything. */
export function likeTerm(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

interface DbPerson {
  id: number;
  name: string;
  key_id: string;
  token_hash: string;
  token_last4: string;
  group_id: number | null;
  created_at: number;
  rotated_at: number | null;
  revoked_at: number | null;
  last_report_at: number | null;
}
const toPerson = (r: DbPerson): PersonRow => ({
  id: r.id,
  name: r.name,
  keyId: r.key_id,
  tokenHash: r.token_hash,
  last4: r.token_last4,
  groupId: r.group_id,
  createdAt: r.created_at,
  rotatedAt: r.rotated_at,
  revokedAt: r.revoked_at,
  lastReportAt: r.last_report_at,
});

export class PeopleStore {
  private readonly stmts = new Map<string, StatementSync>();
  constructor(readonly db: DatabaseSync) {}

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  // ---- people ---------------------------------------------------------------------------------

  createPerson(rawName: string, groupId: number | null = null, now = Date.now()): { person: PersonRow; token: string } {
    const name = cleanName(rawName, NAME_MAX, 'A name');
    // 'Admin' is the owner the server gives a report made with the admin secret; a person of that name would share it.
    if (name.toLowerCase() === ADMIN_OWNER.toLowerCase()) throw new PeopleError('invalid', `${ADMIN_OWNER} is reserved for the admin secret`);
    if (this.findByName(name)) throw new PeopleError('duplicate', 'That name is already taken');
    if (groupId !== null && !this.stmt('SELECT 1 AS x FROM groups WHERE id = ?').get(groupId)) {
      throw new PeopleError('not_found', 'That group does not exist');
    }
    const t = newPersonToken();
    const r = this.stmt(
      `INSERT INTO people (name, name_lower, key_id, token_hash, token_last4, group_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(name, name.toLowerCase(), t.keyId, t.hash, t.last4, groupId, now);
    return { person: this.getPerson(Number(r.lastInsertRowid))!, token: t.token };
  }

  getPerson(id: number): PersonRow | undefined {
    const r = this.stmt('SELECT * FROM people WHERE id = ?').get(id) as DbPerson | undefined;
    return r && toPerson(r);
  }

  findByKeyId(keyId: string): PersonRow | undefined {
    const r = this.stmt('SELECT * FROM people WHERE key_id = ?').get(keyId) as DbPerson | undefined;
    return r && toPerson(r);
  }

  findByName(name: string): PersonRow | undefined {
    const r = this.stmt('SELECT * FROM people WHERE name_lower = ?').get(nameKey(name)) as
      | DbPerson
      | undefined;
    return r && toPerson(r);
  }

  /** New token for a person; the old one stops working and a revoked person is restored. Null if no such person. */
  rotate(id: number, now = Date.now()): { person: PersonRow; token: string } | null {
    if (!this.getPerson(id)) return null;
    const t = newPersonToken();
    this.stmt(
      'UPDATE people SET key_id = ?, token_hash = ?, token_last4 = ?, rotated_at = ?, revoked_at = NULL WHERE id = ?',
    ).run(t.keyId, t.hash, t.last4, now, id);
    return { person: this.getPerson(id)!, token: t.token };
  }

  revoke(id: number, now = Date.now()): boolean {
    return Number(this.stmt('UPDATE people SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id).changes) > 0;
  }

  /** Records a report from a person: the time and the machine it came from. */
  touch(personId: number, machine: string | null, now: number): void {
    this.stmt('UPDATE people SET last_report_at = ? WHERE id = ?').run(now, personId);
    if (machine) {
      this.stmt(
        `INSERT INTO person_machines (person_id, machine, last_seen_at) VALUES (?, ?, ?)
         ON CONFLICT(person_id, machine) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      ).run(personId, machine.slice(0, 120), now);
    }
  }

  setGroup(personId: number, groupId: number | null): boolean {
    if (!this.getPerson(personId)) return false;
    if (groupId !== null && !this.stmt('SELECT 1 AS x FROM groups WHERE id = ?').get(groupId)) return false;
    this.stmt('UPDATE people SET group_id = ? WHERE id = ?').run(groupId, personId);
    return true;
  }

  list(opts: Partial<PageIn> & { q?: string }): Paged<PersonListRow> {
    const { page, pageSize } = clampPage(opts);
    const q = (opts.q ?? '').trim().slice(0, 100);
    const where = q
      ? `WHERE p.name_lower LIKE :like ESCAPE '\\' OR lower(COALESCE(g.name, '')) LIKE :like ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM person_machines m WHERE m.person_id = p.id AND lower(m.machine) LIKE :like ESCAPE '\\')`
      : '';
    const params: Record<string, string | number> = q ? { like: likeTerm(q) } : {};
    const total = (
      this.stmt(`SELECT COUNT(*) AS n FROM people p LEFT JOIN groups g ON g.id = p.group_id ${where}`).get(params) as { n: number }
    ).n;
    const rows = this.stmt(
      `SELECT p.*, g.name AS group_name FROM people p LEFT JOIN groups g ON g.id = p.group_id ${where}
       ORDER BY p.name_lower LIMIT :limit OFFSET :offset`,
    ).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as unknown as (DbPerson & { group_name: string | null })[];
    // One query for the whole page's machines, not one per row.
    const machines = new Map<number, string[]>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const found = this.db
        .prepare(`SELECT person_id, machine FROM person_machines WHERE person_id IN (${ids.map(() => '?').join(',')}) ORDER BY machine`)
        .all(...ids) as { person_id: number; machine: string }[];
      for (const m of found) (machines.get(m.person_id) ?? machines.set(m.person_id, []).get(m.person_id)!).push(m.machine);
    }
    return {
      total,
      page,
      pageSize,
      rows: rows.map((r) => {
        const { tokenHash: _h, keyId: _k, ...rest } = toPerson(r);
        void _h;
        void _k;
        return { ...rest, groupName: r.group_name, machines: machines.get(r.id) ?? [] };
      }),
    };
  }

  // ---- groups ---------------------------------------------------------------------------------

  createGroup(rawName: string, now = Date.now()): { id: number; name: string } {
    const name = cleanName(rawName, GROUP_MAX, 'A group name');
    if (this.stmt('SELECT 1 AS x FROM groups WHERE name_lower = ?').get(name.toLowerCase())) {
      throw new PeopleError('duplicate', 'That group already exists');
    }
    const r = this.stmt('INSERT INTO groups (name, name_lower, created_at) VALUES (?, ?, ?)').run(name, name.toLowerCase(), now);
    return { id: Number(r.lastInsertRowid), name };
  }

  getGroup(id: number): { id: number; name: string } | undefined {
    return this.stmt('SELECT id, name FROM groups WHERE id = ?').get(id) as { id: number; name: string } | undefined;
  }

  /** Deletes a group. Its people stay and move to no group (ON DELETE SET NULL). */
  deleteGroup(id: number): boolean {
    return Number(this.stmt('DELETE FROM groups WHERE id = ?').run(id).changes) > 0;
  }

  listGroups(opts: Partial<PageIn>): Paged<GroupListRow> {
    const { page, pageSize } = clampPage(opts);
    const total = (this.stmt('SELECT COUNT(*) AS n FROM groups').get() as { n: number }).n;
    const rows = this.stmt('SELECT id, name, created_at FROM groups ORDER BY name_lower LIMIT ? OFFSET ?').all(
      pageSize,
      (page - 1) * pageSize,
    ) as unknown as { id: number; name: string; created_at: number }[];
    const members = new Map<number, string[]>();
    if (rows.length) {
      const ids = rows.map((g) => g.id);
      const found = this.db
        .prepare(`SELECT group_id, name FROM people WHERE group_id IN (${ids.map(() => '?').join(',')}) ORDER BY name_lower`)
        .all(...ids) as { group_id: number; name: string }[];
      for (const m of found) (members.get(m.group_id) ?? members.set(m.group_id, []).get(m.group_id)!).push(m.name);
    }
    return {
      total,
      page,
      pageSize,
      rows: rows.map((g) => ({ id: g.id, name: g.name, createdAt: g.created_at, members: members.get(g.id) ?? [] })),
    };
  }

  /** Every group, for the pick list on the People tab (groups are few; people are paged). */
  allGroups(): { id: number; name: string }[] {
    return this.stmt('SELECT id, name FROM groups ORDER BY name_lower').all() as unknown as { id: number; name: string }[];
  }

  // ---- settings and log -----------------------------------------------------------------------

  adminReportingAllowed(): boolean {
    const r = this.stmt("SELECT value FROM settings WHERE key = 'allow_admin_secret_reporting'").get() as { value: string } | undefined;
    return r ? r.value === '1' : true;
  }

  setAdminReporting(on: boolean): void {
    this.stmt(
      `INSERT INTO settings (key, value) VALUES ('allow_admin_secret_reporting', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(on ? '1' : '0');
  }

  /** Never pass a token or the admin secret in `detail`. */
  log(kind: string, detail: string, source: string, now = Date.now()): void {
    this.stmt('INSERT INTO admin_log (t, kind, detail, source) VALUES (?, ?, ?, ?)').run(
      now,
      kind.slice(0, 40),
      detail.slice(0, 300),
      source.slice(0, 80),
    );
  }

  listLog(opts: Partial<PageIn>): Paged<LogRow> {
    const { page, pageSize } = clampPage(opts);
    const total = (this.stmt('SELECT COUNT(*) AS n FROM admin_log').get() as { n: number }).n;
    const rows = this.stmt('SELECT id, t, kind, detail, source FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?').all(
      pageSize,
      (page - 1) * pageSize,
    ) as unknown as LogRow[];
    return { total, page, pageSize, rows };
  }
}
