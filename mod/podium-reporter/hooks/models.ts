// Model families, context windows and the price table (SPEC 6.5). Pure; no `$` here.
//
// SOURCE: Anthropic's pricing sheet (platform.claude.com/docs/en/about-claude/pricing), taken 2026-10-13.
// Prices are first-party API list prices in USD per million tokens. Cache writes are priced at the
// 5-minute TTL (1.25x input). Haiku 5.5 is priced at its <=100K-prompt tier ($0.10 / $0.50); longer
// prompts cost 5x, which this estimate ignores.
// Since #117 these figures are only the fallback for a server that predates per-model usage: a current
// server prices the `usageByModel` totals in each report with its own table and the Admin's prices.
// Every figure here is an ESTIMATE: Podium never presents it as a bill.

export const PRICES_AS_OF = '2026-10-13';

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

/**
 * Lowercase substring match: `opus`, `sonnet`, `haiku`, `fable`, else `other`. Only a Claude model
 * counts: a bare alias (`opus`, `sonnet[1m]`) or an id containing `claude`. A local model such as
 * `my-sonnet-finetune:latest` is `other` even though its name holds a family word.
 */
export function family(model: string | null | undefined): Family {
  const m = (model ?? '').toLowerCase();
  if (!/^(opus|sonnet|haiku|fable|opusplan)(\[[^\]]*\])?$/.test(m) && !m.includes('claude')) return 'other';
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
const FAMILY_PRICE: Record<Exclude<Family, 'other'>, Price> = {
  opus: price(4, 20, 0.2), // claude-opus-5-5
  sonnet: price(2, 10, 0.1), // claude-sonnet-5-5
  haiku: price(0.1, 0.5, 0.01), // claude-haiku-5-5 (<=100K prompt tier)
  fable: price(10, 50, 0.25), // claude-fable-5-1
};

/** Older ids that are still served and priced differently from their family's current model. */
const ID_PRICE: [RegExp, Price][] = [
  [/fable-5(?!-1)/, price(10, 50, 1)], // claude-fable-5 (and mythos-5)
  [/opus-5(?!-5)/, price(5, 25, 0.5)], // claude-opus-5
  [/opus-4-1(?!\d)|opus-4(?!-[5-8])(?!\d)/, price(15, 75, 1.5)], // claude-opus-4-1 and claude-opus-4
  [/opus-4/, price(5, 25, 0.5)], // claude-opus-4-5 .. 4-8
  [/sonnet-5(?!-5)/, price(2, 10, 0.2)], // claude-sonnet-5
  [/sonnet-4/, price(3, 15, 0.3)], // claude-sonnet-4-6
  [/haiku-4/, price(1, 5, 0.1)], // claude-haiku-4-5
  [/haiku-3-5/, price(0.8, 4, 0.08)], // claude-haiku-3-5
];

/** USD per million tokens for a model id, an alias, or a family name. `null` for a non-Claude model. */
export function priceOf(model: string | null | undefined): Price | null {
  const m = (model ?? '').toLowerCase();
  const f = family(m);
  if (f === 'other') return null;
  for (const [re, p] of ID_PRICE) if (re.test(m)) return p;
  return FAMILY_PRICE[f];
}

/**
 * Context window in tokens, or `null` for a non-Claude model. Every current family has a 1M window; Haiku 4.5 (and older Haiku and
 * Claude 3 ids) have 200K. For the main loop prefer `$.session.usage().context.window`.
 */
export function windowOf(model: string | null | undefined): number | null {
  const m = (model ?? '').toLowerCase();
  if (family(m) === 'other') return null;
  if (/haiku-4|haiku-3|claude-3/.test(m)) return 200_000;
  return 1_000_000;
}

/** Estimated cost in USD: Σ tokens × price / 1e6. `null` when the model has no price. */
export function costOf(t: Tokens, model: string | null | undefined): number | null {
  const p = priceOf(model);
  if (!p) return null;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;
}

/** `Opus`, `Sonnet`, `Haiku`, `Fable`, or the raw model string. */
export function shortName(model: string | null | undefined): string {
  const f = family(model);
  if (f === 'other') return model ?? 'unknown';
  return f[0]!.toUpperCase() + f.slice(1);
}
