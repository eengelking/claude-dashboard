// Lifecycle timers (SPEC 7.5): the sweep every second, the KPI tick every 2 s, retention hourly.
// Each timer body is guarded so a failing sweep is logged and the next one still runs.
import type { Fleet } from './fleet.js';
import type { PeopleStore } from './people.js';
import type { ReporterStore } from './reporters.js';
import { createLogger, loggerFromLine, type Logger } from '../logging/logger.js';

export interface SweeperIntervals {
  sweepMs: number;
  tickMs: number;
  retentionMs: number;
}

export const DEFAULT_INTERVALS: SweeperIntervals = { sweepMs: 1000, tickMs: 2000, retentionMs: 3600_000 };

/**
 * Removes reporters not heard from for the Admin's number of days, when that setting is on (issue #167), and says so in the
 * log and the Admin log. Silent when nothing went.
 */
export function forgetReporters(reporters: ReporterStore, people: PeopleStore, logger: Logger, now: number): void {
  const removed = reporters.forgetStale(now);
  if (removed === 0) return;
  const { days } = reporters.forgetSetting();
  const detail = `Forgot ${removed} reporter${removed === 1 ? '' : 's'} not heard from for ${days} days`;
  people.log('reporters_forgotten', detail, 'sweeper', now);
  logger.info('reporters.forgotten', `podium: ${detail}`, { count: removed, days });
}

/** `log` is the server's logger, or a plain line sink as before the logger existed (#140). */
export function startSweeper(fleet: Fleet, intervals: SweeperIntervals = DEFAULT_INTERVALS, log: Logger | ((line: string) => void) = createLogger(), onRetention?: () => void): () => void {
  const logger = typeof log === 'function' ? loggerFromLine(log) : log;
  const guard = (name: string, fn: () => void) => () => {
    try {
      fn();
    } catch (err) {
      logger.error('sweeper.failed', `podium sweeper: ${name} failed: ${(err as Error).message}`, { timer: name, reason: (err as Error).message });
    }
  };
  const timers = [
    setInterval(guard('sweep', () => fleet.sweep()), intervals.sweepMs),
    setInterval(guard('tick', () => fleet.tick()), intervals.tickMs),
    setInterval(guard('retention', () => void fleet.retain()), intervals.retentionMs),
    setInterval(guard('forget-reporters', () => onRetention?.()), intervals.retentionMs),
  ];
  // Retention also runs once at start, so a server that restarts often still prunes.
  guard('retention', () => void fleet.retain())();
  guard('forget-reporters', () => onRetention?.())();
  for (const t of timers) t.unref?.();
  return () => {
    for (const t of timers) clearInterval(t);
  };
}
