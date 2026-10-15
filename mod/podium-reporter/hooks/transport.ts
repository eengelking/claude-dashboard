// Getting reports to the server (SPEC 6.1, 6.7): an event queue capped at 500, one POST at a time,
// acks by count, backoff 1 s, 2 s, 5 s, 10 s while the server is unreachable. Nothing here awaits
// anything a tool call waits on: hooks only call `enqueue`; the flush timer calls `send`.
import type { ActivityEvent, Delivery, Report } from './protocol.ts';

export const QUEUE_MAX = 500;
export const BACKOFF_MS = [1000, 2000, 5000, 10_000] as const;
export const EVENTS_PER_REPORT = 100;
/** How long to wait after the server refuses the token or name: it will not change until the settings do. */
export const REFUSED_RETRY_MS = 60_000;
/** More watched loops than a report can carry agents is not a list the mod takes whole. */
const MAX_WATCHED = 201;
/** Messages and commands one reply can hand over (#206). */
const MAX_DELIVERIES = 20;

/** A delivery as the server sends it: only its shape is checked here; what it may do is the mod's to decide (SPEC 5.3). */
export function isDelivery(v: unknown): v is Delivery {
  const d = v as Partial<Delivery> | null;
  return !!d && typeof d === 'object' && typeof d.id === 'string' && typeof d.kind === 'string' && typeof d.by === 'string' && typeof d.at === 'number';
}

export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<HttpResult>;

export interface TransportConfig {
  serverUrl: string;
  token: string;
  heartbeatMs: number;
  /** This reporter's own version; passed in so the transport never imports it. */
  version: string;
}

/** The oldest and newest reporter the server reads correctly (SPEC 6.8). */
export interface ReporterSupport {
  min: string;
  max: string;
}

/** Major and minor of a version as numbers; null when it is not one. */
function minorOf(v: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)(?:\.|$)/.exec(v);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export type SendOutcome = 'ok' | 'rejected' | 'refused' | 'failed' | 'busy';

export class Transport {
  queue: ActivityEvent[] = [];
  /** null until the first attempt. */
  online: boolean | null = null;
  sent = 0;
  failed = 0;
  rejected = 0;
  dropped = 0;
  failures = 0;
  lastError: string | null = null;
  lastSentAt = 0;
  nextAttemptAt = 0;
  liveSessions: number | null = null;
  /** Where the server places this reporter's version; null until a reply says (an older server never does). */
  compat: 'ok' | 'outdated' | 'newer' | null = null;
  serverVersion: string | null = null;
  /** What the server reads correctly; null until a reply says (an older server never does). */
  support: ReporterSupport | null = null;
  /** The loops the last accepted report's reply says someone is watching (#118); empty from a server that predates it. */
  watch: string[] = [];
  /** Whether the last accepted report's reply said the server takes answers for this session (#206); false from an older server. */
  respond = false;
  /** Messages and commands from Podium the last reply handed over (#206). */
  deliveries: Delivery[] = [];
  inFlight = false;
  private current: Promise<SendOutcome> | null = null;
  private loggedReject = false;
  private loggedRefusal = false;
  /** True while the server's last answer was a 401. */
  refused = false;
  private rejectStreak = 0;

  constructor(
    private readonly fetch: FetchLike,
    readonly cfg: TransportConfig,
    private readonly log: (line: string) => void = () => {},
  ) {}

  get url(): string {
    return `${this.cfg.serverUrl.replace(/\/+$/, '')}/api/fleet/report`;
  }

  /** Queues events; past 500 the oldest are dropped. */
  enqueue(events: readonly ActivityEvent[]): void {
    if (!events.length) return;
    this.queue.push(...events);
    if (this.queue.length > QUEUE_MAX) {
      this.dropped += this.queue.length - QUEUE_MAX;
      this.queue.splice(0, this.queue.length - QUEUE_MAX);
    }
  }

  /** Whether a report should go now: something changed, or the heartbeat is due, and no backoff holds. */
  due(now: number, dirty: boolean): boolean {
    if (this.inFlight || now < this.nextAttemptAt) return false;
    return dirty || this.queue.length > 0 || this.lastSentAt === 0 || now - this.lastSentAt >= this.cfg.heartbeatMs;
  }

  /** The delay before retry number `failures` (1-based). */
  static backoff(failures: number): number {
    return BACKOFF_MS[Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1]!;
  }

  /**
   * Posts one report built from the oldest queued events (at most 100). 200 acks them; 400 or 413 drops
   * that report and its events (it would never be accepted) and backs off before the next attempt;
   * anything else keeps them and backs off.
   */
  send(build: (events: ActivityEvent[]) => Report, now: number): Promise<SendOutcome> {
    if (this.inFlight) return Promise.resolve('busy');
    this.inFlight = true;
    const p = this.post(build, now);
    this.current = p;
    return p;
  }

  /** Resolves when no POST is in flight (at once when none is). */
  async idle(): Promise<void> {
    if (this.current) await this.current.catch(() => undefined);
  }

