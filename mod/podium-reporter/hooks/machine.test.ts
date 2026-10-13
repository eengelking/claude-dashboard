import { describe, test, expect } from 'claude-code/testing'
import { hostOf, isMachineId, machineInfo, newMachineId } from './machine.ts'

describe('machine', () => {
  test('the host name is the first line up to the first dot, with no control characters', () => {
    expect(hostOf('Eds-MacBook-Pro.local\n')).toBe('Eds-MacBook-Pro')
    expect(hostOf('build-01.corp.example.com')).toBe('build-01')
    expect(hostOf('  devbox  \r\nsecond line')).toBe('devbox')
    expect(hostOf('dev\u0007box')).toBe('devbox')
    expect(hostOf('x'.repeat(100))).toHaveLength(64)
  })

  test('no host name from empty or missing output', () => {
    expect(hostOf('')).toBeNull()
    expect(hostOf('   \n')).toBeNull()
    expect(hostOf('.local')).toBeNull()
    expect(hostOf(null)).toBeNull()
  })

  test('a new id is 12 hex characters and passes the check; junk does not', () => {
    let n = 0
    const id = newMachineId(() => (n++ % 16) / 16)
    expect(id).toBe('0123456789ab')
    expect(isMachineId(id)).toBe(true)
    expect(isMachineId(newMachineId(() => 0.9999999))).toBe(true)
    expect(isMachineId('short')).toBe(false)
    expect(isMachineId('ABCDEF012345')).toBe(false)
    expect(isMachineId('<script>0000')).toBe(false)
    expect(isMachineId(42)).toBe(false)
    expect(isMachineId(undefined)).toBe(false)
  })

  test('a machine with no host name is labelled by its id', () => {
    expect(machineInfo('devbox', 'abcdef012345')).toEqual({ name: 'devbox', id: 'abcdef012345' })
    expect(machineInfo(null, 'abcdef012345')).toEqual({ name: 'machine-abcd', id: 'abcdef012345' })
  })
})
