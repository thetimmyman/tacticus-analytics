import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { UserDataContext } from '@/app/lib/utils/data-access'
import { useOverallLeaderboardData } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/useOverallLeaderboardData'

const dependencies = vi.hoisted(() => ({
  dbClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  guildIn: vi.fn(),
  tokenRpc: vi.fn(),
  overallRpc: vi.fn(),
  historicalRpc: vi.fn(),
  metric: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: dependencies.dbClient
}))

vi.mock(
  '@/app/lib/calculations/experimental/cluster-overall-leaderboard',
  () => ({
    getClusterOverallLeaderboardRPC: dependencies.overallRpc,
    getClusterHistoricalRankingsRPC: dependencies.historicalRpc
  })
)

vi.mock('@/app/lib/calculations/metrics', () => ({
  recordCalculationMetric: dependencies.metric
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    error: dependencies.loggerError,
    warn: dependencies.loggerWarn
  })
}))

const CONTEXT: UserDataContext = {
  clusterCode: 'C1',
  guildCode: 'AAA',
  guildLabel: 'Alpha Guild',
  hasClusterAccess: true,
  hasGuildAccess: true,
  accessLevel: 'cluster'
}

describe('useOverallLeaderboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dependencies.dbClient.mockImplementation(() => ({
      rpc: dependencies.tokenRpc,
      from: dependencies.from
    }))
    dependencies.from.mockReturnValue({ select: dependencies.select })
    dependencies.select.mockReturnValue({ in: dependencies.guildIn })
    dependencies.guildIn.mockResolvedValue({
      data: [
        {
          guild_code: 'AAA',
          guild_tag: 'TAG',
          display_name: 'Alpha Guild'
        }
      ]
    })
    dependencies.tokenRpc.mockResolvedValue({
      data: [
        {
          context: 'cluster',
          guild_code: 'AAA',
          cluster_code: 'C1',
          season: 106,
          players: []
        }
      ],
      error: null
    })
    dependencies.overallRpc.mockResolvedValue([
      {
        stable_key: 'alpha-key',
        display_name: 'Alpha',
        guild: 'AAA',
        user_id: 'alpha-id',
        total_damage: 1_500_000,
        battle_count: 10,
        avg_damage: 150_000,
        bombs_used: 2,
        bosses_killed: 3,
        all_battle_count: 12,
        all_bosses_killed: 4,
        percent_vs_cluster: 10,
        current_rank: 2
      }
    ])
    dependencies.historicalRpc.mockResolvedValue([
      {
        season: '105',
        stable_key: 'alpha-key',
        display_name: 'Alpha',
        guild: 'AAA',
        percent_vs_cluster: 9,
        season_rank: 5
      }
    ])
  })

  it('loads current, historical, token, and guild-label data and records success', async () => {
    const onPlayersLoaded = vi.fn()
    const { result } = renderHook(() =>
      useOverallLeaderboardData({
        season: '106',
        userGuild: 'AAA',
        context: CONTEXT,
        contextLoading: false,
        onPlayersLoaded
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.rpcTokenStats).toHaveLength(1))
    await waitFor(() =>
      expect(result.current.guildLabels).toEqual({ AAA: 'Alpha Guild' })
    )

    expect(result.current.players[0]).toMatchObject({
      displayName: 'Alpha',
      priorSeasonRank: 5,
      rankChange: 3,
      fiveSeasonAvgRank: 5
    })
    expect(result.current.uniqueGuilds).toEqual(['AAA'])
    expect(dependencies.overallRpc).toHaveBeenCalledWith(expect.anything(), {
      Season: '106',
      clusterCode: 'C1'
    })
    expect(dependencies.historicalRpc).toHaveBeenCalledWith(expect.anything(), {
      seasons: ['105', '104', '103', '102', '101'],
      clusterCode: 'C1'
    })
    expect(dependencies.tokenRpc).toHaveBeenCalledWith(
      'get_season_token_stats',
      {
        p_guild_code: 'AAA',
        p_season: 106,
        p_include_cluster: true
      }
    )
    expect(onPlayersLoaded).toHaveBeenCalledOnce()
    expect(dependencies.metric).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cluster_overall_leaderboard',
        success: true,
        source: 'rpc',
        filterCount: 1
      })
    )
  })

  it('keeps the original fail-closed empty state when the primary RPC fails', async () => {
    dependencies.overallRpc.mockRejectedValue(new Error('RPC unavailable'))
    const onPlayersLoaded = vi.fn()
    const { result } = renderHook(() =>
      useOverallLeaderboardData({
        season: '106',
        userGuild: 'AAA',
        context: CONTEXT,
        contextLoading: false,
        onPlayersLoaded
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.players).toEqual([])
    expect(onPlayersLoaded).not.toHaveBeenCalled()
    expect(dependencies.historicalRpc).not.toHaveBeenCalled()
    expect(dependencies.metric).not.toHaveBeenCalled()
    expect(dependencies.loggerError).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Cluster overall leaderboard RPC failed'
    )
  })
})
