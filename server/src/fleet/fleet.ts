// The fleet service: owns the live set, turns ingests and timer sweeps into SSE messages, and
// answers the read endpoints. Storage is FleetDb; rules are in ingest.ts and derive.ts. The clock is
// injected so the lifecycle tests can move time without waiting.
import type { FleetDb, RetentionPolicy, SessionRow } from './db.js';
import { activityView, computeKpis, family, sessionStatus, sessionView, shortenHome, startOfDay, type DeriveConfig } from './derive.js';
import { ingestReport, type IngestResult } from './ingest.js';
import type { ActivityView, HistoryRow, Kpis, RemovedReason, Report, SessionStatusView, SessionView, StateBody } from './protocol.js';
import { formatSse, SseHub } from './sse.js';

export interface FleetConfig {
  staleAfterMs: number;
  dropAfterMs: number;
  lingerMs: number;
  retention: RetentionPolicy;
  home: string;
  /** Minimum gap between two `session` messages for one session. */
  throttleMs: number;
  dbPath: string;
}

export const DEFAULT_CONFIG: Omit<FleetConfig, 'home' | 'dbPath'> = {
  staleAfterMs: 15_000,
  dropAfterMs: 60_000,
  lingerMs: 8_000,
  retention: { samplesMs: 24 * 3600_000, eventsMs: 30 * 24 * 3600_000, sessionsMs: 30 * 24 * 3600_000 },
  throttleMs: 500,
};

