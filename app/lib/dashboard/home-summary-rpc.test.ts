import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  serviceDb: vi.fn(),
  getTokenUsage: vi.fn(),
  getTokenUsageOverlay: vi.fn(),
  getPlayerPerformanceSummaryRPC: vi.fn(),
  recordCalculationMetric: vi.fn(),
  getCurrentBossStatus: vi.fn(),
  getGuildSeasonSummary: vi.fn(),
  getCachedPlayerSummary: vi.fn(),
  ensureRotationSnapshot: vi.fn(),
  getAllBossHp: vi.fn(),
  getActiveProgressionConfig: vi.fn(),
  getSkippedPrimeEncounters: vi.fn(),
  getLatestSeason: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  db: mocks.db,
  serviceDb: mocks.serviceDb
}))
vi.mock('@/app/lib/data/token-usage', () => ({
  getTokenUsage: mocks.getTokenUsage
}))
vi.mock('@/app/lib/data/token-usage-overlay', () => ({
  getTokenUsageOverlay: mocks.getTokenUsageOverlay
}))
vi.mock(
  '@/app/lib/calculations/experimental/player-performance-summary',
  () => ({
    getPlayerPerformanceSummaryRPC: mocks.getPlayerPerformanceSummaryRPC
  })
)
vi.mock('@/app/lib/calculations/metrics', () => ({
  recordCalculationMetric: mocks.recordCalculationMetric
}))
vi.mock('@/app/lib/data/boss-status', () => ({
  getCurrentBossStatus: mocks.getCurrentBossStatus
}))
vi.mock('@/app/lib/data/guild-season-summary', () => ({
  getGuildSeasonSummary: mocks.getGuildSeasonSummary
}))
vi.mock('@/app/lib/dashboard/cached-widgets', () => ({
  getCachedPlayerSummary: mocks.getCachedPlayerSummary
}))
vi.mock('@/app/lib/loki/rotation-cache', () => ({
  ensureRotationSnapshot: mocks.ensureRotationSnapshot
}))
vi.mock('@/app/lib/data/boss-hp', () => ({
  getAllBossHp: mocks.getAllBossHp
}))
vi.mock('@/app/lib/boss-assignments/progression-config', () => ({
  getActiveProgressionConfig: mocks.getActiveProgressionConfig
}))
vi.mock('@/app/lib/dashboard/skipped-primes', () => ({
  getSkippedPrimeEncounters: mocks.getSkippedPrimeEncounters
}))
vi.mock('@/app/lib/data/get-latest-season', () => ({
  getLatestSeason: mocks.getLatestSeason
}))

import { getLandingPageRpcData } from './home-summary-rpc'

describe('getLandingPageRpcData progression degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.db.mockResolvedValue({})

    const guildConfigQuery: Record<string, unknown> = {}
    guildConfigQuery.select = vi.fn(() => guildConfigQuery)
    guildConfigQuery.eq = vi.fn(() => guildConfigQuery)
    guildConfigQuery.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        GR_Ranking: 1,
        GW_Ranking: 2,
        display_name: 'Test Guild',
        guild_tag: 'TEST'
      },
      error: null
    })
    mocks.serviceDb.mockReturnValue({ from: vi.fn(() => guildConfigQuery) })

    mocks.getTokenUsage.mockResolvedValue([
      {
        player_id: 'u1',
        display_name: 'Player One',
        tokens_used: 3,
        max_possible: 6
      }
    ])
    mocks.getTokenUsageOverlay.mockResolvedValue([])
    mocks.getPlayerPerformanceSummaryRPC.mockResolvedValue([])
    mocks.getGuildSeasonSummary.mockResolvedValue({
      recent_activity: 0,
      total_damage: 0,
      total_battles: 0,
      max_hit: 0,
      boss_kills: 0,
      avg_damage_per_hour: null
    })
    mocks.getCachedPlayerSummary.mockResolvedValue(null)
    mocks.getCurrentBossStatus.mockResolvedValue([
      {
        boss_name: 'Szarekh',
        rarity: 'Legendary',
        set: 2,
        encounter_id: 0,
        max_hp: 1000,
        remaining_hp: 0,
        loop_index: 0,
        completed_on: '2026-08-24T12:00:00Z'
      }
    ])
    mocks.ensureRotationSnapshot.mockResolvedValue({ currentBosses: [] })
    mocks.getAllBossHp.mockResolvedValue({
      legendary: {},
      mythic: {},
      primes: {},
      byBossName: {}
    })
    mocks.getActiveProgressionConfig.mockRejectedValue(
      new Error('No captured progression config')
    )
    mocks.getSkippedPrimeEncounters.mockResolvedValue(new Set())
  })

  it('keeps unrelated home data and observed boss state when config is missing', async () => {
    const result = await getLandingPageRpcData(
      {
        guild_code: 'TEST',
        user_id: 'u1',
        display_name: 'Player One',
        cluster_code: null,
        api_key_last_verified: null
      } as never,
      '104'
    )

    expect(mocks.getActiveProgressionConfig).toHaveBeenCalledWith('TEST', 104)
    expect(result.guildName).toContain('Test Guild')
    expect(result.currentBoss).toEqual(
      expect.objectContaining({
        name: 'Szarekh',
        levelCode: 'L3',
        maxHp: 1000,
        remainingHp: 0,
        hpPercentage: 0
      })
    )
    expect(mocks.recordCalculationMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'home-rpc.getActiveProgressionConfig',
        success: false
      })
    )
  })
})
