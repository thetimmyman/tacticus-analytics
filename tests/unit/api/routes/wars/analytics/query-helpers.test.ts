import { describe, expect, it } from 'vitest'

import { parseGuildWarAnalyticsQuery } from '@/app/api/wars/analytics/_query-helpers'

describe('parseGuildWarAnalyticsQuery', () => {
  it('uses the shared side and season defaults with route-specific limits', () => {
    expect(
      parseGuildWarAnalyticsQuery(new URLSearchParams(), { limit: 50 })
    ).toEqual({
      side: 'offense',
      limit: 50,
      seasonCount: 4
    })

    expect(
      parseGuildWarAnalyticsQuery(new URLSearchParams(), { limit: 20 })
    ).toEqual({
      side: 'offense',
      limit: 20,
      seasonCount: 4
    })
  })

  it('parses valid side, limit, season_count, and min_uses values', () => {
    const params = new URLSearchParams(
      'side=defense&limit=5&season_count=2&min_uses=3'
    )

    expect(
      parseGuildWarAnalyticsQuery(params, { limit: 20, minUses: 5 })
    ).toEqual({
      side: 'defense',
      limit: 5,
      seasonCount: 2,
      minUses: 3
    })
  })

  it('preserves existing parseInt behavior for malformed numeric params', () => {
    const params = new URLSearchParams('limit=abc&season_count=12abc&min_uses=')
    const parsed = parseGuildWarAnalyticsQuery(params, {
      limit: 20,
      minUses: 5
    })

    expect(Number.isNaN(parsed.limit)).toBe(true)
    expect(parsed.seasonCount).toBe(12)
    expect(parsed.minUses).toBe(5)
  })

  it('throws the existing route error for invalid side values', () => {
    expect(() =>
      parseGuildWarAnalyticsQuery(new URLSearchParams('side=invalid'), {
        limit: 20
      })
    ).toThrow('side must be offense or defense')
  })

  it('parses repeated and comma-separated global meta filters', () => {
    const params = new URLSearchParams(
      'seasons=26,25&seasons=24&battlefield_levels=5,4'
    )

    expect(parseGuildWarAnalyticsQuery(params, { limit: 100 })).toMatchObject({
      seasons: [26, 25, 24],
      battlefieldLevels: [5, 4]
    })
  })

  it('rejects invalid seasons and battlefield tiers', () => {
    expect(() =>
      parseGuildWarAnalyticsQuery(new URLSearchParams('seasons=latest'), {
        limit: 100
      })
    ).toThrow('seasons must contain integers')
    expect(() =>
      parseGuildWarAnalyticsQuery(new URLSearchParams('battlefield_levels=6'), {
        limit: 100
      })
    ).toThrow('battlefield_levels must be between 1 and 5')
  })
})
