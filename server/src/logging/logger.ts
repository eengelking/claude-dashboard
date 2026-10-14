// The server's logger (#140). Each call is an event: a stable dotted name (`report.rejected`), a message for
// people, and flat fields. Locally it prints either the message alone (`text`, what the server always printed)
// or one JSON object per line (`json`); the JSON line is also what the shipper sends. Debug and info go to
// stdout, warn and error to stderr, as before. See docs/ARCHITECTURE.md "Logging".
import os from 'node:os';
import { cleanFields, scrub, type FieldValue, type Fields } from './redact.js';

export type { FieldValue, Fields };

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type Level = (typeof LEVELS)[number];
export type LogFormat = 'text' | 'json';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
/** The contract fields; an event's own fields cannot overwrite them. */
const RESERVED = new Set(['timestamp', 'level', 'message', 'event', 'service', 'host', 'version']);

export interface EmitOptions {
  /** false keeps the line local: the shipper uses it to talk about itself without feeding its own buffer. */
  ship?: boolean;
}

export interface Logger {
  debug(event: string, message: string, fields?: Fields): void;
  info(event: string, message: string, fields?: Fields): void;
  warn(event: string, message: string, fields?: Fields): void;
  error(event: string, message: string, fields?: Fields): void;
  log(level: Level, event: string, message: string, fields?: Fields, opts?: EmitOptions): void;
  isEnabled(level: Level): boolean;
}

export interface LoggerOptions {
  /** Lowest level written and shipped. Default `info`. */
  level?: Level;
  /** Local output. Default `text`. */
  format?: LogFormat;
  service?: string;
  host?: string;
  version?: string;
  now?: () => number;
  /** Where a local line goes. Default: stdout for debug and info, stderr for warn and error. */
  write?: (line: string, level: Level) => void;
  /** Receives every line at or above the level as a JSON string. Absent: nothing is shipped. */
  ship?: (json: string) => void;
  /** Exact strings never written or shipped (the admin secret). Person tokens are always scrubbed. */
  secrets?: readonly string[];
}

export function parseLevel(v: string | undefined | null): Level | null {
  const s = (v ?? '').trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(s) ? (s as Level) : null;
}

export function parseFormat(v: string | undefined | null): LogFormat | null {
  const s = (v ?? '').trim().toLowerCase();
  return s === 'text' || s === 'json' ? s : null;
}

const defaultWrite = (line: string, level: Level) => {
  if (RANK[level] >= RANK.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

export function createLogger(opts: LoggerOptions = {}): Logger {
  const min = RANK[opts.level ?? 'info'];
  const format = opts.format ?? 'text';
  const service = opts.service ?? 'podium';
  const host = opts.host ?? os.hostname();
  const version = opts.version ?? '';
  const now = opts.now ?? Date.now;
  const write = opts.write ?? defaultWrite;
  const secrets = (opts.secrets ?? []).filter((s) => typeof s === 'string' && s.length > 0);

  const isEnabled = (level: Level) => RANK[level] >= min;

  const log = (level: Level, event: string, message: string, fields?: Fields, emit: EmitOptions = {}) => {
    if (!isEnabled(level)) return;
    try {
      const msg = scrub(message, secrets);
      const record: Record<string, FieldValue> = {
        timestamp: new Date(now()).toISOString(),
        level,
        message: msg,
        event: scrub(event, secrets),
        service,
        host,
        version,
      };
      for (const [k, v] of Object.entries(cleanFields(fields, secrets))) {
        if (!RESERVED.has(k)) record[k] = v;
      }
      const json = JSON.stringify(record);
      write(format === 'json' ? json : msg, level);
      if (opts.ship && emit.ship !== false) opts.ship(json);
    } catch {
      // A log line must never take a request or a timer down with it.
    }
  };

  return {
    log,
    isEnabled,
    debug: (e, m, f) => log('debug', e, m, f),
    info: (e, m, f) => log('info', e, m, f),
    warn: (e, m, f) => log('warn', e, m, f),
    error: (e, m, f) => log('error', e, m, f),
  };
}

/** Text lines to a plain `log(line)` function: the routers' and the sweeper's original option. */
export function loggerFromLine(line: (l: string) => void): Logger {
  return createLogger({ format: 'text', write: (l) => line(l) });
}

/** Writes nothing. The fleet's default, so tests and tools that build a Fleet stay quiet. */
export const silentLogger: Logger = createLogger({ level: 'error', write: () => {} });
