import { describe, it, expect } from 'vitest'
import { aggregateSeasonPerformance } from '@/app/lib/player-stats/aggregate-season-performance'
import type { AggregationInput } from '@/app/lib/player-stats/aggregate-season-performance'
import type {
  HistoricalDataRow,
  GuildAvgRpcRow,
  GuildScoreRpcRow
} from '@/app/lib/player-stats/types'

function makeInput(
  overrides: Partial<AggregationInput> = {}
): AggregationInput {
  return {
    seasons: ['25'],
    playerData: [],
    playerTokenData: [],
    guildAvgRpcData: [],
    additionalGuildAvgData: [],
    guildPlayerScoresData: [],
    additionalGuildScoresData: [],
    clusterAvgData: [],
    guildCode: 'GUILD1',
    resolvedPlayerId: 'player-1',
    ...overrides
  }
}

function makeRow(
  overrides: Partial<HistoricalDataRow> = {}
): HistoricalDataRow {
  return {
    Season: '25',
    displayName: 'TestPlayer',
    Name: 'Mortarion',
    damageDealt: 100000,
    remainingHp: 50000,
    maxHp: 200000,
    set: 1,
    tier: 1,
    rarity: 'Legendary',
    encounterId: 101,
    userId: 'player-1',
    Guild: 'GUILD1',
    damageType: 'Battle',
    ...overrides
  }
}

function makeGuildAvg(overrides: Partial<GuildAvgRpcRow> = {}): GuildAvgRpcRow {
  return {
    season: '25',
    boss_key: ['Mortarion', 'Legendary', '1'].join('_'),
    avg_damage: 80000,
    total_damage: 800000,
    battle_count: 10,
    ...overrides
  }
}

