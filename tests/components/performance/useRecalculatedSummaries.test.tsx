import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRecalculatedSummaries } from '@/app/components/performance/useRecalculatedSummaries'
import type { PerformanceSummary } from '@tacticus/app-core/performance.types'

describe('useRecalculatedSummaries', () => {
  it('returns fallback summaries when no computed data exists', () => {
    const fallback: PerformanceSummary = {
      displayName: 'Fallback',
      playerId: 'player-1',
      avg_vs_cluster: 0,
      avg_vs_guild: 0,
      avg_vs_cluster_boss_only: 0,
      avg_vs_guild_boss_only: 0,
      total_battles: 0,
      bosses_played: 0,
      primes_played: 0,
      boss_hits: 0,
      prime_hits: 0,
      isActive: true
    }

    const { result } = renderHook(() =>
      useRecalculatedSummaries({
        showFiveSeasonAvg: false,
        playerFiveSeasonData: [],
        compareMode: 'guild',
        latestDisplayNames: new Map(),
        currentDisplayNames: new Map(),
        playerMembershipMap: new Map(),
        selectedGuild: 'GUILD',
        calculationSummaries: [fallback]
      })
    )

    expect(result.current).toEqual([fallback])
  })

  it('builds five-season summaries with membership and name overrides', () => {
    const currentDisplayNames = new Map<string, string>([
      ['player-1', 'Current Name']
    ])
    const playerMembershipMap = new Map<string, boolean>([['player-1', false]])

    const { result } = renderHook(() =>
      useRecalculatedSummaries({
        showFiveSeasonAvg: true,
        playerFiveSeasonData: [
          {
            player_name: 'Old Name',
            player_id: 'player-1',
            is_current_member: false,
            battle_count: 3,
            encounter_id: 0,
            boss_name: 'Boss A',
            vs_guild_pct: 10,
            vs_cluster_pct: 20
          },
          {
            player_name: 'Old Name',
            player_id: 'player-1',
            is_current_member: false,
            battle_count: 2,
            encounter_id: 1,
            boss_name: 'Boss A Prime',
            vs_guild_pct: 50,
            vs_cluster_pct: 60
          }
        ],
        compareMode: 'guild-boss',
        latestDisplayNames: new Map(),
        currentDisplayNames,
        playerMembershipMap,
        selectedGuild: 'GUILD',
        calculationSummaries: []
      })
    )

    expect(result.current).toHaveLength(1)
    const summary = result.current[0]
    expect(summary.displayName).toBe('Current Name')
    expect(summary.total_battles).toBe(3)
    expect(summary.bosses_played).toBe(1)
    expect(summary.primes_played).toBe(0)
    expect(summary.avg_vs_guild).toBe(10)
    expect(summary.avg_vs_cluster).toBe(20)
    expect(summary.isActive).toBe(false)
  })
})
