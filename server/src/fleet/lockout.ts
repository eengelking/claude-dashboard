// Wrong-credential lockout by source address, shared by Admin's unlock and the console's sign-in to respond (#206), so
// five wrong tries count once across both. In memory only: a restart forgets it.

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
