import { describe, expect, it } from 'vitest'
import { isWarZoneCaptured } from '@/app/lib/war/war-zone-captured'

describe('isWarZoneCaptured', () => {
  it('treats an explicit loss as not captured', () => {
    expect(isWarZoneCaptured('loss', null)).toBe(false)
  })

  it('rejects Loki win labels when any defender still has HP', () => {
    expect(
      isWarZoneCaptured('win', [
        { remainingHPAfter: 0 },
        { remainingHPAfter: 25 }
      ])
    ).toBe(false)
    expect(isWarZoneCaptured('win', [{ remainingHPAfter: '25' }])).toBe(false)
  })

  it('matches the database fallback when no surviving defender is present', () => {
    expect(isWarZoneCaptured('win', [{ remainingHPAfter: 0 }, {}])).toBe(true)
    expect(isWarZoneCaptured(null, null)).toBe(true)
  })
})