function envMs(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Lifecycle and retention settings from the environment (SPEC 7.2, 7.5). */
export function configFromEnv(env: NodeJS.ProcessEnv, base: { home: string; dbPath: string }): FleetConfig {
  const d = DEFAULT_CONFIG;
  return {
    ...base,
    staleAfterMs: envMs(env, 'STALE_AFTER_MS', d.staleAfterMs),
    dropAfterMs: envMs(env, 'DROP_AFTER_MS', d.dropAfterMs),
    lingerMs: envMs(env, 'LINGER_MS', d.lingerMs),
    throttleMs: d.throttleMs,
    retention: {
      samplesMs: envMs(env, 'RETAIN_SAMPLES_MS', d.retention.samplesMs),
      eventsMs: envMs(env, 'RETAIN_EVENTS_MS', d.retention.eventsMs),
      sessionsMs: envMs(env, 'RETAIN_SESSIONS_MS', d.retention.sessionsMs),
    },
  };
}

/** How many events /state returns and the UI keeps. */
export const STATE_EVENTS = 150;

interface LiveEntry {
  /** Reported since this server process started. */
  heard: boolean;
  /** The status last broadcast, to notice stale transitions. */
  status: SessionStatusView | null;
}

export class Fleet {
  readonly hub = new SseHub();
  private readonly live = new Map<string, LiveEntry>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly startedAt: number;
  private readonly clockSkew = new Map<string, number>();
  private costMinuteCache: { at: number; rows: { m: number; v: number }[] } | null = null;

  constructor(
    readonly db: FleetDb,
    readonly cfg: FleetConfig,
    readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
    // On start every stored session that has not ended is treated as stale until it reports again;
    // a done session still inside its linger window stays until the window closes.
    for (const row of db.liveCandidates(this.startedAt - cfg.lingerMs)) {
      this.live.set(row.id, { heard: false, status: null });
    }
  }

  private get derive(): DeriveConfig {
    return { staleAfterMs: this.cfg.staleAfterMs, home: this.cfg.home };
  }

  isLive(id: string): boolean {
    return this.live.has(id);
  }

  liveIds(): string[] {
    return [...this.live.keys()];
  }

  // ---- ingest ---------------------------------------------------------------------------------

  ingest(report: Report): IngestResult {
    const res = ingestReport(this.db, report, this.now());
    this.clockSkew.set(res.sessionId, res.clockSkewMs);
    const entry = this.live.get(res.sessionId);
    if (entry) {
      entry.heard = true;
    } else if (!(res.ended && res.wasDone)) {
      // New, revived, or back after leaving the live set. A repeated final report for a session that
      // already left is stored but does not bring it back.
      this.live.set(res.sessionId, { heard: true, status: null });
    }
    const row = this.db.getSession(res.sessionId);
    for (const e of res.newEvents.slice().sort((a, b) => a.t - b.t)) {
      this.hub.broadcast('activity', activityView(e, row));
    }
    if (this.live.has(res.sessionId)) this.scheduleSession(res.sessionId);
    return res;
  }

  /** Coalesces `session` messages: at most one per session per throttle window, carrying the latest state. */
  private scheduleSession(id: string): void {
    if (this.pending.has(id)) return;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      const view = this.view(id);
      if (view && this.live.has(id)) {
        const entry = this.live.get(id);
        if (entry) entry.status = view.status;
        this.hub.broadcast('session', view);
      }
    }, this.cfg.throttleMs);
    timer.unref?.();
    this.pending.set(id, timer);
  }

  // ---- reads ----------------------------------------------------------------------------------

  /** One session's view, live or historical. */
  view(id: string): SessionView | undefined {
    const row = this.db.getSession(id);
    if (!row) return undefined;
    return this.viewOf(row);
  }

  private viewOf(row: SessionRow): SessionView {
    const now = this.now();
    const entry = this.live.get(row.id);
    return sessionView(
      {
        row,
        agents: this.db.getAgents(row.id),
        blowouts: this.db.getBlowouts(row.id),
        samples: this.db.samplesSince(row.id, Math.floor(now / 1000) - 61),
        heard: entry ? entry.heard : true,
      },
      now,
      this.derive,
    );
  }

  liveViews(): SessionView[] {
    const out: SessionView[] = [];
    for (const id of this.live.keys()) {
      const row = this.db.getSession(id);
      if (row) out.push(this.viewOf(row));
    }
    return out;
  }

  kpis(views: readonly SessionView[] = this.liveViews()): Kpis {
    const now = this.now();
    const nowSec = Math.floor(now / 1000);
    if (!this.costMinuteCache || now - this.costMinuteCache.at > 5000) {
      this.costMinuteCache = { at: now, rows: this.db.fleetCostPerMinute((Math.floor(nowSec / 60) - 59) * 60) };
    }
    return computeKpis(
      {
        views,
        costToday: this.db.costSince(startOfDay(now)),
        tokensPerSecond: this.db.fleetTokensPerSecond(nowSec - 61),
        costPerMinute: this.costMinuteCache.rows,
      },
      now,
    );
  }

  clearedToday(): number {
    const now = this.now();
    return this.db.endedBetween(startOfDay(now), now + 1).filter((s) => !this.live.has(s.id)).length;
  }

  events(opts: { sessionId?: string | null; before?: number | null; limit: number }): ActivityView[] {
    const rows = this.db.listEvents(opts);
    const sessions = new Map<string, SessionRow | undefined>();
    return rows.map((e) => {
      if (!sessions.has(e.session_id)) sessions.set(e.session_id, this.db.getSession(e.session_id));
      return activityView(e, sessions.get(e.session_id));
    });
  }

  /** Sessions that ended or were dropped in [from, to), as summary rows. */
  history(from: number, to: number): HistoryRow[] {
    return this.db.endedBetween(from, to).map((row) => {
      const agents = this.db.getAgents(row.id);
      const end = row.dropped_at ?? row.ended_at ?? row.last_seen_at;
      return {
        id: row.id,
        name: row.name,
        project: shortenHome(row.project_root ?? row.cwd, this.cfg.home),
        model: row.model,
        modelFamily: family(row.model),
        startedAt: row.started_at,
        endedAt: end,
        durationSec: Math.max(0, Math.round((end - row.started_at) / 1000)),
        costUsd: row.cost_usd,
        blowouts: row.blowouts + agents.reduce((n, a) => n + a.blowouts, 0),
        agents: agents.length,
        endReason: row.dropped_at !== null ? 'heartbeat lost' : row.end_reason,
      };
    });
  }

  state(): StateBody {
    const sessions = this.liveViews();
    return {
      serverTime: this.now(),
      config: { staleAfterMs: this.cfg.staleAfterMs, dropAfterMs: this.cfg.dropAfterMs, lingerMs: this.cfg.lingerMs },
      sessions,
      kpis: this.kpis(sessions),
      clearedToday: this.clearedToday(),
      events: this.events({ limit: STATE_EVENTS }),
    };
  }

  /** The first message a new SSE client gets. */
  snapshotMessage(): string {
    return formatSse('snapshot', this.state());
  }

  health(): { ok: true; dbPath: string; liveSessions: number; uptimeSec: number; reporterVersionsSeen: string[]; sseClients: number; maxClockSkewMs: number } {
    let skew = 0;
    for (const id of this.live.keys()) skew = Math.max(skew, Math.abs(this.clockSkew.get(id) ?? 0));
    return {
      ok: true,
      dbPath: this.cfg.dbPath,
      liveSessions: this.live.size,
      uptimeSec: Math.floor((this.now() - this.startedAt) / 1000),
      reporterVersionsSeen: this.db.distinctReporterVersions(),
      sseClients: this.hub.size,
      maxClockSkewMs: skew,
    };
  }

  // ---- writes ---------------------------------------------------------------------------------

  deleteSession(id: string): boolean {
    const wasLive = this.live.delete(id);
    const t = this.pending.get(id);
    if (t) clearTimeout(t);
    this.pending.delete(id);
    const existed = this.db.deleteSession(id);
    if (wasLive) this.hub.broadcast('removed', { sessionId: id, reason: 'deleted' satisfies RemovedReason });
    return existed;
  }

  private leave(row: SessionRow, reason: 'done' | 'dropped', text: string): void {
    const now = this.now();
    this.live.delete(row.id);
    const t = this.pending.get(row.id);
    if (t) clearTimeout(t);
    this.pending.delete(row.id);
    if (reason === 'dropped') this.db.setDropped(row.id, now);
    const marker = reason === 'done' ? row.ended_at ?? now : row.last_seen_at;
    const ev = {
      id: `${row.id}:server:end:${reason}:${marker}`,
      session_id: row.id,
      agent_id: null,
      t: now,
      kind: 'end',
      text,
      data_json: JSON.stringify({ reason }),
    };
    if (this.db.insertEvent(ev)) this.hub.broadcast('activity', activityView(ev, row));
    this.hub.broadcast('removed', { sessionId: row.id, reason });
  }

  // ---- timers (driven by sweeper.ts) ------------------------------------------------------------

  /** Once a second: stale transitions, drops, lingering done sessions, carry-forward samples. */
  sweep(): void {
    const now = this.now();
    const nowSec = Math.floor(now / 1000);
    for (const [id, entry] of [...this.live]) {
      const row = this.db.getSession(id);
      if (!row) {
        this.live.delete(id);
        continue;
      }
      if (row.status === 'done') {
        if (now - (row.ended_at ?? now) >= this.cfg.lingerMs) this.leave(row, 'done', 'session ended');
        continue;
      }
      const status = sessionStatus(row, entry.heard, now, this.cfg.staleAfterMs);
      if (status === 'stale') {
        const base = row.last_seen_at + this.cfg.staleAfterMs;
        const staleSince = entry.heard ? base : Math.max(base, this.startedAt);
        if (now - staleSince >= this.cfg.dropAfterMs) {
          this.leave(row, 'dropped', 'heartbeat lost');
          continue;
        }
      } else {
        // A live session that reports less often than once a second still gets one sample per
        // second, so its charts do not fall to zero between heartbeats.
        const last = this.db.latestSample(id);
        if (last && last.t < nowSec) {
          this.db.insertSampleIfAbsent({ ...last, t: nowSec, tokens_delta: 0 });
        }
      }
      if (entry.status !== null && entry.status !== status) {
        entry.status = status;
        this.hub.broadcast('session', this.viewOf(row));
      } else if (entry.status === null) {
        entry.status = status;
      }
    }
  }

  /** Every 2 s: KPIs to every client; doubles as the keepalive. */
  tick(): void {
    this.hub.broadcast('tick', { serverTime: this.now(), kpis: this.kpis() });
  }

  /** Hourly: retention. */
  retain(): { samples: number; events: number; sessions: number } {
    return this.db.retain(this.now(), this.cfg.retention);
  }

  close(): void {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.hub.closeAll();
  }
}
