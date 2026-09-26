import { describe, expect, it } from 'vitest'
import {
  buildLeaderAnalyticsModel,
  type LeaderApiCoverageRow,
  type LeaderBattleRow,
  type LeaderGuildConfigRow,
  type LeaderPlayerMappingRow
} from '@/app/(dashboard)/leaderboards/components/leader-analytics-model'

const battle = (patch: Partial<LeaderBattleRow> = {}): LeaderBattleRow =>
  ({
    Guild: 'EOT',
    Season: 'S1',
    displayName: 'Player',
    userId: 'player-1',
    damageDealt: 100,
    damageType: 'Battle',
    tier: 4,
    set: 1,
    timestamp: '2026-08-18T10:00:00Z',
    completedOn: '2026-08-18T10:00:00Z',
    Name: 'BossA',
    rarity: 'Legendary',
    loopIndex: 2,
    remainingHp: 50,
    ...patch
  }) as LeaderBattleRow

describe('leader analytics model', () => {
  it('aggregates guild combat, player, coverage, and freshness metrics', () => {
    const model = buildLeaderAnalyticsModel({
      battles: [
        battle(),
        battle({ damageDealt: 300, remainingHp: 0 }),
        battle({ damageType: 'Bomb', damageDealt: 50, Name: 'BossB' })
      ],
      guildConfigs: [
        {
          guild_code: 'EOT',
          display_name: 'Example Guild',
          token_offender_threshold: 10,
          token_abuser_threshold: 12
        } as LeaderGuildConfigRow
      ],
      playerMappings: [
        { guild_code: 'EOT', user_id: 'user-1' } as LeaderPlayerMappingRow,
        { guild_code: 'EOT', user_id: null } as LeaderPlayerMappingRow
      ],
      apiCoverage: [
        {
          guild_code: 'EOT',
          total_players: 30,
          active_players: 25,
          players_claimed: 20,
          players_with_api_key: 24,
          coverage_percentage: 80,
          guild_api_status: 'configured'
        } as LeaderApiCoverageRow
      ],
      veteranCountByGuild: new Map([['EOT', 7]]),
      now: Date.parse('2026-08-18T11:00:00Z')
    })

    expect(model.availableBosses).toEqual(['BossA', 'BossB'])
    expect(model.guildLabels.EOT).toContain('Example Guild')
    expect(model.metrics[0]).toMatchObject({
      guild: 'EOT',
      totalDamage: 450,
      totalBattles: 2,
      avgDamagePerBattle: 225,
      bombCount: 1,
      killEfficiency: 50,
      finalLoop: 2,
      claimedProfiles: 1,
      veteranPlayers: 7,
      apiKeyStatus: 'connected',
      guildApiStatus: 'configured',
      dataFreshness: 'current'
    })
    expect(model.metrics[0]?.avgDamagePerBoss.BossA).toBe(200)
  })

  it('keeps same-name players distinct when stable ids are available', () => {
    const model = buildLeaderAnalyticsModel({
      battles: [
        battle({ userId: 'one', displayName: 'Same' }),
        battle({ userId: 'two', displayName: 'Same' }),
        battle({ userId: 'two', displayName: 'Same' })
      ],
      guildConfigs: [],
      playerMappings: [],
      apiCoverage: [],
      veteranCountByGuild: new Map()
    })

    expect(model.metrics[0]?.avgTokensPerPlayer).toBe(1.5)
  })
})
