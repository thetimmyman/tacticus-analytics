import { describe, expect, it } from 'vitest'
import { formatCountdown, getCountdown } from '@/app/lib/war/timing/countdown'

describe('getCountdown', () => {
  it('returns a breakdown of the remaining time', () => {
    const now = new Date('2025-01-01T00:00:00Z')
    const target = new Date('2025-01-02T02:03:04Z')
    const countdown = getCountdown(target, now)

    expect(countdown).toMatchObject({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      isExpired: false
    })
  })

  it('flags expired countdowns', () => {
    const now = new Date('2025-01-02T00:00:00Z')
    const target = new Date('2025-01-01T00:00:00Z')
    const countdown = getCountdown(target, now)
    expect(countdown.isExpired).toBe(true)
    expect(countdown.days).toBe(0)
    expect(countdown.hours).toBe(0)
    expect(countdown.minutes).toBe(0)
    expect(countdown.seconds).toBe(0)
  })
})

describe('formatCountdown', () => {
  it('formats countdown values for display', () => {
    const now = new Date('2025-01-01T00:00:00Z')
    const target = new Date('2025-01-02T02:03:04Z')
    const countdown = getCountdown(target, now)
    expect(formatCountdown(countdown)).toBe('1d 2h 3m 4s')
  })

  it('returns a minimal format for expired countdowns', () => {
    const now = new Date('2025-01-02T00:00:00Z')
    const target = new Date('2025-01-01T00:00:00Z')
    expect(formatCountdown(getCountdown(target, now))).toBe('0s')
  })
})
