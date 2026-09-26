import { describe, it, expect } from 'vitest'
import { pickSessionTemplates } from '@/app/lib/boss-assignments/season-planner/sessions'
import type { AvailabilityWindow } from '@/app/lib/boss-assignments/season-planner/availability'

const window = (hour: number, probability: number): AvailabilityWindow => ({
  hour,
  daysWithActivity: probability > 0 ? 1 : 0,
  probability
})

const allZeroWindows = (): AvailabilityWindow[] =>
  Array.from({ length: 24 }, (_, hour) => window(hour, 0))

describe('pickSessionTemplates — zero-history fallback', () => {
  it('falls back to DEFAULT_SESSION_HOURS when every window is zero-probability', () => {
    const picked = pickSessionTemplates({
      windows: allZeroWindows(),
      maxPerDay: 3
    })
    expect(picked.map((p) => p.hour)).toEqual([18, 6, 12])
    expect(picked.every((p) => p.probability === 0)).toBe(true)
  })

  it('does NOT schedule a zero-history player at 00:00', () => {
    const picked = pickSessionTemplates({
      windows: allZeroWindows(),
      maxPerDay: 1
    })
    expect(picked).toHaveLength(1)
    expect(picked[0]!.hour).toBe(18)
    expect(picked[0]!.hour).not.toBe(0)
  })

  it('respects maxPerDay for the fallback', () => {
    const picked = pickSessionTemplates({
      windows: allZeroWindows(),
      maxPerDay: 2
    })
    expect(picked.map((p) => p.hour)).toEqual([18, 6])
  })

  it('falls back when there are no windows at all', () => {
    const picked = pickSessionTemplates({ windows: [], maxPerDay: 2 })
    expect(picked.map((p) => p.hour)).toEqual([18, 6])
  })
})

describe('pickSessionTemplates — players with history are unchanged', () => {
  it('keeps inferred windows (highest-probability first, hour tiebreak) when signal exists', () => {
    const windows: AvailabilityWindow[] = [
      window(0, 0),
      window(9, 0.8),
      window(21, 0.9),
      window(14, 0.9)
    ]
    const picked = pickSessionTemplates({ windows, maxPerDay: 2 })
    expect(picked.map((p) => p.hour)).toEqual([14, 21])
    expect(picked[0]!.probability).toBe(0.9)
  })

  it('still returns a single real window over the fallback', () => {
    const windows: AvailabilityWindow[] = [window(0, 0), window(7, 0.5)]
    const picked = pickSessionTemplates({ windows, maxPerDay: 3 })
    expect(picked[0]!.hour).toBe(7)
    expect(picked.some((p) => p.probability > 0)).toBe(true)
  })
})
