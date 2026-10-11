// Getting reports to the server (SPEC 6.1, 6.7): an event queue capped at 500, one POST at a time,
// acks by count, backoff 1 s, 2 s, 5 s, 10 s while the server is unreachable. Nothing here awaits
// anything a tool call waits on: hooks only call `enqueue`; the flush timer calls `send`.
import type { ActivityEvent, Report } from './protocol.ts';

export const QUEUE_MAX = 500;
export const BACKOFF_MS = [1000, 2000, 5000, 10_000] as const;
export const EVENTS_PER_REPORT = 100;

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
}

export type SendOutcome = 'ok' | 'rejected' | 'failed' | 'busy';

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
  inFlight = false;
  private current: Promise<SendOutcome> | null = null;
  private loggedReject = false;

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
   * that report and its events (it would never be accepted); anything else keeps them and backs off.
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
          const body = JSON.parse(res.text) as { ackedEvents?: unknown; liveSessions?: unknown };
          if (typeof body.ackedEvents === 'number') acked = Math.max(0, Math.min(events.length, body.ackedEvents));
          if (typeof body.liveSessions === 'number') this.liveSessions = body.liveSessions;
        } catch {
          // a 200 without a JSON body still acks what was sent
        }
        this.ack(events, acked);
        this.online = true;
        this.failures = 0;
        this.nextAttemptAt = 0;
        this.lastSentAt = now;
        this.lastError = null;
        this.sent++;
        return 'ok';
      }
      if (res.status === 400 || res.status === 413) {
        this.ack(events, events.length);
        this.rejected++;
        this.lastSentAt = now;
        this.lastError = `server rejected a report (${res.status})`;
        if (!this.loggedReject) {
          this.loggedReject = true;
          this.log(`podium-reporter: server rejected a report (${res.status}): ${res.text.slice(0, 200)}`);
        }
        return 'rejected';
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

  statusText(): string {
    if (this.online === false) return 'podium ○ offline';
    if (this.online === null) return 'podium ○ connecting';
    return `podium ● ${this.liveSessions ?? 1} live`;
  }
}
