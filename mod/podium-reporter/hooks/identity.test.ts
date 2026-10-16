import { describe, test, expect } from 'claude-code/testing'
import { pickIdentity, worthHolding } from './identity.ts'

const admin = { userName: '', token: 'admin-secret' }
const ed = { userName: 'Ed', token: 'ed-token' }

describe('which Podium identity a session reports as (#226)', () => {
  test('a session already reporting keeps its identity when the shared settings change under it', () => {
    // Claude Code reloads every session's module when a plugin option changes, so the settings now say Ed.
    expect(pickIdentity({ held: admin, env: {}, options: ed })).toEqual(admin)
  })

  test('a session with no identity yet takes the terminal environment ahead of the shared settings', () => {
    expect(pickIdentity({ held: undefined, env: { user: 'Ed', token: 'ed-token' }, options: admin })).toEqual(ed)
  })

  test('the shared settings apply when the terminal sets nothing', () => {
    expect(pickIdentity({ held: undefined, env: {}, options: ed })).toEqual(ed)
  })

  test('a name without a token, or a token without a name, is taken as given, not mixed with the settings', () => {
    expect(pickIdentity({ held: undefined, env: { user: 'Ed' }, options: { userName: 'Dana', token: 'dana-token' } })).toEqual({ userName: 'Ed', token: '' })
  })

  test('an identity without a token is not held, so a token added later still applies', () => {
    expect(pickIdentity({ held: { userName: 'Ed', token: '' }, env: {}, options: ed })).toEqual(ed)
    expect(worthHolding({ userName: 'Ed', token: '' })).toBe(false)
    expect(worthHolding(ed)).toBe(true)
  })

  test('a stray newline or space around the terminal token is dropped', () => {
    expect(pickIdentity({ held: undefined, env: { user: ' Ed ', token: 'ed-token\n' }, options: admin })).toEqual(ed)
  })
})
