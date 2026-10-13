import { describe, it, expect } from 'vitest';
import { BUILTIN_PRICES, Pricing, resolveModel, validatePriceSet, type ModelUsage } from './pricing.js';

const M = 1_000_000;
const use = (model: string, t: Partial<ModelUsage['tokens']>, tier: ModelUsage['tier'] = 'std'): ModelUsage => ({
  model,
  tier,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...t },
});

describe('resolveModel', () => {
  it.each([
    ['claude-sonnet-5-5', 'sonnet-5-5'],
    ['sonnet', 'sonnet-5-5'],
    ['sonnet[1m]', 'sonnet-5-5'],
    ['claude-sonnet-5', 'sonnet-5'],
    ['claude-sonnet-4-6', 'sonnet-4'],
    ['claude-opus-5-5', 'opus-5-5'],
    ['opus', 'opus-5-5'],
    ['claude-opus-5', 'opus-5'],
    ['claude-opus-4-8', 'opus-5'],
    ['claude-opus-4-1-20250805', 'opus-4-1'],
    ['claude-haiku-5-5', 'haiku-5-5'],
    ['claude-haiku-4-5', 'haiku-4-5'],
    ['claude-haiku-3-5', 'haiku-3-5'],
    ['claude-fable-5-1', 'fable-5-1'],
    ['claude-fable-5', 'fable-5'],
    ['fable', 'fable-5-1'],
  ])('%s -> %s', (id, key) => {
    expect(resolveModel(id, {})).toBe(key);
  });

  it('a non-Claude model resolves to nothing until the Admin prices it', () => {
    expect(resolveModel('llama3.1:8b', {})).toBeNull();
    expect(resolveModel('llama3.1:8b', { 'llama3.1:8b': { std: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } } })).toBe('llama3.1:8b');
  });
});

describe('built-in table (platform.claude.com pricing sheet, 2026-10-13)', () => {
  it('Sonnet 5.5', () => {
    expect(BUILTIN_PRICES['sonnet-5-5']!.std).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 });
  });
  it('Haiku 5.5 has a long-prompt tier', () => {
    expect(BUILTIN_PRICES['haiku-5-5']!.std).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2 });
    expect(BUILTIN_PRICES['haiku-5-5']!.long).toEqual({ input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1 });
  });
  it('only Haiku 5.5 has a long tier', () => {
    expect(Object.entries(BUILTIN_PRICES).filter(([, p]) => p.long).map(([k]) => k)).toEqual(['haiku-5-5']);
  });
});

describe('Pricing.costOf', () => {
  it('prices each token kind per million', () => {
    const p = new Pricing({});
    const usd = p.costOf([use('claude-sonnet-5-5', { input: M, output: M, cacheRead: M, cacheWrite: M, cacheWrite1h: M })]);
    expect(usd).toBeCloseTo(2 + 10 + 0.1 + 2.5 + 4, 9);
  });

  it('sums several models', () => {
    const p = new Pricing({});
    const usd = p.costOf([use('claude-sonnet-5-5', { input: M }), use('claude-haiku-4-5', { output: M })]);
    expect(usd).toBeCloseTo(2 + 5, 9);
  });

  it('uses the long tier for a prompt over 100k, std otherwise', () => {
    const p = new Pricing({});
    expect(p.costOf([use('claude-haiku-5-5', { input: M }, 'std')])).toBeCloseTo(0.1, 9);
    expect(p.costOf([use('claude-haiku-5-5', { input: M }, 'long')])).toBeCloseTo(0.5, 9);
  });

  it('a model with no long tier prices a long request at std', () => {
    expect(new Pricing({}).costOf([use('claude-sonnet-5-5', { input: M }, 'long')])).toBeCloseTo(2, 9);
  });

  it('an Admin price beats the built-in one, and only for the fields it sets', () => {
    const p = new Pricing({ 'sonnet-5-5': { std: { input: 3, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite1h: 4 } } });
    expect(p.costOf([use('claude-sonnet-5-5', { input: M })])).toBeCloseTo(3, 9);
    expect(p.costOf([use('claude-opus-5-5', { input: M })])).toBeCloseTo(4, 9);
  });

  it('an Admin override of only the long tier leaves std built-in', () => {
    const p = new Pricing({ 'haiku-5-5': { long: { input: 1, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1 } } });
    expect(p.costOf([use('claude-haiku-5-5', { input: M }, 'std')])).toBeCloseTo(0.1, 9);
    expect(p.costOf([use('claude-haiku-5-5', { input: M }, 'long')])).toBeCloseTo(1, 9);
  });

  it('is null when a model has no price, and priced once the Admin adds one', () => {
    expect(new Pricing({}).costOf([use('llama3.1:8b', { input: M })])).toBeNull();
    const p = new Pricing({ 'llama3.1:8b': { std: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } } });
    expect(p.costOf([use('llama3.1:8b', { input: M, output: M })])).toBeCloseTo(3, 9);
  });

  it('a session mixing a priced and an unpriced model is priced for the models that have a price', () => {
    const usd = new Pricing({}).costOf([use('claude-sonnet-5-5', { input: M }), use('llama3.1:8b', { input: M })]);
    expect(usd).toBeCloseTo(2, 9);
  });

  it('inherited object names are not models', () => {
    expect(resolveModel('constructor', {})).toBeNull();
    expect(new Pricing({}).costOf([use('valueof', { input: M })])).toBeNull();
  });

  it('zero tokens of an unpriced model do not make the total null', () => {
    expect(new Pricing({}).costOf([use('claude-sonnet-5-5', { input: M }), use('llama3.1:8b', {})])).toBeCloseTo(2, 9);
  });

  it('an empty usage list is 0', () => {
    expect(new Pricing({}).costOf([])).toBe(0);
  });
});

describe('validatePriceSet', () => {
  const ok = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 };
  it('accepts zero or more finite numbers', () => {
    expect(validatePriceSet(ok)).toBeNull();
    expect(validatePriceSet({ ...ok, input: 0 })).toBeNull();
  });
  it.each([
    ['negative', { ...ok, input: -1 }],
    ['NaN', { ...ok, output: NaN }],
    ['Infinity', { ...ok, cacheRead: Infinity }],
    ['string', { ...ok, cacheWrite: '2' }],
    ['over the upper bound', { ...ok, output: 1001 }],
    ['missing field', { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }],
  ])('rejects %s with a message naming the field', (_n, v) => {
    expect(validatePriceSet(v)).toMatch(/\w/);
  });
});
