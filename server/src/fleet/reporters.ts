// Every podium-reporter the server has heard from (issue #142, SPEC 7.2 and 7.7). One row per machine, keyed on the
// machine id the reporter sends, or on its source address when it sends none. The table is not touched by
// retention, so a reporter outlives its sessions. A reporter that stops is "silent", which is all the server can
// know: it cannot tell a reporter that is turned off from one that cannot reach it. All statements are parameterized.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { checkReporter } from './compat.js';
import { clampPage, likeTerm, type Paged } from './people.js';
import type { ReporterCompat } from './protocol.js';

/** A reporter heard from within this long is "reporting". */
export const REPORTING_MS = 2 * 60_000;
/** Up to this long since its last report it is "idle"; after that, "silent". */
export const IDLE_MS = 60 * 60_000;
const MAX_REJECTED = 200;
const SHOWN_REJECTED = 20;
const SHOWN_SESSIONS = 10;

export type ReporterState = 'reporting' | 'idle' | 'silent' | 'restart';
export const REPORTER_STATES: readonly ReporterState[] = ['reporting', 'idle', 'silent', 'restart'];
export type ReporterSort = 'state' | 'name' | 'who' | 'ver' | 'last' | 'sessions';
const SORTS: readonly ReporterSort[] = ['state', 'name', 'who', 'ver', 'last', 'sessions'];

/** What one accepted report says about its sender. Never a token: `credential` is a key id or the words "admin secret". */
export interface ReporterSeen {
  kind: 'mod' | 'hooks';
  machineId: string | null;
  machineName: string | null;
  source: string | null;
  owner: string | null;
  credential: string | null;
  version: string;
  engineVersion: string | null;
  sessionId: string;
}

export interface ReporterRow {
  key: string;
  state: ReporterState;
  name: string;
  who: string;
  version: string;
  compat: ReporterCompat;
  firstSeenAt: number;
  lastSeenAt: number;
  sessions: number;
  live: number;
}
export interface ReporterList extends Paged<ReporterRow> {
  counts: Record<'all' | ReporterState, number>;
}
export interface ReporterDetail extends ReporterRow {
  kind: 'mod' | 'hooks';
  machineId: string | null;
  source: string | null;
  credential: string | null;
  engineVersion: string | null;
  recent: { id: string; name: string; status: string; lastSeenAt: number; costUsd: number | null }[];
  rejected: { t: number; reason: string }[];
}

interface DbReporter {
  key: string;
  kind: 'mod' | 'hooks';
  machine_id: string | null;
  machine_name: string | null;
  source_address: string | null;
  owner: string | null;
  credential: string | null;
  reporter_version: string;
  engine_version: string | null;
  first_seen_at: number;
  last_seen_at: number;
  state: ReporterState;
  sessions: number;
  live: number;
}

/** The state, in SQL, from the last report, the time the server started and now. */
const STATE_SQL = `CASE WHEN r.last_seen_at < :started THEN 'restart'
  WHEN :now - r.last_seen_at < ${REPORTING_MS} THEN 'reporting'
  WHEN :now - r.last_seen_at < ${IDLE_MS} THEN 'idle' ELSE 'silent' END`;
const NAME_SQL = `COALESCE(r.machine_name, CASE r.kind WHEN 'hooks' THEN 'Hooks only' ELSE 'Unnamed reporter' END)`;
const SESSIONS_SQL = 'SELECT COUNT(*) FROM reporter_sessions x WHERE x.reporter_key = r.key';
const LIVE_SQL = `SELECT COUNT(*) FROM reporter_sessions x JOIN sessions s ON s.id = x.session_id
  WHERE x.reporter_key = r.key AND s.ended_at IS NULL AND s.dropped_at IS NULL`;
const ORDER: Record<ReporterSort, string> = {
  state: `CASE state WHEN 'reporting' THEN 0 WHEN 'idle' THEN 1 WHEN 'silent' THEN 2 ELSE 3 END`,
  name: `lower(${NAME_SQL.replace(/r\./g, 'q.')})`,
  who: `lower(COALESCE(q.owner, 'Unassigned'))`,
  ver: 'q.reporter_version',
  last: 'q.last_seen_at',
  sessions: 'q.sessions',
};

export class ReporterStore {
  private readonly stmts = new Map<string, StatementSync>();
  private rejections: { source: string; t: number; reason: string }[] = [];

  constructor(
    readonly db: DatabaseSync,
    /** When the server started: a reporter last heard before this has not reported since the restart. */
    private readonly startedAt: number,
  ) {}

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  /** The key a reporter is known by. */
  static keyOf(s: Pick<ReporterSeen, 'kind' | 'machineId' | 'source'>): string {
    if (s.machineId) return s.machineId;
    return `${s.kind === 'hooks' ? 'hooks' : 'addr'}:${s.source ?? 'unknown'}`;
  }

  /** Notes one accepted report: creates the reporter or updates it, and links the session. */
  record(s: ReporterSeen, now: number): void {
    const key = ReporterStore.keyOf(s);
    this.stmt(
      `INSERT INTO reporters (key, kind, machine_id, machine_name, source_address, owner, credential, reporter_version, engine_version, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, machine_name = excluded.machine_name, source_address = excluded.source_address,
         owner = excluded.owner, credential = excluded.credential, reporter_version = excluded.reporter_version,
         engine_version = excluded.engine_version, last_seen_at = excluded.last_seen_at`,
    ).run(
      key,
      s.kind,
      s.machineId,
      s.machineName?.slice(0, 64) ?? null,
      s.source?.slice(0, 120) ?? null,
      s.owner,
      s.credential,
      s.version.slice(0, 64),
      s.engineVersion?.slice(0, 64) ?? null,
      now,
      now,
    );
    this.stmt('INSERT OR IGNORE INTO reporter_sessions (reporter_key, session_id) VALUES (?, ?)').run(key, s.sessionId);
  }

