import { describe, expect, it } from 'vitest'
import { inferHourlyAvailability } from '@/app/lib/boss-assignments/season-planner/availability'

describe('season planner availability inference', () => {
  it('counts unique activity days per hour', () => {
    const result = inferHourlyAvailability({
      timeZone: 'UTC',
      observedDays: 4,
      eventTimestamps: [
        '2025-01-01T10:00:00.000Z',
        '2025-01-01T10:30:00.000Z',
        '2025-01-03T10:00:00.000Z',
        '2025-01-03T11:00:00.000Z'
      ]
    })

    const hour10 = result.windows.find((w) => w.hour === 10)
    const hour11 = result.windows.find((w) => w.hour === 11)
    expect(hour10).toEqual({ hour: 10, daysWithActivity: 2, probability: 0.5 })
    expect(hour11).toEqual({ hour: 11, daysWithActivity: 1, probability: 0.25 })
  })
})
