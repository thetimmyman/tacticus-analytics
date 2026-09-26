import { describe, expect, it } from 'vitest'
import {
  buildGwSeasonsToTry,
  isPersistableGuildRanking
} from '@tacticus/app-core/gw-ranking-policy'
import {
  buildGwSeasonsToTry as buildEdgeGwSeasonsToTry,
  isPersistableGuildRanking as isEdgePersistableGuildRanking,
  MAX_VALID_GUILD_RANKING as EDGE_MAX_VALID_GUILD_RANKING
} from '../../../supabase/functions/_shared/gw-ranking-policy'
import { MAX_VALID_GUILD_RANKING } from '@tacticus/app-core/gw-ranking-policy'

describe('Guild War ranking policy', () => {
  it('probes the calendar newest-first and uses cache only as a fallback', () => {
    expect(buildGwSeasonsToTry(25, 22)).toEqual([25, 24, 22, 23, 26])
    expect(buildGwSeasonsToTry(2, null)).toEqual([2, 1, 3])
  })

  it('rejects missing, non-positive, and day-off garbage rankings', () => {
    expect(isPersistableGuildRanking(null)).toBe(false)
    expect(isPersistableGuildRanking(0)).toBe(false)
    expect(isPersistableGuildRanking(10_000)).toBe(true)
    expect(isPersistableGuildRanking(10_001)).toBe(false)
  })

  it('keeps the deployable edge copy in parity with app-core', () => {
    expect(EDGE_MAX_VALID_GUILD_RANKING).toBe(MAX_VALID_GUILD_RANKING)
    for (const [nowSeason, cachedSeason] of [
      [25, 22],
      [2, null],
      [1, 1]
    ] as const) {
      expect(buildEdgeGwSeasonsToTry(nowSeason, cachedSeason)).toEqual(
        buildGwSeasonsToTry(nowSeason, cachedSeason)
      )
    }
    for (const ranking of [null, 0, 1, 10_000, 10_001]) {
      expect(isEdgePersistableGuildRanking(ranking)).toBe(
        isPersistableGuildRanking(ranking)
      )
    }
  })
})
