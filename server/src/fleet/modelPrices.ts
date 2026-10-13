import type { DatabaseSync } from 'node:sqlite';
import type { ModelPriceRow, ModelPricesView } from './protocol.js';
import { BUILTIN_LABELS, BUILTIN_PRICES, PRICES_AS_OF, Pricing, validatePriceSet, type ModelPrice, type PriceOverrides, type PriceSet } from './pricing.js';

const KEY = 'model_prices';
/** How many models the Admin can add beyond the built-in rows. */
export const MAX_CUSTOM_MODELS = 100;
const MAX_KEY = 120;

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'] as const;
const same = (a: PriceSet, b: PriceSet): boolean => FIELDS.every((f) => a[f] === b[f]);

/**
 * The Admin's model prices (issue #117): only what differs from the built-in table, in the settings table so it
 * applies to every browser and survives a restart. `onChange` lets the fleet tell open browsers.
 */
export class ModelPriceStore {
  /** Read once and kept until a save: this store is the only writer of the setting. */
  private cached: { overrides: PriceOverrides; pricing: Pricing } | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly onChange: () => void = () => {},
  ) {}

  private load(): { overrides: PriceOverrides; pricing: Pricing } {
    if (this.cached) return this.cached;
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
    let overrides: PriceOverrides = {};
    try {
      const parsed = r ? (JSON.parse(r.value) as unknown) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed as PriceOverrides;
    } catch {
      overrides = {};
    }
    this.cached = { overrides, pricing: new Pricing(overrides) };
    return this.cached;
  }

  overrides(): PriceOverrides {
    return this.load().overrides;
  }

  /** The pricing in force; a saved change shows here at once. */
  pricing(): Pricing {
    return this.load().pricing;
  }

  private save(next: PriceOverrides): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(KEY, JSON.stringify(next));
    this.cached = null;
    this.onChange();
  }

  /**
   * Saves one row (replacing whatever the Admin had set on it). Values equal to the built-in ones are not stored.
   * Returns a message for an invalid row, `null` when it was saved.
   */
  set(rawKey: string, body: Partial<ModelPrice>): string | null {
    const key = rawKey.trim().toLowerCase();
    if (!key) return 'a model id is required';
    if (key.length > MAX_KEY) return `a model id must be at most ${MAX_KEY} characters`;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(key)) return 'a model id must not contain control characters';
    if (key === '__proto__') return 'that is not a valid model id';
    const base = Object.hasOwn(BUILTIN_PRICES, key) ? BUILTIN_PRICES[key] : undefined;
    const stdErr = validatePriceSet(body?.std);
    if (stdErr) return `std: ${stdErr}`;
    if (body.long !== undefined) {
      if (!base?.long) return 'this model has no price for prompts over 100,000 tokens';
      const longErr = validatePriceSet(body.long);
      if (longErr) return `long: ${longErr}`;
    }
    const current = this.overrides();
    if (!base && !Object.hasOwn(current, key) && Object.keys(current).filter((k) => !Object.hasOwn(BUILTIN_PRICES, k)).length >= MAX_CUSTOM_MODELS) {
      return `the Admin can add at most ${MAX_CUSTOM_MODELS} models`;
    }
    const row: Partial<ModelPrice> = {};
    if (!base || !same(body.std!, base.std)) row.std = body.std!;
    if (body.long && (!base?.long || !same(body.long, base.long))) row.long = body.long;
    const next: PriceOverrides = { ...current };
    if (row.std || row.long) next[key] = row;
    else delete next[key];
    if (JSON.stringify(next) !== JSON.stringify(current)) this.save(next);
    return null;
  }

  /** Removes the Admin's change from a row (or an Admin-added model). */
  reset(rawKey: string): void {
    const key = rawKey.trim().toLowerCase();
    const current = this.overrides();
    if (!Object.hasOwn(current, key)) return;
    const next = { ...current };
    delete next[key];
    this.save(next);
  }

  view(): ModelPricesView {
    const o = this.overrides();
    const pricing = this.pricing();
    const models: ModelPriceRow[] = Object.keys(BUILTIN_PRICES).map((key) => {
      const base = BUILTIN_PRICES[key]!;
      const eff = pricing.rowOf(key)!;
      return {
        key,
        label: BUILTIN_LABELS[key] ?? key,
        builtin: true,
        overridden: Object.hasOwn(o, key),
        std: eff.std,
        ...(eff.long ? { long: eff.long } : {}),
        builtinStd: base.std,
        ...(base.long ? { builtinLong: base.long } : {}),
      };
    });
    for (const key of Object.keys(o).filter((k) => !Object.hasOwn(BUILTIN_PRICES, k)).sort()) {
      const eff = pricing.rowOf(key);
      if (eff) models.push({ key, label: key, builtin: false, overridden: true, std: eff.std });
    }
    return { asOf: PRICES_AS_OF, models };
  }
}
