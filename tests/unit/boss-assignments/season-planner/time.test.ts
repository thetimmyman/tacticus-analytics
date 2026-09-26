import { describe, expect, it } from 'vitest'
import {
  getZonedParts,
  normalizeTimeZone,
  zonedTimeToUtc
} from '@/app/lib/boss-assignments/season-planner/time'

describe('season planner time helpers', () => {
  it('normalizes time zones', () => {
    expect(normalizeTimeZone()).toBe('UTC')
    expect(normalizeTimeZone('')).toBe('UTC')
    expect(normalizeTimeZone('GMT')).toBe('UTC')
    expect(normalizeTimeZone('utc')).toBe('UTC')
    expect(normalizeTimeZone('America/New_York')).toBe('America/New_York')
  })

  it('extracts zoned parts for UTC', () => {
    const date = new Date('2025-01-02T03:04:05.000Z')
    const parts = getZonedParts(date, 'UTC')
    expect(parts).toEqual({
      year: 2025,
      month: 1,
      day: 2,
      hour: 3,
      minute: 4,
      second: 5
    })
  })

  it('converts local time to UTC for UTC zone', () => {
    const utc = zonedTimeToUtc(
      { year: 2025, month: 1, day: 2, hour: 3, minute: 4, second: 5 },
      'UTC'
    )
    expect(utc.toISOString()).toBe('2025-01-02T03:04:05.000Z')
  })
})
