import { describe, it, expect } from 'vitest'
import { getZonedParts } from '@/app/lib/boss-assignments/season-planner/time'

describe('getZonedParts — invalid timezone hardening', () => {
  const at = new Date('2026-01-01T12:34:56.000Z')

  it('does not throw on a bogus timezone', () => {
    expect(() => getZonedParts(at, 'Not/AZone')).not.toThrow()
  })

  it('degrades a bogus timezone to UTC parts', () => {
    const bogus = getZonedParts(at, 'Definitely/Invalid')
    const utc = getZonedParts(at, 'UTC')
    expect(bogus).toEqual(utc)
    expect(bogus.hour).toBe(12)
    expect(bogus.minute).toBe(34)
  })

  it('still resolves a real zone correctly', () => {
    const ny = getZonedParts(at, 'America/New_York') // UTC-5 in January
    expect(ny.hour).toBe(7)
  })
})
