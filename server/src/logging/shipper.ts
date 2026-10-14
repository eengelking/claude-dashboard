// Pushes log lines to a central platform (#140), built for VictoriaLogs' JSON line ingest
// (`POST /insert/jsonline`, NDJSON, `Content-Type: application/stream+json`). It is off unless
// PODIUM_LOG_SHIP_URL is set. A request path only ever calls `push`, which appends to a bounded
// in-memory buffer and returns: the network work runs on a timer and is never awaited by ingest. When the
// endpoint is down the buffer keeps the newest lines, drops the oldest, and says so once in the server's own
// output (never shipped, so the warning cannot feed the buffer it is about).
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Fields } from './redact.js';

const gzipAsync = promisify(gzip);

/** The query args that map Podium's fields onto VictoriaLogs' time, message and stream fields. */
export const INGEST_ARGS: Record<string, string> = {
  _time_field: 'timestamp',
  _msg_field: 'message',
  _stream_fields: 'service,host',
};
const INGEST_PATH = 'insert/jsonline';

/**
 * The ingest URL for a configured endpoint. A bare address (`http://host:9428`, or one with a proxy prefix)
 * gets `/insert/jsonline` appended; the mapping args are added unless the URL already sets them.
 */
export function shipUrl(base: string): string {
  const u = new URL(base.trim());
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('the log ship URL must be http or https');
  if (!u.pathname.replace(/\/+$/, '').endsWith(`/${INGEST_PATH}`)) {
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/${INGEST_PATH}`;
  }
  for (const [k, v] of Object.entries(INGEST_ARGS)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.toString();
}

/** The endpoint as it may appear in the server's output: no user name, password or query. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

/** `Name=Value;Name2=Value2` into headers. `invalid` names the pairs it skipped, never their values. */
export function parseShipHeaders(v: string | undefined): { headers: Record<string, string>; invalid: string[] } {
  const headers: Record<string, string> = {};
  const invalid: string[] = [];
  for (const part of (v ?? '').split(';')) {
    if (!part.trim()) continue;
    const i = part.indexOf('=');
    const name = (i < 0 ? part : part.slice(0, i)).trim();
    const value = i < 0 ? '' : part.slice(i + 1).trim();
    // An RFC 7230 token for the name, and no line breaks in the value.
    if (i < 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value)) {
      invalid.push(name.slice(0, 40));
      continue;
    }
    headers[name] = value;
  }
  return { headers, invalid };
}

export interface ShipperOptions {
  /** The endpoint, as for `shipUrl`. */
  url: string;
  headers?: Record<string, string>;
  /** Lines kept while the endpoint is slow or down. Default 2000. */
  maxBuffer?: number;
  /** Lines per POST; a full batch is sent without waiting for the timer. Default 100. */
  batchSize?: number;
  /** How often the buffer is sent. Default 1000 ms. */
  flushMs?: number;
  /** A POST that takes longer is abandoned and its lines kept. Default 5000 ms. */
  timeoutMs?: number;
  /** First retry delay after a failure; it doubles up to 30 s. Default 1000 ms. */
  backoffMs?: number;
  fetch?: typeof fetch;
  /** The server's own output, local only: `(event, message, fields)` at warn. */
  notify?: (event: string, message: string, fields?: Fields) => void;
  now?: () => number;
}

const MAX_BACKOFF_MS = 30_000;
/** Answers that mean the batch itself is bad (malformed, too large, unprocessable): dropped, not retried. */
const REFUSED_STATUS = new Set([400, 413, 422]);

export class LogShipper {
  private readonly url: string;
  private readonly shown: string;
  private readonly headers: Record<string, string>;
  private readonly maxBuffer: number;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly notify: NonNullable<ShipperOptions['notify']>;
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setInterval>;
  private queue: string[] = [];
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private retryAt = 0;
  private dropping = false;
  private refusedWarned = false;
  private droppedSinceWarn = 0;
  private closed = false;
  private scheduled = false;
  /** Lines lost since start: pushed out of a full buffer, or refused by the endpoint. */
  dropped = 0;

  constructor(opts: ShipperOptions) {
    this.url = shipUrl(opts.url);
    this.shown = displayUrl(this.url);
    this.headers = { ...(opts.headers ?? {}) };
    this.maxBuffer = Math.max(1, Math.floor(opts.maxBuffer ?? 2000));
    this.batchSize = Math.max(1, Math.floor(opts.batchSize ?? 100));
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.backoffMs = opts.backoffMs ?? 1000;
    this.fetchFn = opts.fetch ?? fetch;
    this.notify = opts.notify ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.timer = setInterval(() => void this.flush(), opts.flushMs ?? 1000);
    this.timer.unref?.();
  }

  /** Lines waiting to be sent. */
  get size(): number {
    return this.queue.length;
  }

  /** Queues one NDJSON line. Never blocks and never throws. */
  push(line: string): void {
    if (this.closed) return;
    this.queue.push(line);
    this.trim();
    if (this.queue.length >= this.batchSize && !this.scheduled && this.now() >= this.retryAt) {
      this.scheduled = true;
      setImmediate(() => {
        this.scheduled = false;
        void this.flush();
      });
    }
  }

  private trim(): void {
    const over = this.queue.length - this.maxBuffer;
    if (over <= 0) return;
    this.queue.splice(0, over);
    this.lose(over);
  }

  private lose(n: number): void {
    this.dropped += n;
    this.droppedSinceWarn += n;
    if (this.dropping) return;
    this.dropping = true;
    this.notify('log.ship_dropping', `podium: log shipping buffer is full (${this.maxBuffer} lines); dropping the oldest lines until ${this.shown} takes them again`, {
      endpoint: this.shown,
      buffer: this.maxBuffer,
    });
  }

  /** Sends one batch, unless one is in flight or a retry is not due. Resolves when that attempt is over. */
  flush(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.queue.length === 0) return Promise.resolve();
    if (!force && this.now() < this.retryAt) return Promise.resolve();
    const batch = this.queue.splice(0, this.batchSize);
    this.inFlight = this.send(batch).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async send(batch: string[]): Promise<void> {
    let failure: string | null = null;
    let refused = false;
    try {
      const body = await gzipAsync(Buffer.from(`${batch.join('\n')}\n`, 'utf8'));
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/stream+json', 'Content-Encoding': 'gzip' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        failure = `HTTP ${res.status}`;
        // Only a batch the endpoint calls malformed or too large is dropped: it will not get better on a retry.
        // Anything else (401, 403 and 404 are a setup problem, 5xx a server one) keeps the batch and retries.
        refused = REFUSED_STATUS.has(res.status);
      }
      void res.body?.cancel().catch(() => {});
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      failure = e.name === 'TimeoutError' || e.name === 'AbortError' ? `no answer in ${this.timeoutMs} ms` : (e.cause?.code ?? e.message ?? 'error');
    }

    if (failure === null) {
      if (this.failures > 0 || this.dropping) {
        this.notify('log.ship_recovered', `podium: log shipping to ${this.shown} recovered${this.droppedSinceWarn ? `; ${this.droppedSinceWarn} lines were dropped meanwhile` : ''}`, {
          endpoint: this.shown,
          dropped: this.droppedSinceWarn,
        });
      }
      this.failures = 0;
      this.retryAt = 0;
      this.dropping = false;
      this.refusedWarned = false;
      this.droppedSinceWarn = 0;
      if (this.queue.length >= this.batchSize && !this.closed) setImmediate(() => void this.flush());
      return;
    }

    if (refused) {
      this.dropped += batch.length;
      this.droppedSinceWarn += batch.length;
      if (!this.refusedWarned) {
        this.refusedWarned = true;
        this.notify('log.ship_refused', `podium: ${this.shown} refused a batch of log lines (${failure}); dropped ${batch.length} lines`, {
          endpoint: this.shown,
          reason: failure,
          dropped: batch.length,
        });
      }
      return;
    }

    this.failures++;
    if (this.failures === 1) {
      this.notify('log.ship_failed', `podium: log shipping to ${this.shown} failed (${failure}); keeping up to ${this.maxBuffer} lines and retrying`, {
        endpoint: this.shown,
        reason: failure,
      });
    }
    this.retryAt = this.now() + Math.min(MAX_BACKOFF_MS, this.backoffMs * 2 ** (this.failures - 1));
    this.queue.unshift(...batch);
    this.trim();
  }

  /** Stops the timer and sends what is left, giving up after `maxMs`. */
  async close(maxMs = 1000): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    const deadline = this.now() + maxMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((r) => {
      timer = setTimeout(r, maxMs);
      timer.unref?.();
    });
    const drain = (async () => {
      while (this.queue.length > 0 && this.now() < deadline) {
        const before = this.queue.length;
        await this.flush(true);
        if (this.queue.length >= before) break; // the endpoint is not taking them; do not spin
      }
    })();
    await Promise.race([drain, cap]);
    clearTimeout(timer);
  }
}