describe('aggregateSeasonPerformance', () => {
  describe('empty data', () => {
    it('produces zeroed entries for season with no player data', () => {
      const result = aggregateSeasonPerformance(makeInput())
      expect(result.performanceData['25']).toEqual({
        vsGuild: 0,
        vsCluster: 0,
        hasGuildComparison: false,
        bossDetails: [],
        guild: 'GUILD1'
      })
      expect(result.historicalTokens['25']).toBe(0)
      expect(result.historicalTotalDamage['25']).toBe(0)
    })
  })

  describe('single boss, single season', () => {
    it('computes positive vsGuild when player above guild average', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 120000 })],
          playerTokenData: [makeRow({ damageDealt: 120000 })],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      expect(result.performanceData['25'].vsGuild).toBeGreaterThan(0)
      expect(result.performanceData['25'].bossDetails).toHaveLength(1)
      expect(result.performanceData['25'].bossDetails![0].bossName).toBe(
        'Mortarion_Legendary_1'
      )
    })

    it('computes negative vsGuild when player below guild average', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 50000 })],
          playerTokenData: [makeRow({ damageDealt: 50000 })],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      expect(result.performanceData['25'].vsGuild).toBeLessThan(0)
    })

    it('computes exact percentage: 120k vs 80k avg = +50%', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 120000 })],
          playerTokenData: [makeRow({ damageDealt: 120000 })],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      expect(result.performanceData['25'].bossDetails![0].vsGuild).toBeCloseTo(
        50,
        1
      )
    })

    it('marks an exactly-zero comparison as real when a guild average exists', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 80000 })],
          playerTokenData: [makeRow({ damageDealt: 80000 })],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      expect(result.performanceData['25'].vsGuild).toBe(0)
      expect(result.performanceData['25'].hasGuildComparison).toBe(true)
    })

    it('marks a zero as unavailable when the guild average is missing', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 80000 })],
          playerTokenData: [makeRow({ damageDealt: 80000 })],
          guildAvgRpcData: []
        })
      )

      expect(result.performanceData['25'].vsGuild).toBe(0)
      expect(result.performanceData['25'].bossDetails).toHaveLength(1)
      expect(result.performanceData['25'].hasGuildComparison).toBe(false)
    })
  })

  describe('multiple bosses', () => {
    it('computes weighted average across bosses', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [
            makeRow({ Name: 'BossA', damageDealt: 120000 }),
            makeRow({ Name: 'BossA', damageDealt: 120000 }),
            makeRow({ Name: 'BossA', damageDealt: 120000 }),
            makeRow({ Name: 'BossB', damageDealt: 40000 })
          ],
          playerTokenData: [
            makeRow({ damageDealt: 120000 }),
            makeRow({ damageDealt: 120000 }),
            makeRow({ damageDealt: 120000 }),
            makeRow({ damageDealt: 40000 })
          ],
          guildAvgRpcData: [
            makeGuildAvg({
              boss_key: ['BossA', 'Legendary', '1'].join('_'),
              avg_damage: 80000
            }),
            makeGuildAvg({
              boss_key: ['BossB', 'Legendary', '1'].join('_'),
              avg_damage: 80000
            })
          ]
        })
      )

      expect(result.performanceData['25'].vsGuild).toBeCloseTo(25, 1)
      expect(result.performanceData['25'].bossDetails).toHaveLength(2)
    })
  })

  describe('sweep handling', () => {
    it('excludes sweep battles from non-sweep counts', () => {
      const sweepRow = makeRow({
        damageDealt: 50000,
        remainingHp: 0,
        maxHp: 200000,
        damageType: 'Battle'
      })

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [
            makeRow({ damageDealt: 100000 }), // normal battle
            sweepRow // sweep
          ],
          playerTokenData: [makeRow({ damageDealt: 100000 }), sweepRow],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      const bossDetail = result.performanceData['25'].bossDetails![0]
      expect(bossDetail.nonSweepBattleCount).toBe(1)
      expect(bossDetail.nonSweepDamage).toBe(100000)
      expect(bossDetail.sweepDamages).toEqual([50000])
    })

    // Sweeps qualify only above GREATEST(player's own non-sweep avg, reference avg).
    it('excludes a sweep above guild avg but below the player own avg (WI-1462)', () => {
      const sweepRow = makeRow({
        damageDealt: 90000,
        remainingHp: 0,
        maxHp: 200000,
        damageType: 'Battle'
      })

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 100000 }), sweepRow],
          playerTokenData: [makeRow({ damageDealt: 100000 }), sweepRow],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      const bossDetail = result.performanceData['25'].bossDetails![0]
      expect(bossDetail.battles).toBe(1)
      expect(bossDetail.vsGuild).toBeCloseTo(25, 1)
    })

    it('excludes a sweep below both the player avg and guild avg', () => {
      const sweepRow = makeRow({
        damageDealt: 50000,
        remainingHp: 0,
        maxHp: 200000,
        damageType: 'Battle'
      })

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 100000 }), sweepRow],
          playerTokenData: [makeRow({ damageDealt: 100000 }), sweepRow],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      const bossDetail = result.performanceData['25'].bossDetails![0]
      expect(bossDetail.battles).toBe(1)
      expect(bossDetail.vsGuild).toBeCloseTo(25, 1)
    })

    it('includes a sweep that clears GREATEST(player avg, guild avg)', () => {
      const sweepRow = makeRow({
        damageDealt: 90000,
        remainingHp: 0,
        maxHp: 200000,
        damageType: 'Battle'
      })

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [
            makeRow({ damageDealt: 60000 }),
            makeRow({ damageDealt: 60000 }),
            sweepRow
          ],
          playerTokenData: [
            makeRow({ damageDealt: 60000 }),
            makeRow({ damageDealt: 60000 }),
            sweepRow
          ],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 50000 })]
        })
      )

      const bossDetail = result.performanceData['25'].bossDetails![0]
      expect(bossDetail.battles).toBe(3)
      expect(bossDetail.vsGuild).toBeCloseTo(40, 1)
    })

    it('keeps the guild floor for a below-guild player (GREATEST, not pure player avg)', () => {
      // A 70k sweep beats the player avg but not the 80k guild floor, so it is excluded.
      const sweepRow = makeRow({
        damageDealt: 70000,
        remainingHp: 0,
        maxHp: 200000,
        damageType: 'Battle'
      })

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 60000 }), sweepRow],
          playerTokenData: [makeRow({ damageDealt: 60000 }), sweepRow],
          guildAvgRpcData: [makeGuildAvg({ avg_damage: 80000 })]
        })
      )

      const bossDetail = result.performanceData['25'].bossDetails![0]
      expect(bossDetail.battles).toBe(1)
      expect(bossDetail.vsGuild).toBeCloseTo(-25, 1)
    })

    it('applies the GREATEST gate on the cluster path too', () => {
      const sweepRow = makeRow({
        damageDealt: 130000,
        remainingHp: 0,
        maxHp: 500000,
        damageType: 'Battle'
      })

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [
            makeRow({ damageDealt: 120000 }),
            makeRow({ damageDealt: 120000 }),
            sweepRow
          ],
          playerTokenData: [
            makeRow({ damageDealt: 120000 }),
            makeRow({ damageDealt: 120000 }),
            sweepRow
          ],
          guildAvgRpcData: [makeGuildAvg()],
          clusterAvgData: [
            {
              Season: '25',
              boss_name: 'Mortarion',
              rarity: 'Legendary',
              set: 1,
              cluster_avg: 100000
            }
          ]
        })
      )

      const bossDetail = result.performanceData['25'].bossDetails![0]
      expect(bossDetail.vsCluster).toBeCloseTo(23.33, 1)
    })
  })

  describe('token counting', () => {
    it('counts only battles with positive damageDealt', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow()],
          playerTokenData: [
            makeRow({ damageDealt: 100000 }),
            makeRow({ damageDealt: 0 }), // excluded
            makeRow({ damageDealt: 50000 })
          ],
          guildAvgRpcData: [makeGuildAvg()]
        })
      )

      expect(result.historicalTokens['25']).toBe(2) // only 2 with positive damage
      expect(result.historicalTotalDamage['25']).toBe(75000)
    })
  })

  describe('guild transfer handling', () => {
    it('determines player guild per season from most common guild', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [
            makeRow({ Guild: 'GUILD2' }),
            makeRow({ Guild: 'GUILD2' }),
            makeRow({ Guild: 'GUILD2' }),
            makeRow({ Guild: 'GUILD1' })
          ],
          playerTokenData: [makeRow(), makeRow(), makeRow(), makeRow()],
          guildAvgRpcData: [makeGuildAvg()]
        })
      )

      expect(result.performanceData['25'].guild).toBe('GUILD2')
    })
  })

  describe('guild ranking', () => {
    it('computes guild rank from pre-computed scores', () => {
      const scores: GuildScoreRpcRow[] = [
        {
          season: '25',
          user_id: 'other-1',
          weighted_vs_guild: 50,
          battle_count: 10
        },
        {
          season: '25',
          user_id: 'player-1',
          weighted_vs_guild: 30,
          battle_count: 10
        },
        {
          season: '25',
          user_id: 'other-2',
          weighted_vs_guild: 10,
          battle_count: 10
        }
      ]

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow()],
          playerTokenData: [makeRow()],
          guildAvgRpcData: [makeGuildAvg()],
          guildPlayerScoresData: scores
        })
      )

      expect(result.performanceData['25'].guildRank).toBe(2) // 2nd highest
      expect(result.performanceData['25'].totalPlayersInGuild).toBe(3)
    })

    it('skips guild rank when no resolvedPlayerId', () => {
      const scores: GuildScoreRpcRow[] = [
        {
          season: '25',
          user_id: 'other-1',
          weighted_vs_guild: 50,
          battle_count: 10
        }
      ]

      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow()],
          playerTokenData: [makeRow()],
          guildAvgRpcData: [makeGuildAvg()],
          guildPlayerScoresData: scores,
          resolvedPlayerId: null
        })
      )

      expect(result.performanceData['25'].guildRank).toBeUndefined()
    })
  })

  describe('seasonsWithPlayerData', () => {
    it('tracks seasons from both playerData and playerTokenData', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          seasons: ['25', '24', '23'],
          playerData: [makeRow({ Season: '25' })],
          playerTokenData: [makeRow({ Season: '24' })],
          guildAvgRpcData: [makeGuildAvg({ season: '25' })]
        })
      )

      expect(result.seasonsWithPlayerData.has('25')).toBe(true)
      expect(result.seasonsWithPlayerData.has('24')).toBe(true)
      expect(result.seasonsWithPlayerData.has('23')).toBe(false)
    })
  })

  describe('cluster averages', () => {
    it('computes vsCluster when cluster data available', () => {
      const result = aggregateSeasonPerformance(
        makeInput({
          playerData: [makeRow({ damageDealt: 120000 })],
          playerTokenData: [makeRow({ damageDealt: 120000 })],
          guildAvgRpcData: [makeGuildAvg()],
          clusterAvgData: [
            {
              Season: '25',
              boss_name: 'Mortarion',
              rarity: 'Legendary',
              set: 1,
              cluster_avg: 100000
            }
          ]
        })
      )

      expect(result.performanceData['25'].vsCluster).toBeCloseTo(20, 1)
    })
  })
})
