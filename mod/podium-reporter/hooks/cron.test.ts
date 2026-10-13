import { describe, test, expect } from 'claude-code/testing'
import { nextCronAt } from './cron.ts'

// Local time, so the expected values are built the same way.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('nextCronAt', () => {
  const from = at(2026, 10, 13, 13, 0)

  test('a one-shot fire time', () => {
    expect(nextCronAt('30 14 13 10 *', from)).toBe(at(2026, 10, 13, 14, 30))
  })
  test('a daily time rolls to tomorrow once it has passed', () => {
    expect(nextCronAt('0 9 * * *', from)).toBe(at(2026, 10, 14, 9, 0))
  })
  test('steps, ranges and lists', () => {
    expect(nextCronAt('*/5 * * * *', at(2026, 10, 13, 13, 2))).toBe(at(2026, 10, 13, 13, 5))
    expect(nextCronAt('0 9-17 * * *', from)).toBe(at(2026, 10, 13, 14, 0))
    expect(nextCronAt('0 9,17 * * *', from)).toBe(at(2026, 10, 13, 17, 0))
  })
  test('weekdays only', () => {
    // 2026-10-17 is a Saturday; the next weekday 9:00 is Monday the 19th.
    expect(nextCronAt('0 9 * * 1-5', at(2026, 10, 17, 10, 0))).toBe(at(2026, 10, 19, 9, 0))
  })
  test('anything it cannot read gives null, never a wrong time', () => {
    expect(nextCronAt('@daily', from)).toBeNull()
    expect(nextCronAt('0 9 * *', from)).toBeNull()
    expect(nextCronAt('61 * * * *', from)).toBeNull()
    expect(nextCronAt('*/0 * * * *', from)).toBeNull()
  })
})
