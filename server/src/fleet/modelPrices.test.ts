import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from './db.js';
import { ModelPriceStore } from './modelPrices.js';
import { BUILTIN_PRICES, type ModelUsage } from './pricing.js';

const M = 1_000_000;
const S = { input: 3, output: 12, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 };
const usage = (model: string, input: number, tier: ModelUsage['tier'] = 'std'): ModelUsage => ({
  model,
  tier,
  tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
});

let db: ReturnType<typeof openDb>;
let changed: ReturnType<typeof vi.fn>;
let store: ModelPriceStore;
beforeEach(() => {
  db = openDb(':memory:');
  changed = vi.fn();
  store = new ModelPriceStore(db, changed);
});

describe('ModelPriceStore', () => {
  it('starts with the built-in prices and nothing overridden', () => {
    expect(store.overrides()).toEqual({});
    expect(store.pricing().costOf([usage('claude-sonnet-5-5', M)])).toBeCloseTo(2, 9);
  });

  it('a saved price applies at once, fires onChange, and survives a restart', () => {
    expect(store.set('sonnet-5-5', { std: S })).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.pricing().costOf([usage('claude-sonnet-5-5', M)])).toBeCloseTo(3, 9);
    const reopened = new ModelPriceStore(db);
    expect(reopened.pricing().costOf([usage('claude-sonnet-5-5', M)])).toBeCloseTo(3, 9);
  });

  it('saving the built-in values again stores no override', () => {
    expect(store.set('sonnet-5-5', { std: BUILTIN_PRICES['sonnet-5-5']!.std })).toBeNull();
    expect(store.overrides()).toEqual({});
    expect(changed).not.toHaveBeenCalled();
  });

  it('reset brings the built-in price back', () => {
    store.set('sonnet-5-5', { std: S });
    store.reset('sonnet-5-5');
    expect(store.overrides()).toEqual({});
    expect(store.pricing().costOf([usage('claude-sonnet-5-5', M)])).toBeCloseTo(2, 9);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('resetting a row that is not overridden changes nothing', () => {
    store.reset('sonnet-5-5');
    expect(changed).not.toHaveBeenCalled();
  });

  it('a model the Admin adds is priced, and a non-Claude one stops reading n/a', () => {
    expect(store.pricing().costOf([usage('my-local-model', M)])).toBeNull();
    expect(store.set('My-Local-Model', { std: S })).toBeNull();
    expect(store.pricing().costOf([usage('my-local-model', M)])).toBeCloseTo(3, 9);
  });

  it('the long tier can be set on a model that has one', () => {
    expect(store.set('haiku-5-5', { std: BUILTIN_PRICES['haiku-5-5']!.std, long: { ...S, input: 2 } })).toBeNull();
    expect(store.pricing().costOf([usage('claude-haiku-5-5', M, 'long')])).toBeCloseTo(2, 9);
    expect(store.pricing().costOf([usage('claude-haiku-5-5', M, 'std')])).toBeCloseTo(0.1, 9);
  });

  it.each([
    ['a negative price', 'sonnet-5-5', { std: { ...S, input: -1 } }],
    ['a non-number', 'sonnet-5-5', { std: { ...S, output: '1' } }],
    ['Infinity', 'sonnet-5-5', { std: { ...S, cacheRead: Infinity } }],
    ['a price over the bound', 'sonnet-5-5', { std: { ...S, output: 5000 } }],
    ['a missing std', 'sonnet-5-5', {}],
    ['an empty model id', '  ', { std: S }],
    ['a model id over 120 characters', 'x'.repeat(121), { std: S }],
    ['a long tier on a model with none', 'sonnet-5-5', { std: S, long: S }],
  ])('rejects %s with a message and stores nothing', (_n, key, body) => {
    const err = store.set(key, body as never);
    expect(err).toMatch(/\w/);
    expect(store.overrides()).toEqual({});
    expect(changed).not.toHaveBeenCalled();
  });

  it('limits how many models the Admin can add', () => {
    for (let i = 0; i < 100; i++) expect(store.set(`custom-${i}`, { std: S })).toBeNull();
    expect(store.set('custom-100', { std: S })).toMatch(/at most 100/);
  });

  it('treats inherited object names as ordinary model ids, and refuses __proto__', () => {
    expect(store.set('constructor', { std: S })).toBeNull();
    expect(store.pricing().costOf([usage('constructor', M)])).toBeCloseTo(3, 9);
    expect(store.set('__proto__', { std: S })).toMatch(/\w/);
  });

  it('resetting an inherited object name that was never saved changes nothing', () => {
    store.reset('toString');
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not read the settings table again for each price lookup', () => {
    const get = vi.spyOn(db, 'prepare');
    store.pricing();
    store.pricing();
    store.overrides();
    expect(get.mock.calls.filter((c) => String(c[0]).includes('FROM settings')).length).toBeLessThanOrEqual(1);
  });

  it('ignores a corrupt stored value instead of failing', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('model_prices', '{not json')").run();
    expect(new ModelPriceStore(db).overrides()).toEqual({});
  });

  it('the view lists every built-in row with its effective price, and the Admin-added ones', () => {
    store.set('sonnet-5-5', { std: S });
    store.set('my-local-model', { std: S });
    const v = store.view();
    const sonnet = v.models.find((m) => m.key === 'sonnet-5-5')!;
    expect(sonnet).toMatchObject({ builtin: true, overridden: true, std: S, builtinStd: BUILTIN_PRICES['sonnet-5-5']!.std });
    expect(sonnet.long).toBeUndefined();
    const haiku = v.models.find((m) => m.key === 'haiku-5-5')!;
    expect(haiku).toMatchObject({ builtin: true, overridden: false, long: BUILTIN_PRICES['haiku-5-5']!.long });
    expect(v.models.find((m) => m.key === 'my-local-model')).toMatchObject({ builtin: false, overridden: true, std: S });
    expect(v.models.filter((m) => m.builtin).map((m) => m.key)).toEqual(Object.keys(BUILTIN_PRICES));
    expect(v.asOf).toBe('2026-10-13');
  });
});
