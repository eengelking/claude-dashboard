import { describe, test, expect } from 'claude-code/testing'
import { costOf, family, PRICES_AS_OF, priceOf, shortName, windowOf } from './models.ts'

describe('models', () => {
  test('maps aliases and full ids to families', () => {
    expect(family('opus')).toBe('opus')
    expect(family('claude-opus-5-5')).toBe('opus')
    expect(family('sonnet')).toBe('sonnet')
    expect(family('claude-sonnet-5-5')).toBe('sonnet')
    expect(family('haiku')).toBe('haiku')
    expect(family('FABLE')).toBe('fable')
    expect(family('gpt-x')).toBe('other')
    expect(family(null)).toBe('other')
  })

  test('windows: 1M for current models, 200K for Haiku 4.5', () => {
    expect(windowOf('claude-opus-5-5')).toBe(1_000_000)
    expect(windowOf('haiku')).toBe(1_000_000)
    expect(windowOf('claude-haiku-5-5')).toBe(1_000_000)
    expect(windowOf('claude-haiku-4-5')).toBe(200_000)
  })

  test('prices per family and for older ids, dated', () => {
    expect(PRICES_AS_OF).toBe('2026-10-06')
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })
    expect(priceOf('opus')).toEqual(priceOf('claude-opus-5-5'))
    expect(priceOf('claude-opus-5').input).toBe(5)
    expect(priceOf('claude-sonnet-5-5').input).toBe(2)
    expect(priceOf('claude-haiku-5-5').output).toBe(0.5)
    expect(priceOf('claude-haiku-4-5').input).toBe(1)
    expect(priceOf('claude-fable-5-1')).toEqual({ input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 })
    expect(priceOf('fable')).toEqual(priceOf('claude-fable-5-1'))
  })

  test('cost is the sum of tokens times price over a million', () => {
    expect(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, 'opus')).toBe(4 + 20 + 0.2 + 5)
    expect(shortName('claude-sonnet-5-5')).toBe('Sonnet')
    expect(shortName('mystery')).toBe('mystery')
  })
})
