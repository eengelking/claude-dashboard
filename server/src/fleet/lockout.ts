// Wrong-credential lockout by source address, shared by Admin's unlock and the console's sign-in to respond (#206), so
// five wrong tries count once across both. In memory only: a restart forgets it.

import { createHash } from 'node:crypto';

const MAX_SOURCES = 1000;

export class Lockout {
  private readonly fails = new Map<string, { n: number; lockedUntil: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    readonly maxFails = 5,
    readonly lockMs = 15 * 60_000,
  ) {}

  /** Milliseconds until the source may try again; 0 when it is not locked out. */
  lockedFor(source: string): number {
    const state = this.fails.get(source);
    return state && state.lockedUntil > this.now() ? state.lockedUntil - this.now() : 0;
  }

  /** Counts a wrong try. A lock resets the count, so an expired lock starts from zero. */
  fail(source: string): { n: number; locked: boolean } {
    const state = this.fails.get(source);
    const n = (state?.n ?? 0) + 1;
    if (!state && this.fails.size >= MAX_SOURCES) this.fails.delete(this.fails.keys().next().value as string);
    const locked = n >= this.maxFails;
    this.fails.set(source, { n: locked ? 0 : n, lockedUntil: locked ? this.now() + this.lockMs : 0 });
    return { n, locked };
  }

  succeed(source: string): void {
    this.fails.delete(source);
  }
}

/**
 * Throttle for guesses at the admin secret sent as X-Podium-Token (#255). It is separate from `Lockout`, so a reporter with
 * a stale credential cannot lock anyone out of Admin or the console. A source is locked after `maxDistinct` different wrong
 * values; the same wrong value sent again counts once, because repeating it teaches a guesser nothing, so one misconfigured
 * reporter (which always sends the same value) never trips it. In memory only: a restart forgets it.
 */
export class GuessThrottle {
  private readonly seen = new Map<string, { wrong: Set<string>; lockedUntil: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    readonly maxDistinct = 5,
    readonly lockMs = 15 * 60_000,
  ) {}

  /** Milliseconds until the source may present a secret again; 0 when it is not throttled. */
  lockedFor(source: string): number {
    const state = this.seen.get(source);
    return state && state.lockedUntil > this.now() ? state.lockedUntil - this.now() : 0;
  }

  /** Notes a wrong value (kept as its SHA-256, never the value). Returns whether this locked the source. */
  fail(source: string, value: string): boolean {
    const state = this.seen.get(source) ?? { wrong: new Set<string>(), lockedUntil: 0 };
    if (!this.seen.has(source) && this.seen.size >= MAX_SOURCES) this.seen.delete(this.seen.keys().next().value as string);
    state.wrong.add(createHash('sha256').update(value).digest('hex'));
    const locked = state.wrong.size >= this.maxDistinct;
    if (locked) {
      state.wrong.clear();
      state.lockedUntil = this.now() + this.lockMs;
    }
    this.seen.set(source, state);
    return locked;
  }
}