  /** Keeps a short, memory-only list of refused reports by source address, for the detail view. The reason is one of the server's own fixed phrases. */
  rejected(source: string | null, reason: string, now: number): void {
    if (!source) return;
    this.rejections.push({ source, t: now, reason: reason.slice(0, 200) });
    if (this.rejections.length > MAX_REJECTED) this.rejections.splice(0, this.rejections.length - MAX_REJECTED);
  }

  private toRow(r: DbReporter): ReporterRow {
    return {
      key: r.key,
      state: r.state,
      name: r.machine_name ?? (r.kind === 'hooks' ? 'Hooks only' : 'Unnamed reporter'),
      who: r.owner ?? 'Unassigned',
      version: r.reporter_version,
      compat: checkReporter(r.reporter_version),
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      sessions: r.sessions,
      live: r.live,
    };
  }

  list(opts: { page?: number; pageSize?: number; q?: string; state?: string; sort?: string; dir?: number }, now: number): ReporterList {
    const { page, pageSize } = clampPage(opts);
    const q = (opts.q ?? '').trim().slice(0, 100);
    const state = REPORTER_STATES.find((s) => s === opts.state);
    const sort = SORTS.find((s) => s === opts.sort) ?? 'last';
    const dir = opts.dir !== undefined ? (opts.dir > 0 ? 'ASC' : 'DESC') : sort === 'last' ? 'DESC' : 'ASC';
    const base = { now, started: this.startedAt };

    const counts: ReporterList['counts'] = { all: 0, reporting: 0, idle: 0, silent: 0, restart: 0 };
    for (const c of this.stmt(`SELECT ${STATE_SQL} AS state, COUNT(*) AS n FROM reporters r GROUP BY state`).all(base) as unknown as { state: ReporterState; n: number }[]) {
      counts[c.state] = c.n;
      counts.all += c.n;
    }

    const where: string[] = [];
    const params: Record<string, string | number> = { ...base };
    if (q) {
      where.push(`(lower(${NAME_SQL}) LIKE :like ESCAPE '\\' OR lower(COALESCE(r.owner, 'unassigned')) LIKE :like ESCAPE '\\'
        OR lower(COALESCE(r.source_address, '')) LIKE :like ESCAPE '\\' OR lower(COALESCE(r.machine_id, '')) LIKE :like ESCAPE '\\'
        OR lower(r.reporter_version) LIKE :like ESCAPE '\\')`);
      params.like = likeTerm(q);
    }
    const sub = `SELECT r.*, ${STATE_SQL} AS state, (${SESSIONS_SQL}) AS sessions, (${LIVE_SQL}) AS live FROM reporters r${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const filter = state ? ' WHERE q.state = :state' : '';
    if (state) params.state = state;
    const total = (this.stmt(`SELECT COUNT(*) AS n FROM (${sub}) q${filter}`).get(params) as { n: number }).n;
    const rows = this.stmt(`SELECT q.* FROM (${sub}) q${filter} ORDER BY ${ORDER[sort]} ${dir}, q.key LIMIT :limit OFFSET :offset`).all({
      ...params,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }) as unknown as DbReporter[];
    return { total, page, pageSize, rows: rows.map((r) => this.toRow(r)), counts };
  }

  get(key: string, now: number): ReporterDetail | undefined {
    const r = this.stmt(
      `SELECT r.*, ${STATE_SQL} AS state, (${SESSIONS_SQL}) AS sessions, (${LIVE_SQL}) AS live FROM reporters r WHERE r.key = :key`,
    ).get({ key, now, started: this.startedAt }) as unknown as DbReporter | undefined;
    if (!r) return undefined;
    const recent = this.stmt(
      `SELECT s.id, s.name, s.status, s.last_seen_at, s.cost_usd FROM reporter_sessions x JOIN sessions s ON s.id = x.session_id
       WHERE x.reporter_key = ? ORDER BY s.last_seen_at DESC LIMIT ${SHOWN_SESSIONS}`,
    ).all(key) as unknown as { id: string; name: string; status: string; last_seen_at: number; cost_usd: number | null }[];
    const rejected = r.source_address
      ? this.rejections
          .filter((x) => x.source === r.source_address)
          .slice(-SHOWN_REJECTED)
          .reverse()
          .map((x) => ({ t: x.t, reason: x.reason }))
      : [];
    return {
      ...this.toRow(r),
      kind: r.kind,
      machineId: r.machine_id,
      source: r.source_address,
      credential: r.credential,
      engineVersion: r.engine_version,
      recent: recent.map((s) => ({ id: s.id, name: s.name, status: s.status, lastSeenAt: s.last_seen_at, costUsd: s.cost_usd })),
      rejected,
    };
  }

  /** Takes a reporter off the list; it comes back if it reports again. Its sessions are not touched. */
  remove(key: string): boolean {
    return Number(this.stmt('DELETE FROM reporters WHERE key = ?').run(key).changes) > 0;
  }
}
