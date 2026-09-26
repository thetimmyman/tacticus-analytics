import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { PlayerStats, WarInfo } from '@/app/(dashboard)/wars/_types'

const useWarInfoMock = vi.fn()
const useWarBoardMock = vi.fn()

vi.mock('@/app/(dashboard)/wars/_hooks', () => ({
  useWarInfo: (warId: string) => useWarInfoMock(warId),
  useWarBoard: (warId: string) => useWarBoardMock(warId)
}))

const { default: BoardClient } =
  await import('@/app/(dashboard)/wars/[warId]/board/BoardClient')

function makePlayer(
  id: string,
  name: string,
  points: number,
  total: number
): PlayerStats {
  return {
    playerId: id,
    playerName: name,
    attacks: {
      total,
      wins: 1,
      losses: 0,
      points,
      perfect: 0,
      failed: 0,
      winRate: 100
    },
    defenses: { total: 0, holds: 0, breaches: 0, conceded: 0, holdRate: 0 }
  }
}

const war: WarInfo = {
  warId: 'w1',
  warSlug: 'w1',
  status: 'completed',
  startTime: '2026-01-01T00:00:00Z',
  result: 'win',
  guild: {
    guildCode: 'G1',
    guildName: 'Guild One',
    guildTag: 'G1',
    score: 500
  },
  opponent: {
    guildCode: 'G2',
    guildName: 'Guild Two',
    guildTag: 'G2',
    score: 300
  }
}

describe('BoardClient', () => {
  it('renders rank/player/tokens/score columns, ranked by score, with no sort controls', () => {
    useWarInfoMock.mockReturnValue({ data: war, isLoading: false, error: null })
    useWarBoardMock.mockReturnValue({
      data: {
        guild: [
          makePlayer('p1', 'Anna', 100, 5),
          makePlayer('p2', 'Bill', 300, 8)
        ],
        opponent: [makePlayer('p3', 'Cara', 200, 6)],
        failureDataAvailable: true
      },
      isLoading: false,
      error: null
    })

    render(<BoardClient warId="w1" />)

    const headerSets = screen.getAllByRole('columnheader')
    expect(headerSets.map((h) => h.textContent?.trim())).toEqual([
      '#',
      'Player',
      'Tokens',
      'Score',
      '#',
      'Player',
      'Tokens',
      'Score'
    ])

    expect(screen.queryAllByRole('button')).toHaveLength(0)

    const tables = document.querySelectorAll('table')
    const guildRows = tables[0]?.querySelectorAll('tbody tr') ?? []
    expect(within(guildRows[0] as HTMLElement).getByText('Bill')).toBeTruthy()
    expect(within(guildRows[0] as HTMLElement).getByText('1')).toBeTruthy()
    expect(within(guildRows[1] as HTMLElement).getByText('Anna')).toBeTruthy()
  })
})
