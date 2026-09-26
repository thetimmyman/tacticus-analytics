import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useOverallLeaderboardViewModel } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/useOverallLeaderboardViewModel'
import type { PlayerStats } from '@/app/(dashboard)/leaderboards/components/overall-leaderboard/types'

const PLAYERS: PlayerStats[] = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1
  return {
    displayName: `Player ${number.toString().padStart(2, '0')}`,
    Guild: number % 2 === 0 ? 'AAA' : 'BBB',
    userId: `player-${number}`,
    stableKey: `player-${number}`,
    totalDamage: number * 1_000,
    battleCount: number,
    avgDamage: 1_000,
    battleDamageTotal: number * 1_000,
    bombsUsed: number % 3,
    bossesKilled: number % 4,
    allBattleCount: number,
    allBossesKilled: number % 4,
    percentVsCluster: number,
    currentRank: 21 - number
  }
})

describe('useOverallLeaderboardViewModel', () => {
  it('owns sorting, filtering, scoring, and page slicing while resetting page', () => {
    const setCurrentPage = vi.fn()
    const { result, rerender } = renderHook(
      ({ currentPage }: { currentPage: number }) =>
        useOverallLeaderboardViewModel({
          players: PLAYERS,
          rpcTokenStats: null,
          currentPage,
          setCurrentPage
        }),
      { initialProps: { currentPage: 2 } }
    )

    expect(result.current.totalPlayers).toBe(20)
    expect(result.current.totalPages).toBe(2)
    expect(
      result.current.currentPlayers.map((player) => player.displayName)
    ).toEqual(['Player 05', 'Player 04', 'Player 03', 'Player 02', 'Player 01'])

    act(() =>
      result.current.handleSortChange({ key: 'name', direction: 'asc' })
    )
    expect(setCurrentPage).toHaveBeenLastCalledWith(1)
    rerender({ currentPage: 1 })
    expect(result.current.currentPlayers[0]?.displayName).toBe('Player 01')

    act(() => result.current.handleSearchChange('player 20'))
    expect(setCurrentPage).toHaveBeenLastCalledWith(1)
    expect(result.current.totalPlayers).toBe(1)
    expect(result.current.currentPlayers[0]?.displayName).toBe('Player 20')

    act(() => result.current.handleSearchChange(''))
    act(() => result.current.handleGuildChange('AAA'))
    expect(result.current.totalPlayers).toBe(10)
    expect(
      result.current.currentPlayers.every((player) => player.Guild === 'AAA')
    ).toBe(true)

    expect(result.current.scoring.isTokenModeActive).toBe(false)
    act(() => result.current.handleScoringModeChange('token-max'))
    expect(result.current.scoring).toMatchObject({
      isTokenModeActive: true,
      tokenWeightingMode: 'max',
      label: 'Token Weighted (Max)'
    })
  })
})
