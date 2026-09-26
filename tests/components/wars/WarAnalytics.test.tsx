import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('@/app/(dashboard)/wars/_components/PlayerRankingPanel', () => ({
  PlayerRankingPanel: () => null
}))

vi.mock('@/app/hooks/useMemberLabels', () => ({
  useMemberLabels: () => ({
    labelFor: (name: string | null | undefined) => name ?? '',
    labelMap: new Map(),
    isLoading: false
  })
}))

vi.mock('@tacticus/ui-kit', async () => {
  const actual =
    await vi.importActual<typeof import('@tacticus/ui-kit')>('@tacticus/ui-kit')
  return {
    ...actual,
    ClientDate: ({ date }: { date: string }) => <span>{date}</span>
  }
})

vi.mock('@tacticus/ui-kit/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: () => null
}))

const mockWarAnalyticsData = {
  wars: [
    {
      war_id: 'war-1',
      opponent_guild_name: 'Blood Ravens',
      war_result: 'win',
      guild_score: 5000,
      opponent_score: 3200,
      war_start_date: '2026-07-01T00:00:00Z',
      war_end_date: '2026-07-03T00:00:00Z',
      war_season: 1,
      battlefield_level: 5
    }
  ],
  players: [
    {
      playerId: 'p1',
      player: 'Commander Shepard',
      wars: 3,
      attempts: 10,
      wins: 8,
      score: 12000,
      avgScore: 1200,
      winRate: 80
    }
  ],
  offenseZones: [],
  defenseZones: [],
  playerActivity: [
    {
      playerId: 'p1',
      player: 'Commander Shepard',
      warsParticipated: 3,
      totalWars: 3,
      participationRate: 100,
      lastActiveWarDate: '2026-07-03T00:00:00Z',
      warsInactive: 0,
      attempts: 10,
      wins: 8,
      score: 12000,
      avgScore: 1200,
      winRate: 80
    }
  ],
  warPoints: { players: [], chartMax: 0, totalAttempts: 0 },
  attempts: [],
  allMembers: []
}

vi.mock(
  '@/app/(dashboard)/wars/_components/_hooks/useWarAnalyticsData',
  () => ({
    useWarAnalyticsData: () => ({
      data: mockWarAnalyticsData,
      isLoading: false,
      error: null
    }),
    EMPTY_WAR_POINTS_SUMMARY: { players: [], chartMax: 0, totalAttempts: 0 },
    buildWarPointsScore: () => ({ players: [], chartMax: 0, totalAttempts: 0 })
  })
)

import WarAnalytics from '@/app/(dashboard)/wars/_components/WarAnalytics'

describe('WarAnalytics', () => {
  it('renders the Top Players, Wars In Range, and Player Activity Summary tables', () => {
    render(<WarAnalytics guildCode="TEST" />)

    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(3)

    const topPlayersHeaders = within(tables[0]!).getAllByRole('columnheader')
    expect(topPlayersHeaders.map((h) => h.textContent)).toEqual([
      'Player',
      'Wars',
      'Attempts',
      'Win%',
      'Score',
      'Avg'
    ])
    const topPlayersFirstRow = within(tables[0]!).getAllByRole('row')[1]!
    expect(
      within(topPlayersFirstRow)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Commander Shepard', '3', '10', '80%', '12,000', '1,200'])

    const warsHeaders = within(tables[1]!).getAllByRole('columnheader')
    expect(warsHeaders.map((h) => h.textContent)).toEqual([
      'Opponent',
      'Result',
      'Score',
      'Ended'
    ])
    const warsFirstRow = within(tables[1]!).getAllByRole('row')[1]!
    const warsCells = within(warsFirstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(warsCells[0]).toBe('Blood Ravens')
    expect(warsCells[1]).toBe('WIN')
    expect(warsCells[2]).toBe('5,000 - 3,200')

    const activityHeaders = within(tables[2]!).getAllByRole('columnheader')
    expect(activityHeaders.map((h) => h.textContent)).toEqual([
      'Player',
      'Participated',
      'Rate',
      'Attacks',
      'Win Rate',
      'Score',
      'Avg Score',
      'Last Active'
    ])
    const activityFirstRow = within(tables[2]!).getAllByRole('row')[1]!
    expect(
      within(activityFirstRow)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual([
      'Commander Shepard',
      '3/3',
      '100%',
      '10',
      '80%',
      '12,000',
      '1,200',
      '2026-07-03T00:00:00Z'
    ])
  })
})