  private async post(build: (events: ActivityEvent[]) => Report, now: number): Promise<SendOutcome> {
    const events = this.queue.slice(0, EVENTS_PER_REPORT);
    try {
      const report = build(events);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.cfg.token) headers['X-Podium-Token'] = this.cfg.token;
      const res = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(report) });
      if (res.ok) {
        let acked = events.length;
        try {
          const body = JSON.parse(res.text) as { ackedEvents?: unknown; liveSessions?: unknown; reporterCompat?: unknown; serverVersion?: unknown; reporterSupport?: unknown; watch?: unknown; respond?: unknown; deliveries?: unknown };
          if (typeof body.ackedEvents === 'number') acked = Math.max(0, Math.min(events.length, body.ackedEvents));
          if (typeof body.liveSessions === 'number') this.liveSessions = body.liveSessions;
          this.compat = body.reporterCompat === 'outdated' || body.reporterCompat === 'newer' || body.reporterCompat === 'ok' ? body.reporterCompat : null;
          this.serverVersion = typeof body.serverVersion === 'string' ? body.serverVersion : null;
          const sup = body.reporterSupport as Partial<ReporterSupport> | null | undefined;
          this.support = sup && typeof sup.min === 'string' && typeof sup.max === 'string' ? { min: sup.min, max: sup.max } : null;
          this.watch = Array.isArray(body.watch) ? body.watch.filter((id): id is string => typeof id === 'string').slice(0, MAX_WATCHED) : [];
          this.respond = body.respond === true;
          this.deliveries = this.respond && Array.isArray(body.deliveries) ? body.deliveries.filter(isDelivery).slice(0, MAX_DELIVERIES) : [];
        } catch {
          // a 200 without a JSON body still acks what was sent
        }
        this.ack(events, acked);
        this.online = true;
        this.failures = 0;
        this.rejectStreak = 0;
        this.nextAttemptAt = 0;
        this.lastSentAt = now;
        this.lastError = null;
        this.sent++;
        this.refused = false;
        this.loggedRefusal = false;
        return 'ok';
      }
      // 409: the session id already belongs to another owner (server-side); it is as permanent as a 400, so it is not an outage.
      if (res.status === 400 || res.status === 409 || res.status === 413) {
        this.ack(events, events.length);
        this.rejected++;
        // Back off like a failure: a snapshot the server keeps refusing (a mod/server version mismatch, say)
        // would otherwise be rebuilt and re-posted on every flush tick while state is dirty.
        this.rejectStreak++;
        this.nextAttemptAt = now + Transport.backoff(this.rejectStreak);
        this.lastSentAt = now;
        this.lastError = `server rejected a report (${res.status})`;
        if (!this.loggedReject) {
          this.loggedReject = true;
          this.log(`podium-reporter: server rejected a report (${res.status}): ${res.text.slice(0, 200)}`);
        }
        return 'rejected';
      }
      if (res.status === 401) {
        // The token is wrong, revoked, or does not belong to the configured name. Keep the events, wait a long
        // while (nothing changes until the settings do), and say so once. The token is never put in a message.
        this.refused = true;
        this.online = false;
        this.nextAttemptAt = now + REFUSED_RETRY_MS;
        this.lastSentAt = now;
        this.lastError = 'server refused the token or name (401)';
        if (!this.loggedRefusal) {
          this.loggedRefusal = true;
          this.log('podium-reporter: the server refused this reporter (401): check the Podium token and user name settings');
        }
        return 'refused';
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      this.failures++;
      this.failed++;
      this.online = false;
      this.lastError = (err as Error)?.message ?? 'network error';
      this.nextAttemptAt = now + Transport.backoff(this.failures);
      return 'failed';
    } finally {
      this.inFlight = false;
      this.current = null;
    }
  }

  /** Removes the first `n` of `sent` from the queue (events queued meanwhile stay). */
  private ack(sent: readonly ActivityEvent[], n: number): void {
    const ids = new Set(sent.slice(0, n).map((e) => e.id));
    this.queue = this.queue.filter((e) => !ids.has(e.id));
  }

  /**
   * True when the server supports a newer major.minor than this reporter but still reads it (so it is not
   * `outdated`). Patch releases are not flagged: `max` moves with the report format, not with every release.
   */
  get behind(): boolean {
    if (!this.support || this.compat === 'outdated' || this.compat === 'newer') return false;
    const mine = minorOf(this.cfg.version);
    const max = minorOf(this.support.max);
    if (!mine || !max) return false;
    return mine[0] < max[0] || (mine[0] === max[0] && mine[1] < max[1]);
  }

  statusText(): string {
    const name = `podium v${this.cfg.version}`;
    if (this.refused) return `${name} ○ token refused`;
    if (this.online === false) return `${name} ○ offline`;
    if (this.online === null) return `${name} ○ connecting`;
    const live = `${name} ● ${this.liveSessions ?? 1} live`;
    if (this.compat === 'outdated') return `${live} · update mod`;
    if (this.compat === 'newer') return `${live} · upgrade server`;
    if (this.behind) return `${live} · update available`;
    return live;
  }

  /** What to tell the user when the server refused the token or name; null when it did not. */
  refusalNotice(): string | null {
    return this.refused ? 'The server refused this reporter. Check that the Podium token belongs to the user name in the podium-reporter settings (claude plugin configure podium-reporter), or ask the server owner for a new token.' : null;
  }

  /** What to tell the user when the server says this reporter and it do not match; null when they do (or it cannot tell). */
  versionNotice(): string | null {
    const server = this.serverVersion ? ` (server ${this.serverVersion})` : '';
    if (this.compat === 'outdated') return `This reporter is older than the Podium server supports${server}: update the podium-reporter mod (claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins).`;
    if (this.compat === 'newer') return `This reporter is newer than the Podium server supports${server}: upgrade the Podium server.`;
    return null;
  }

  /** The mild hint behind `· update available`; for `/podium` only, never a toast. Null when not behind. */
  updateNotice(): string | null {
    if (!this.behind || !this.support) return null;
    const server = this.serverVersion ? ` (server ${this.serverVersion})` : '';
    return `A newer podium-reporter is supported by the server${server}: it reads reporters up to ${this.support.max}, this one is ${this.cfg.version}. Update with claude plugin update podium-reporter@eengelking-marketplace, then /reload-plugins.`;
  }
}
