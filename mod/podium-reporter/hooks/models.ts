// Model families, context windows and the price table (SPEC 6.5). Pure; no `$` here.
//
// SOURCE: the `claude-api` skill bundled with Claude Code 2.1.296, "Current Models (cached:
// 2026-10-06)" and shared/models.md / shared/prompt-caching.md. Prices are Anthropic first-party API
// list prices in USD per million tokens. Cache writes are priced at the 5-minute TTL (1.25x input).
// Cache reads are the per-model figures the skill lists (0.1x input unless it says otherwise).
// Haiku 5.5 is priced at its <=100K-prompt tier ($0.10 / $0.50); longer prompts cost 5x, which this
// estimate ignores. Every figure here is an ESTIMATE: Podium never presents it as a bill.

export const PRICES_AS_OF = '2026-10-06';

export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Lowercase substring match: `opus`, `sonnet`, `haiku`, `fable`, else `other`. */
export function family(model: string | null | undefined): Family {
  const m = (model ?? '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('fable')) return 'fable';
  return 'other';
}

function price(input: number, output: number, cacheRead: number): Price {
  return { input, output, cacheRead, cacheWrite: Math.round(input * 1.25 * 1000) / 1000 };
}

/** Current generation per family (an alias such as `opus` resolves to these). */
const FAMILY_PRICE: Record<Family, Price> = {
  opus: price(4, 20, 0.2), // claude-opus-5-5
  sonnet: price(2, 10, 0.2), // claude-sonnet-5-5
  haiku: price(0.1, 0.5, 0.01), // claude-haiku-5-5 (<=100K prompt tier)
  fable: price(10, 50, 0.25), // claude-fable-5-1
  // Unknown model: priced as Sonnet so the estimate is neither zero nor alarming.
  other: price(2, 10, 0.2),
};

/** Older ids that are still served and priced differently from their family's current model. */
const ID_PRICE: [RegExp, Price][] = [
  [/fable-5(?!-1)/, price(10, 50, 1)], // claude-fable-5 (and mythos-5)
  [/opus-5(?!-5)/, price(5, 25, 0.5)], // claude-opus-5
  [/opus-4/, price(5, 25, 0.5)], // claude-opus-4-6 .. 4-8
  [/sonnet-5(?!-5)/, price(2, 10, 0.2)], // claude-sonnet-5
  [/sonnet-4/, price(3, 15, 0.3)], // claude-sonnet-4-6
  [/haiku-4/, price(1, 5, 0.1)], // claude-haiku-4-5
];

/** USD per million tokens for a model id, an alias, or a family name. */
export function priceOf(model: string | null | undefined): Price {
  const m = (model ?? '').toLowerCase();
  for (const [re, p] of ID_PRICE) if (re.test(m)) return p;
  return FAMILY_PRICE[family(m)];
}

/**
 * Context window in tokens. Every current family has a 1M window; Haiku 4.5 (and older Haiku and
 * Claude 3 ids) have 200K. For the main loop prefer `$.session.usage().context.window`.
 */
export function windowOf(model: string | null | undefined): number {
  const m = (model ?? '').toLowerCase();
  if (/haiku-4|haiku-3|claude-3/.test(m)) return 200_000;
  return 1_000_000;
}

/** Estimated cost in USD: Σ tokens × price / 1e6. */
export function costOf(t: Tokens, model: string | null | undefined): number {
  const p = priceOf(model);
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;
}

/** `Opus`, `Sonnet`, `Haiku`, `Fable`, or the raw model string. */
export function shortName(model: string | null | undefined): string {
  const f = family(model);
  if (f === 'other') return model ?? 'unknown';
  return f[0]!.toUpperCase() + f.slice(1);
}
